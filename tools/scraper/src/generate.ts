import { rm } from "node:fs/promises";
import { join } from "node:path";
import { stringify as toYaml } from "yaml";
import type { ChromeData, CrawlResult } from "./crawl.ts";
import type { Options } from "./config.ts";
import type { BrandResult } from "./brand.ts";
import { renderBrandCss } from "./brand.ts";
import type {
  Action,
  ContactInfo,
  ImageRef,
  MigrationReport,
  NavItem,
  RedirectRecord,
  ScrapedPage,
  Section,
} from "./types.ts";
import { writeJson, writeText } from "./utils/fs.ts";
import { truncate } from "./extract/text.ts";
import { toPath } from "./utils/url.ts";
import type { Logger } from "./utils/log.ts";

/**
 * Writes a crawl into the Astro app: content collections, site data, the brand
 * theme and a migration report.
 *
 * Generated files are only ever written to paths the scraper owns — `brand.css`,
 * `site.json` and the three content collections — so the hand-written components,
 * layouts and design system in apps/site are never touched.
 */

const GENERATED_COLLECTIONS = ["pages", "posts", "services"] as const;

/**
 * Absolute URL from the source site -> site-relative href (`/about`).
 * Uses the same normalisation as the crawler, so `/about.html` becomes `/about`
 * and matches the route the rebuilt site serves.
 */
function toLocalHref(url: string, origin: string): string {
  if (!url.startsWith(origin)) return url;
  return toPath(url);
}

/** Rewrite every href in a section tree to the new site's URL space. */
function localiseSection(section: Section, origin: string): void {
  const record = section as unknown as Record<string, unknown>;

  const fixAction = (action: unknown) => {
    if (!action || typeof action !== "object") return;
    const entry = action as Action;
    if (entry.href) entry.href = toLocalHref(entry.href, origin);
  };

  if (Array.isArray(record["actions"])) record["actions"].forEach(fixAction);
  if (record["actions"]) fixAction(record["actions"]);

  const tierActions = record["tiers"];
  if (Array.isArray(tierActions)) {
    for (const tier of tierActions) {
      if (tier && typeof tier === "object") fixAction((tier as { actions?: unknown }).actions);
    }
  }

  // Embed URLs stay absolute, but same-origin ones should be local.
  const embedUrl = record["url"];
  if (typeof embedUrl === "string") record["url"] = toLocalHref(embedUrl, origin);
}

/** Map a navigation list onto the migrated URL space, dropping dead targets. */
function mapNav(items: NavItem[], origin: string, livePaths: Set<string>): NavItem[] {
  const mapped: NavItem[] = [];

  for (const item of items) {
    const href = toLocalHref(item.href, origin);
    const external = !href.startsWith("/");
    if (!external && !livePaths.has(href === "/" ? "/" : href)) continue;

    const children = item.children
      ?.map((child) => ({ ...child, href: toLocalHref(child.href, origin) }))
      .filter((child) => !child.href.startsWith("/") || livePaths.has(child.href));

    mapped.push({
      label: item.label,
      href,
      ...(children && children.length > 0 ? { children } : {}),
    });
  }

  return mapped;
}

/**
 * Frontmatter + body, in the format Astro's content loader expects.
 * Strings stay unquoted unless YAML needs quoting, which keeps the generated
 * Markdown readable and reviewable in a diff.
 */
function contentFile(data: Record<string, unknown>, body?: string): string {
  const frontmatter = toYaml(data, { lineWidth: 100 }).trimEnd();
  const trimmedBody = body?.trim();
  return `---\n${frontmatter}\n---\n${trimmedBody ? `\n${trimmedBody}\n` : ""}`;
}

/**
 * First downloaded image in the page's content, usable as a cover or social card.
 *
 * Deliberately ignores `page.images`, which also holds site chrome: a navigation
 * button is not a social preview.
 */
function coverImageFor(page: ScrapedPage): ImageRef | undefined {
  return page.contentImages.find((candidate) => /^(assets\/|(\/)?images\/)/.test(candidate.src));
}

/** SEO block for a migrated entry. */
function seoFor(page: ScrapedPage): Record<string, unknown> {
  const image = coverImageFor(page);
  return {
    title: page.title,
    description: truncate(page.description, 158),
    ...(image ? { image: image.src } : {}),
    noindex: false,
  };
}

/** First image on the page that we downloaded and can use as a cover. */
function coverFor(page: ScrapedPage): Record<string, unknown> | undefined {
  const image = coverImageFor(page);
  return image ? { src: image.src, alt: image.alt || page.title } : undefined;
}

