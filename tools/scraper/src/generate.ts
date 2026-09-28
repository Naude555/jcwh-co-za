import { rm } from "node:fs/promises";
import { join } from "node:path";
import { stringify as toYaml } from "yaml";
import type { ChromeData, CrawlResult } from "./crawl.ts";
import type { Options } from "./config.ts";
import type { BrandResult } from "./brand.ts";
import { renderBrandCss } from "./brand.ts";
import type {
  Action,
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

/** SEO block for a migrated entry. */
function seoFor(page: ScrapedPage): Record<string, unknown> {
  const image = page.images.find((candidate) => /^(assets\/|(\/)?images\/)/.test(candidate.src));
  return {
    title: page.title,
    description: truncate(page.description, 158),
    ...(image ? { image: image.src } : {}),
    noindex: false,
  };
}

/** First image on the page that we downloaded and can use as a cover. */
function coverFor(page: ScrapedPage): Record<string, unknown> | undefined {
  const image = page.images.find((candidate) => /^(assets\/|(\/)?images\/)/.test(candidate.src));
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

    const template =
      page.kind === "contact" ? "contact" : page.kind === "legal" ? "legal" : "marketing";

    await writeText(
      join(contentRoot, "pages", `${page.id}.md`),
      contentFile({
        title: page.title,
        description: truncate(page.description, 158),
        template,
        breadcrumbs: [],
        sections: page.sections,
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
  const name = chrome?.name || fallbackName;

  const primary = mapNav(chrome?.navigation ?? [], crawl.origin, live);

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
      src: chrome?.logo?.src ?? "",
      alt: chrome?.logo?.alt || `${name} logo`,
      text: name,
    },
    contact: {
      email: chrome?.contact.email ?? "",
      phone: chrome?.contact.phone ?? "",
      address: chrome?.contact.address ?? {
        street: "",
        city: "",
        region: "",
        postalCode: "",
        country: "",
      },
      hours: chrome?.contact.hours ?? [],
    },
    socials: chrome?.socials ?? [],
    navigation: { primary, actions, footer: footerLinks },
    footer: {
      tagline: "",
      columns: footerColumns,
      legal: legalMatch ? legalMatch[0].trim().slice(0, 160) : "",
      credit: "Rebuilt with Astro, Tailwind CSS and daisyUI.",
    },
    theme: {
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