interface WriteCounts {
  pages: number;
  posts: number;
  services: number;
}

/** Write the three content collections from the crawl. */
async function writeContent(
  crawl: CrawlResult,
  options: Options,
  scrapedAt: string,
  logger: Logger,
): Promise<WriteCounts> {
  const contentRoot = join(options.siteDir, "src/content");
  const counts: WriteCounts = { pages: 0, posts: 0, services: 0 };

  for (const page of crawl.pages) {
    for (const section of page.sections) localiseSection(section, crawl.origin);

    if (page.kind === "post") {
      const cover = coverFor(page);
      await writeText(
        join(contentRoot, "posts", `${page.id}.md`),
        contentFile(
          {
            title: page.title,
            description: truncate(page.description, 158),
            publishedAt: page.publishedAt ?? scrapedAt,
            ...(page.updatedAt ? { updatedAt: page.updatedAt } : {}),
            ...(page.author ? { author: page.author } : {}),
            ...(cover ? { cover } : {}),
            tags: page.tags,
            seo: seoFor(page),
            source: sourceOf(page, scrapedAt),
          },
          page.markdown,
        ),
      );
      counts.posts += 1;
      continue;
    }

    if (page.kind === "service") {
      const features = page.sections.find((section) => section.type === "features");
      const faq = page.sections.find((section) => section.type === "faq");
      const hero = page.sections.find((section) => section.type === "hero");

      await writeText(
        join(contentRoot, "services", `${page.id}.md`),
        contentFile(
          {
            title: page.title,
            summary: truncate(page.description, 158),
            icon: "sparkles",
            ...(hero && hero.type === "hero" && hero.image ? { image: hero.image } : {}),
            highlights:
              features && features.type === "features"
                ? features.items.map((item) => item.title).slice(0, 8)
                : [],
            faqs: faq && faq.type === "faq" ? faq.items : [],
            order: counts.services + 1,
            seo: seoFor(page),
            source: sourceOf(page, scrapedAt),
          },
          page.markdown,
        ),
      );
      counts.services += 1;
      continue;
    }

    /**
 * Buttons for the home hero, taken from the site's own navigation.
 *
 * A scraped home page seldom has hero buttons of its own, which leaves a text-only
 * hero with no next step. The labels and targets are the site's own top-level
 * pages, so nothing is invented: the first destination after home, plus contact.
 */
function homeHeroActions(crawl: CrawlResult): Action[] {
  const live = new Set(crawl.pages.map((page) => page.path));
  const nav = mapNav(crawl.chrome?.navigation ?? [], crawl.origin, live).filter(
    (item) => item.href.length > 0 && item.href !== "/" && !/^https?:/i.test(item.href),
  );
  const primary = nav[0];
  if (!primary) return [];

  const actions: Action[] = [{ label: primary.label, href: primary.href, style: "primary" }];

  const contact = nav.find((item) => /contact/i.test(`${item.href} ${item.label}`));
  if (contact && contact.href !== primary.href) {
    actions.push({ label: contact.label, href: contact.href, style: "outline" });
  }

  return actions;
}

/** The page's sections, with the home hero's buttons filled in when it has none. */
function withHomeHeroActions(page: ScrapedPage, crawl: CrawlResult): Section[] {
  const hero = page.sections.find((section) => section.type === "hero");
  if (page.kind !== "home" || !hero || hero.type !== "hero" || (hero.actions?.length ?? 0) > 0) {
    return page.sections;
  }

  const actions = homeHeroActions(crawl);
  if (actions.length === 0) return page.sections;

  return page.sections.map((section) =>
    section.type === "hero" ? { ...section, actions } : section,
  );
}

const template =
      page.kind === "contact" ? "contact" : page.kind === "legal" ? "legal" : "marketing";

    await writeText(
      join(contentRoot, "pages", `${page.id}.md`),
      contentFile({
        title: page.title,
        description: truncate(page.description, 158),
        template,
        breadcrumbs: [],
        sections: withHomeHeroActions(page, crawl),
        seo: seoFor(page),
        source: sourceOf(page, scrapedAt),
      }),
    );
    counts.pages += 1;
  }

  logger.detail(
    `Wrote ${counts.pages} page(s), ${counts.posts} post(s), ${counts.services} service(s)`,
  );

  return counts;
}

/** Netlify/Cloudflare Pages style redirect file, plus the raw JSON. */
async function writeRedirects(outDir: string, redirects: RedirectRecord[]): Promise<void> {
  await writeJson(`${outDir}/redirects.json`, redirects);

  const body = [
    "# Redirects for URLs that changed shape during the rebuild.",
    "# Deploy as-is on Netlify/Cloudflare Pages, or translate into your host's rules.",
    "",
    ...redirects.map((entry) => `${entry.from}  ${entry.to}  301`),
    "",
  ].join("\n");

  await writeText(`${outDir}/_redirects`, body);
}

/* -------------------------------------------------------------------------- *
 * Orchestration
 * -------------------------------------------------------------------------- */

export interface GenerateResult {
  pages: number;
  posts: number;
  services: number;
  redirects: number;
  reportPath: string;
}

/** Assemble and write the migration report (JSON for tooling, Markdown for humans). */
async function writeReport(
  outDir: string,
  report: MigrationReport,
  logger: Logger,
): Promise<string> {
  const path = `${outDir}/report.json`;
  await writeJson(path, report);

  const lines: string[] = [
    `# Migration report — ${report.source}`,
    "",
    `- Run: ${report.startedAt} → ${report.finishedAt} (${Math.round(report.durationMs / 1000)}s)`,
    `- Pages migrated: **${report.pages.length}**`,
    `- Assets downloaded: ${report.assetTotals.downloaded} (${Math.round(report.assetTotals.bytes / 1024)} kB); kept remote: ${report.assetTotals.remote}`,
    `- Redirects needed: ${report.redirects.length}`,
    "",
    "## Pages",
    "",
    "| Path | Kind | Words | Sections | Warnings |",
    "| --- | --- | ---: | --- | --- |",
    ...report.pages.map(
      (page) =>
        `| \`${page.path}\` | ${page.kind} | ${page.words} | ${page.sections.join(", ")} | ${
          page.warnings.length > 0 ? page.warnings.join("; ") : ""
        } |`,
    ),
    "",
  ];

  if (report.redirects.length > 0) {
    lines.push("## Redirects", "", "| From | To | Reason |", "| --- | --- | --- |");
    lines.push(
      ...report.redirects.map((entry) => `| \`${entry.from}\` | \`${entry.to}\` | ${entry.reason} |`),
    );
    lines.push("");
  }

  if (report.skipped.length > 0) {
    lines.push("## Skipped URLs", "", "| URL | Reason |", "| --- | --- |");
    lines.push(...report.skipped.slice(0, 100).map((entry) => `| \`${entry.url}\` | ${entry.reason} |`));
    lines.push("");
  }

  if (report.warnings.length > 0) {
    lines.push("## Warnings", "", ...report.warnings.map((warning) => `- ${warning}`), "");
  }

  lines.push(
    "## Palette",
    "",
    "| Colour | Uses | Source |",
    "| --- | ---: | --- |",
    ...report.palette.evidence.map(
      (entry) => `| \`${entry.color}\` | ${entry.count} | ${entry.source} |`,
    ),
    "",
  );

  await writeText(`${outDir}/report.md`, lines.join("\n"));
  logger.detail(`Report: ${path}`);

  return path;
}

/** Write the whole crawl into the Astro app and report on it. */
export async function generateSite(
  crawl: CrawlResult,
  brand: BrandResult,
  options: Options,
  logger: Logger,
  context: {
    startedAt: number;
    assetTotals: MigrationReport["assetTotals"];
    assets: MigrationReport["assets"];
  },
): Promise<GenerateResult> {
  const scrapedAt = new Date().toISOString();

  await resetCollections(options.siteDir, logger);
  const counts = await writeContent(crawl, options, scrapedAt, logger);

  await writeJson(join(options.siteDir, "src/data/site.json"), buildSiteConfig(crawl, brand, options, scrapedAt));
  await writeText(
    join(options.siteDir, "src/styles/brand.css"),
    renderBrandCss(brand, { sourceUrl: options.url, generatedAt: scrapedAt }),
  );

  const redirects = buildRedirects(crawl);
  await writeRedirects(options.outDir, redirects);

  const finishedAt = Date.now();
  const report: MigrationReport = {
    source: options.url,
    startedAt: new Date(context.startedAt).toISOString(),
    finishedAt: new Date(finishedAt).toISOString(),
    durationMs: finishedAt - context.startedAt,
    pages: crawl.pages.map((page) => ({
      url: page.url,
      path: page.path,
      kind: page.kind,
      title: page.title,
      depth: page.depth,
      images: page.images.length,
      words: page.text.split(/\s+/).filter(Boolean).length,
      sections: page.sections.map((section) => section.type),
      warnings: page.warnings,
    })),
    skipped: crawl.skipped,
    assets: context.assets,
    assetTotals: context.assetTotals,
    redirects,
    palette: brand.palette,
    fonts: brand.fonts,
    warnings: [...crawl.warnings, ...brand.warnings],
  };

  const reportPath = await writeReport(options.outDir, report, logger);

  return {
    pages: counts.pages,
    posts: counts.posts,
    services: counts.services,
    redirects: redirects.length,
    reportPath,
  };
}


/** Empty a generated collection so a re-run cannot leave stale pages behind. */
async function resetCollections(siteDir: string, logger: Logger): Promise<void> {
  for (const collection of GENERATED_COLLECTIONS) {
    const dir = join(siteDir, "src/content", collection);
    await rm(dir, { recursive: true, force: true });
    logger.detail(`Reset src/content/${collection}`);
  }
}

/** Source-provenance block written into every migrated entry. */
function sourceOf(page: ScrapedPage, scrapedAt: string): Record<string, string> {
  return { url: page.url, scrapedAt };
}

/** Every URL the rebuilt site will actually serve. */
export function liveRoutes(crawl: CrawlResult): Map<string, ScrapedPage> {
  const routes = new Map<string, ScrapedPage>();

  for (const page of crawl.pages) {
    if (page.kind === "post") routes.set(`/posts/${page.id}`, page);
    else if (page.kind === "service") routes.set(`/services/${page.id}`, page);
    else routes.set(page.path, page);
  }

  return routes;
}

/**
 * The title segment shared by the most pages.
 *
 * Legacy sites rarely publish a site name anywhere machine-readable, and their
 * titles read "JC Wendy Houses | Catalogue". The words that repeat across pages
 * are the site's own name; page-specific words lose the vote.
 */
export function sharedTitleSegment(titles: string[]): { name: string; support: number } | null {
  const counts = new Map<string, { display: string; count: number }>();

  for (const title of titles) {
    const seen = new Set<string>();
    for (const segment of title.split(/[|•·–—-]/)) {
      const clean = segment.trim();
      if (clean.length < 3 || clean.length > 60) continue;

      const key = clean.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      const entry = counts.get(key);
      if (entry) entry.count += 1;
      else counts.set(key, { display: clean, count: 1 });
    }
  }

  const best = [...counts.values()].sort(
    (a, b) => b.count - a.count || b.display.length - a.display.length,
  )[0];

  return best && best.count >= 2 ? { name: best.display, support: best.count } : null;
}

/** An empty address, matching what apps/site expects. */
const EMPTY_ADDRESS = { street: "", city: "", region: "", postalCode: "", country: "" };

/**
 * Merge contact details site-wide.
 *
 * Sites usually publish their phone number, email and postal address on one page
 * only — the contact page — while the site chrome is read from the home page. So
 * start from the chrome and fill the gaps from whichever page has them, looking at
 * the contact page first.
 */
function mergeContact(chrome: ChromeData | null, pages: ScrapedPage[]): ContactInfo {
  const merged: ContactInfo = {
    email: chrome?.contact.email ?? "",
    phone: chrome?.contact.phone ?? "",
    address: { ...(chrome?.contact.address ?? EMPTY_ADDRESS) },
    hours: chrome?.contact.hours ?? [],
  };

  const ordered = [
    ...pages.filter((page) => page.kind === "contact"),
    ...pages.filter((page) => page.kind !== "contact"),
  ];

  for (const page of ordered) {
    if (!merged.email && page.contact.email) merged.email = page.contact.email;
    if (!merged.phone && page.contact.phone) merged.phone = page.contact.phone;
    if (!merged.address.street && page.contact.address.street) {
      merged.address = { ...page.contact.address };
    }
    if (merged.hours.length === 0 && page.contact.hours.length > 0) {
      merged.hours = page.contact.hours;
    }
  }

  return merged;
}

/** Social links from the chrome, falling back to any page that lists them. */
function mergeSocials(
  chrome: ChromeData | null,
  pages: ScrapedPage[],
): { label: string; href: string }[] {
  const seen = new Map<string, { label: string; href: string }>();

  for (const link of chrome?.socials ?? []) seen.set(link.label, link);
  for (const page of pages) {
    for (const link of page.socials) if (!seen.has(link.label)) seen.set(link.label, link);
  }

  return [...seen.values()];
}

/** The site-wide config that apps/site/src/data/site.ts validates. */
export function buildSiteConfig(
  crawl: CrawlResult,
  brand: BrandResult,
  options: Options,
  scrapedAt: string,
): Record<string, unknown> {
  const chrome: ChromeData | null = crawl.chrome;
  const home = crawl.pages.find((page) => page.kind === "home") ?? crawl.pages[0];
  const routes = liveRoutes(crawl);
  const live = new Set(routes.keys());

  const hostname = new URL(options.url).hostname.replace(/^www\./, "");
  const fallbackName = hostname
    .split(".")[0]!
    .replace(/[-_]+/g, " ")
    .replace(/^\w/, (letter) => letter.toUpperCase());

  // A name read from a page title (or guessed from the hostname) is weak, so let
  // every page title vote on it. Structured data always wins.
  const voted = sharedTitleSegment(crawl.pages.map((page) => page.title));
  const weakName = !chrome || chrome.nameFrom !== "structured";
  const name =
    weakName && voted && voted.support >= Math.ceil(crawl.pages.length / 2)
      ? voted.name
      : chrome?.name || voted?.name || fallbackName;

  const primary = mapNav(chrome?.navigation ?? [], crawl.origin, live);

  // A menu read from the home page never links back to home (it is the current
  // page, so it is rendered as text or an image rather than a link). Put it back.
  if (primary.length > 0 && !primary.some((item) => item.href === "/")) {
    primary.unshift({ label: "Home", href: "/" });
  }

  // Header call-to-action: the home page's hero buttons, else a contact link.
  const hero = home?.sections.find((section) => section.type === "hero");
  let actions: Action[] = hero && hero.type === "hero" ? (hero.actions ?? []) : [];
  actions = actions
    .map((action) => ({ ...action, href: toLocalHref(action.href, crawl.origin) }))
    .filter((action) => !action.href.startsWith("/") || live.has(action.href))
    .slice(0, 1);

  if (actions.length === 0 && live.has("/contact")) {
    actions = [{ label: "Contact", href: "/contact" }];
  }

  const footerLinks = (chrome?.footerLinks ?? [])
    .map((link) => ({ ...link, href: toLocalHref(link.href, crawl.origin) }))
    .filter((link) => !link.href.startsWith("/") || live.has(link.href))
    .slice(0, 12);

  const footerColumns = (chrome?.footerColumns ?? [])
    .map((column) => ({
      title: column.title,
      links: column.links
        .map((link) => ({ ...link, href: toLocalHref(link.href, crawl.origin) }))
        .filter((link) => !link.href.startsWith("/") || live.has(link.href))
        .slice(0, 8),
    }))
    .filter((column) => column.links.length > 0)
    .slice(0, 4);

  const legalMatch = chrome?.footerText ? /(©[^.]{0,120}|all rights reserved[^.]{0,40})/i.exec(chrome.footerText) : null;

  return {
    name,
    legalName: chrome?.legalName ?? "",
    tagline: chrome?.tagline || home?.description || "",
    description: home?.description || chrome?.tagline || `${name} website`,
    url: options.url,
    locale: home?.lang ?? "en",
    logo: {
      src: options.logo ?? chrome?.logo?.src ?? "",
      alt: options.logo ? `${name} logo` : chrome?.logo?.alt || `${name} logo`,
      text: name,
    },
    contact: mergeContact(chrome, crawl.pages),
    socials: mergeSocials(chrome, crawl.pages),
    navigation: { primary, actions, footer: footerLinks },
    footer: {
      tagline: "",
      columns: footerColumns,
      legal: legalMatch ? legalMatch[0].trim().slice(0, 160) : "",
      credit: "Rebuilt with Astro, Tailwind CSS and daisyUI.",
    },
    theme: {
      mode: options.themeMode,
      light: "brand",
      dark: "brand-dark",
      fonts: { heading: brand.fonts.heading, body: brand.fonts.body },
      palette: brand.palette.light,
    },
    source: {
      url: options.url,
      scrapedAt,
      pagesMigrated: crawl.pages.length,
    },
  };
}

/**
 * Redirects for URLs that changed shape during the crawl — the `.html`/`.php`
 * suffixes a static rebuild drops, in particular. Everything else keeps its path.
 */
export function buildRedirects(crawl: CrawlResult): RedirectRecord[] {
  const redirects: RedirectRecord[] = [];

  for (const page of crawl.pages) {
    const original = new URL(page.url).pathname;
    const target = page.kind === "post" ? `/posts/${page.id}`
      : page.kind === "service" ? `/services/${page.id}`
      : page.path;

    const needsRedirect =
      /\.(html?|php|aspx?|jsp)$/i.test(original) ||
      /\/(index|default)\.(html?|php|aspx?)$/i.test(original) ||
      original.replace(/\/+$/, "") !== target;

    if (needsRedirect && original !== target) {
      redirects.push({ from: original, to: target, reason: "URL shape changed in the rebuild" });
    }
  }

  return redirects;
}
