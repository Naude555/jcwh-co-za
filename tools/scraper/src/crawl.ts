import type { Cheerio } from "cheerio";
import type { Element } from "domhandler";
import type { RequestOptions } from "crawlee";
import type { CheerioAPI } from "cheerio";
import { compilePattern, type Options } from "./config.ts";
import type { AssetStore } from "./assets.ts";
import type {
  Action,
  ContactDetail,
  ContactInfo,
  FaqItem,
  FooterColumn,
  ImageRef,
  LogoItem,
  NavItem,
  PageKind,
  RedirectRecord,
  ScrapedPage,
  Section,
  Testimonial,
} from "./types.ts";
import { discoverUrls } from "./discover.ts";
import {
  extractBrandIdentity,
  extractContact,
  extractFooter,
  extractJsonLd,
  extractLogo,
  extractMeta,
  extractNavigation,
  extractSocials,
} from "./extract/page.ts";
import {
  buildSections,
  extractFaqs,
  extractLogos,
  extractTestimonials,
} from "./extract/blocks.ts";
import {
  extractContent,
  extractImages,
  extractImagesIn,
  extractLinks,
  findMainContent,
  normaliseWhitespace,
  parseHtml,
  pickImageSrc,
} from "./extract/content.ts";
import { dropSiteName, wordCount } from "./extract/text.ts";
import { writeText } from "./utils/fs.ts";
import {
  contentId,
  isIgnoredPath,
  looksLikeArticle,
  normaliseUrl,
  resolveHref,
  toId,
  toPath,
} from "./utils/url.ts";
import { c, type Logger } from "./utils/log.ts";

/** Visit every `src`/`avatar`/`photo` field in a section tree. */
function walkImageRefs(value: unknown, visit: (image: ImageRef) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walkImageRefs(item, visit);
    return;
  }
  if (!value || typeof value !== "object") return;

  const record = value as Record<string, unknown>;
  const src = record["src"];
  if (typeof src === "string" && record["alt"] !== undefined) {
    visit(record as unknown as ImageRef);
  }

  for (const child of Object.values(record)) walkImageRefs(child, visit);
}

/** Absolute image URLs referenced by a page, from its markup and its blocks. */
function imageUrlsIn(page: ScrapedPage): string[] {
  const urls = new Set<string>();

  for (const image of page.images) urls.add(image.src);
  for (const section of page.sections as Section[]) {
    walkImageRefs(section, (image) => {
      if (/^https?:/i.test(image.src)) urls.add(image.src);
    });
  }
  for (const match of page.markdown.matchAll(/!\[[^\]]*\]\(\s*([^)\s]+)/g)) {
    const url = match[1];
    if (url && /^https?:/i.test(url)) urls.add(url);
  }

  return [...urls];
}

/**
 * Download every image the page uses and rewrite all references — in the
 * Markdown and in the section blocks — to the local path.
 */
async function localiseAssets(page: ScrapedPage, store: AssetStore): Promise<number> {
  const urls = imageUrlsIn(page);
  if (urls.length === 0) return 0;

  const mapping = new Map<string, string>();
  for (const url of urls) {
    const local = await store.fetch(url);
    if (local !== url) mapping.set(url, local);
  }
  if (mapping.size === 0) return 0;

  const rewrite = (value: string) => {
    let result = value;
    for (const [from, to] of mapping) result = result.split(from).join(to);
    return result;
  };

  page.markdown = rewrite(page.markdown);
  page.images = page.images.map((image) => ({ ...image, src: mapping.get(image.src) ?? image.src }));
  page.imageLinks = page.imageLinks.map((link) => ({
    ...link,
    src: mapping.get(link.src) ?? link.src,
  }));
  page.contentImages = page.contentImages.map((image) => ({
    ...image,
    src: mapping.get(image.src) ?? image.src,
  }));

  for (const section of page.sections as Section[]) {
    walkImageRefs(section, (image) => {
      image.src = rewrite(image.src);
    });
  }

  return mapping.size;
}

/** Classify a page so the generator knows which template and route to use. */
function classify(path: string, title: string, text: string, description: string): PageKind {
  if (path === "/") return "home";
  if (/contact|get-in-touch|enquir|book/i.test(path)) return "contact";
  if (/(privacy|terms|cookies?|gdpr|legal|disclaimer)\b/i.test(path)) return "legal";
  if (looksLikeArticle(path)) return "post";
  if (/(^|\/)(services?|solutions?|what-we-do)\/[^/]+/i.test(path)) return "service";

  // A dated page or one whose description reads like an article.
  const words = wordCount(text);
  const dated = /\b(20\d{2})\b/.test(title) && /(news|blog|insight|article|update)/i.test(path);
  if (dated || (words > 700 && /(news|blog|insight|journal|article)/i.test(path))) return "post";
  if (description.length > 60 && words > 350 && /(read more|published|min read)/i.test(text)) {
    return "post";
  }

  return "page";
}

/**
 * Swap gallery thumbnails for the full-size image on the page they link to.
 *
 * A classic gallery is a grid of thumbnails pointing at detail pages, so without
 * this the rebuild would show postage stamps.
 */
function promoteGalleryThumbnails(pages: ScrapedPage[], logger: Logger): number {
  // An image that appears on most pages is site chrome (a logo, a nav button), not
  // the photo a detail page is about. Without this, detail pages that declare no
  // dimensions fall back to DOM order and "largest" resolves to a nav button.
  const frequency = new Map<string, number>();
  for (const page of pages) {
    for (const src of new Set(page.images.map((image) => image.src))) {
      frequency.set(src, (frequency.get(src) ?? 0) + 1);
    }
  }
  const chromeThreshold = Math.max(3, Math.ceil(pages.length / 2));

  const largestByUrl = new Map<string, ImageRef>();
  for (const page of pages) {
    const candidates = page.images.filter(
      (image) => (frequency.get(image.src) ?? 0) < chromeThreshold,
    );
    const largest = [...candidates].sort(
      (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
    )[0];
    if (largest) largestByUrl.set(page.url.replace(/\/$/, ""), largest);
  }

  let promoted = 0;

  for (const page of pages) {
    if (page.imageLinks.length === 0) continue;
    const hrefBySrc = new Map(page.imageLinks.map((link) => [link.src, link.href]));

    for (const section of page.sections) {
      if (section.type !== "gallery") continue;

      section.images = section.images.map((image) => {
        const href = hrefBySrc.get(image.src);
        if (!href) return image;

        const detail = largestByUrl.get(href.replace(/\/$/, ""));
        if (!detail || detail.src === image.src) return image;

        // Only refuse the swap when both sizes are known and the detail page's
        // image is genuinely not bigger. Legacy detail pages rarely declare
        // dimensions, so unknown sizes must not block the promotion.
        const thumbnailArea = (image.width ?? 0) * (image.height ?? 0);
        const detailArea = (detail.width ?? 0) * (detail.height ?? 0);
        if (thumbnailArea > 0 && detailArea > 0 && detailArea <= thumbnailArea) return image;

        promoted += 1;
        return { ...detail, alt: detail.alt || image.alt };
      });
    }
  }

  if (promoted > 0) {
    logger.info(`Promoted ${promoted} gallery thumbnail(s) to their full-size images`);
  }

  return promoted;
}

/**
 * Drop the page's own first heading when it is what the hero already shows.
 *
 * A page whose only heading is "Welcome to Acme" gets that as its hero heading, and
 * leaving it in the body would print it twice.
 */
function stripHeroHeading(content: Cheerio<Element>, heroHeading: string): Cheerio<Element> {
  const target = heroHeading.trim().toLowerCase();
  if (!target) return content;

  const first = content.find("h1, h2, h3, h4, h5, h6").first();
  if (first.length === 0) return content;
  if (normaliseWhitespace(first.text()).toLowerCase() !== target) return content;

  first.remove();
  return content;
}

/** Inline `<style>` blocks plus every linked stylesheet, for brand extraction. */
async function collectStylesheets(html: string, baseUrl: string, limit = 8): Promise<string[]> {
  const $ = parseHtml(html);
  const texts: string[] = [];

  $("style").each((_, element) => {
    const css = $(element).text();
    if (css.trim()) texts.push(css);
  });

  const hrefs = new Set<string>();
  $("link[rel='stylesheet'][href], link[rel='preload'][as='style'][href]").each((_, element) => {
    const resolved = resolveHref($(element).attr("href") ?? "", baseUrl);
    if (resolved) hrefs.add(resolved);
  });

  // Same-origin only: third-party CSS says nothing about the client's brand.
  const origin = new URL(baseUrl).origin;
  for (const href of [...hrefs].filter((url) => url.startsWith(origin)).slice(0, limit)) {
    try {
      const response = await fetch(href, {
        signal: AbortSignal.timeout(15000),
        headers: { "user-agent": "jcwh-modernizer/0.1 (+site modernization crawl)" },
      });
      if (!response.ok) continue;
      const css = await response.text();
      if (css.length > 40) texts.push(css);
    } catch {
      // A missing stylesheet only weakens brand detection, so keep going.
    }
  }

  return texts;
}

/* -------------------------------------------------------------------------- *
 * Page extraction
 * -------------------------------------------------------------------------- */

const CTA_PATTERN =
  /(contact|get in touch|enquir|book|quote|consult|get started|start a|learn more|our services|pricing|shop|buy|subscribe|discover|view all|read more)/i;

/** Eyebrow/kicker text that sits immediately above the page's h1. */
function extractEyebrow($: CheerioAPI): string | undefined {
  const candidates = $(
    "[class*='eyebrow'], [class*='kicker'], [class*='subtitle'], [class*='tagline'], [class*='label'], h1 + p, h1 + span",
  ).first();
  const text = candidates.text().replace(/\s+/g, " ").trim();
  if (!text || text.length > 70) return undefined;
  return text;
}

/** The one or two calls to action that sit next to the h1. */
function extractHeroActions($: CheerioAPI, baseUrl: string, origin: string): Action[] {
  const h1 = $("h1").first();
  const scope = h1.closest("section, header, div, article").first();
  const root = scope.length > 0 ? scope : $("body");
  const actions: Action[] = [];
  let inspected = 0;

  root.find("a[href], button").each((_, element) => {
    if (actions.length >= 2 || inspected >= 14) return;
    inspected += 1;

    const label = $(element).text().replace(/\s+/g, " ").trim();
    if (!label || label.length > 40) return;
    if (!CTA_PATTERN.test(label)) return;

    const href = $(element).attr("href");
    const resolved = href ? resolveHref(href, baseUrl) : null;
    if (!resolved || !resolved.startsWith(origin)) return;
    if (actions.some((action) => action.label === label)) return;

    actions.push({ label, href: resolved, style: actions.length === 0 ? "primary" : "outline" });
  });

  return actions;
}

export interface ExtractPageContext {
  origin: string;
  depth: number;
}

/** Turn one HTML document into a fully structured page. */
export function extractPage(
  html: string,
  url: string,
  context: ExtractPageContext,
): ScrapedPage {
  const $ = parseHtml(html);
  const meta = extractMeta($, url);
  const jsonLd = extractJsonLd($);
  const path = toPath(url);
  const warnings: string[] = [];

  const images = extractImages($, url);
  const links = extractLinks($, url, context.origin);

  // Thumbnails that link to a detail page, so a gallery can show the full-size
  // image instead of the postage stamp.
  const imageLinks: { src: string; href: string }[] = [];
  $("a[href] > img").each((_, element) => {
    const image = element as Element;
    const raw = pickImageSrc(image);
    const href = (image.parent as Element | null)?.attribs?.["href"];
    if (!raw || !href) return;

    const resolvedSrc = resolveHref(raw, url);
    const resolvedHref = resolveHref(href, url);
    if (resolvedSrc && resolvedHref) imageLinks.push({ src: resolvedSrc, href: resolvedHref });
  });
  const logo = extractLogo($, url, images);
  const contact = extractContact($, url, jsonLd);
  const socials = extractSocials($, url);

  // Chrome is read from the untouched document.
  const navigation = extractNavigation($, url, context.origin);
  const footer = extractFooter($, url, context.origin);

  // The content node is cloned so removing claimed blocks cannot affect chrome.
  const contentResult = extractContent($, url);
  const kind = classify(path, meta.title, contentResult.text, meta.description);
  const identity = extractBrandIdentity($, meta, jsonLd, context.origin);

  // Preferred heading: a real <h1>, then the first heading of any level (legacy
  // pages often start at <h4>), then the title with the site name removed so we
  // do not stamp "Acme Ltd | About us" across the hero.
  const firstHeading = contentResult.headings[0];
  const heroHeading =
    contentResult.headings.find((heading) => heading.level === 1)?.text ??
    (firstHeading && firstHeading.text.length >= 8 ? firstHeading.text : undefined) ??
    dropSiteName(meta.title, identity.name);

  // Hero image: the first plausible, non-logo image *in the page's content*.
  // Images from the site chrome (navigation buttons, banner strips) must never be
  // used here — stretched across a hero they look like an accident.
  const contentImages = extractImagesIn(findMainContent($), url);
  const heroImage = contentImages.find(
    (image) =>
      image.src !== logo?.src &&
      !/logo|icon|sprite|avatar/i.test(image.src) &&
      (!image.width || image.width >= 320),
  );

  const build = buildSections({
    content: stripHeroHeading(findMainContent($).clone(), heroHeading),
    baseUrl: url,
    origin: context.origin,
    jsonLd,
    kind,
    hero: {
      eyebrow: extractEyebrow($),
      heading: heroHeading,
      subheading: meta.description,
      ...(kind === "home" && heroImage ? { image: heroImage } : {}),
      actions: extractHeroActions($, url, context.origin),
    },
    contactRows: contactRowsFor(contact),
    warnings,
  });

  if (build.sections.length <= 1 && build.markdown.trim().length === 0) {
    warnings.push("No content could be extracted from this page.");
  }

  // Pages that are just a photo and a "back" link are gallery detail pages. They
  // migrate fine, but they are usually better folded into the gallery with this
  // URL redirected — a decision for the review pass, so flag it rather than guess.
  if (
    wordCount(contentResult.text) < 25 &&
    images.length > 0 &&
    /\b(back to|previous|next (image|photo)|back to gallery)\b/i.test(contentResult.text)
  ) {
    warnings.push(
      "Looks like a gallery detail page (one image and a back link). Consider folding it into a gallery section and redirecting this URL.",
    );
  }

  return {
    url,
    path,
    id: contentId(kind, path),
    kind,
    title: meta.title,
    description: meta.description,
    ...(meta.canonical ? { canonical: meta.canonical } : {}),
    ...(meta.lang ? { lang: meta.lang } : {}),
    headings: contentResult.headings,
    markdown: build.markdown,
    text: contentResult.text,
    images,
    links,
    sections: build.sections,
    contact,
    socials,
    imageLinks,
    contentImages,
    ...(meta.publishedAt ? { publishedAt: meta.publishedAt } : {}),
    ...(meta.updatedAt ? { updatedAt: meta.updatedAt } : {}),
    ...(meta.author ? { author: meta.author } : {}),
    tags: meta.tags,
    status: 200,
    depth: context.depth,
    warnings,
  };
}

/** Contact rows for the contact section, mirroring src/data/site.ts. */
function contactRowsFor(contact: ContactInfo): ContactDetail[] {
  const rows: ContactDetail[] = [];
  if (contact.phone) {
    rows.push({
      icon: "phone",
      label: "Phone",
      value: contact.phone,
      href: `tel:${contact.phone.replace(/[^\d+]/g, "")}`,
    });
  }
  if (contact.email) {
    rows.push({ icon: "mail", label: "Email", value: contact.email, href: `mailto:${contact.email}` });
  }

  const address = [contact.address.street, contact.address.city, contact.address.postalCode, contact.address.country]
    .filter(Boolean)
    .join(", ");
  if (address) rows.push({ icon: "map-pin", label: "Address", value: address });
  if (contact.hours.length > 0) {
    rows.push({
      icon: "clock",
      label: "Opening hours",
      value: contact.hours.map((entry) => entry.days).join(" · "),
    });
  }

  return rows;
}

/* -------------------------------------------------------------------------- *
 * Site chrome
 * -------------------------------------------------------------------------- */

export interface ChromeData {
  name: string;
  /** How the name was determined, so the generator can override a weak guess. */
  nameFrom: "structured" | "title" | "hostname";
  tagline: string;
  legalName: string;
  logo: ImageRef | null;
  contact: ContactInfo;
  socials: { label: string; href: string }[];
  navigation: NavItem[];
  footerLinks: { label: string; href: string }[];
  footerColumns: FooterColumn[];
  footerText: string;
  testimonials: Testimonial[];
  faqs: FaqItem[];
  logos: LogoItem[];
}

/**
 * Everything that belongs to the site rather than one page: identity, logo,
 * navigation, footer, contact details and the reusable testimonial/FAQ/logo sets.
 * Read from the home page, which is where a site keeps them.
 */
export function extractChrome(html: string, url: string, origin: string): ChromeData {
  const $ = parseHtml(html);
  const jsonLd = extractJsonLd($);
  const meta = extractMeta($, url);
  const identity = extractBrandIdentity($, meta, jsonLd, origin);
  const images = extractImages($, url);
  const scope = $("body") as unknown as Cheerio<Element>;
  const footer = extractFooter($, url, origin);

  return {
    name: identity.name,
    nameFrom: identity.nameFrom,
    tagline: identity.tagline,
    legalName: identity.legalName,
    logo: extractLogo($, url, images),
    contact: extractContact($, url, jsonLd),
    socials: extractSocials($, url),
    navigation: extractNavigation($, url, origin),
    footerLinks: footer.links,
    footerColumns: footer.columns,
    footerText: footer.text,
    testimonials: extractTestimonials(scope, jsonLd),
    faqs: extractFaqs(scope, jsonLd),
    logos: extractLogos(scope, url),
  };
}


export interface CrawlResult {
  origin: string;
  homepage: string;
  pages: ScrapedPage[];
  skipped: { url: string; reason: string }[];
  redirects: RedirectRecord[];
  cssTexts: string[];
  warnings: string[];
  /** Site-wide identity read from the home page. */
  chrome: ChromeData | null;
}

/**
 * Crawl the target site, returning one structured record per page.
 *
 * Crawlee handles concurrency, retries, politeness delays and robots.txt.
 * Cheerio (plain HTTP) is the default; `--render` switches to Playwright for
 * sites that build their pages in the browser.
 */
export async function crawlSite(
  options: Options,
  store: AssetStore,
  logger: Logger,
): Promise<CrawlResult> {
  const origin = new URL(options.url).origin;
  const pages: ScrapedPage[] = [];
  const skipped: { url: string; reason: string }[] = [];
  const redirects: RedirectRecord[] = [];
  const warnings: string[] = [];

  // Keep Crawlee's own storage beside the rest of this crawl's output.
  process.env["CRAWLEE_STORAGE_DIR"] = `${options.outDir}/crawlee`;

  const include = compilePattern(options.include);
  const excludes = options.exclude
    .map((pattern) => compilePattern(pattern))
    .filter((pattern): pattern is RegExp => pattern !== null);

  const shouldVisit = (url: string): boolean => {
    const path = toPath(url);
    if (isIgnoredPath(path)) return false;
    if (excludes.some((pattern) => pattern.test(path))) return false;
    if (include && !include.test(path)) return false;
    return true;
  };

  const discovery = await discoverUrls(origin, options.outDir);
  warnings.push(...discovery.warnings);
  logger.info(
    `URL discovery: ${discovery.urls.length} URL(s) from ${
      discovery.sources.length > 0 ? discovery.sources.join(", ") : "link following only"
    }`,
  );

  const seen = new Set<string>();
  /** Paths already queued for crawling, so `/` and `/index.html` are crawled once. */
  const queuedPaths = new Set<string>([toPath(options.url)]);
  /** Paths already turned into a page. */
  const crawledPaths = new Set<string>();
  const initialRequests: { url: string; userData: { depth: number } }[] = [
    { url: options.url, userData: { depth: 0 } },
  ];
  seen.add(options.url);

  for (const entry of discovery.urls) {
    const url = entry.url.replace(/\/$/, "");
    if (seen.has(url)) continue;

    // `/index.html` and `/` render the same page after normalisation.
    const path = toPath(url);
    if (queuedPaths.has(path)) {
      skipped.push({ url, reason: `same page as ${path}` });
      continue;
    }
    if (!shouldVisit(url)) {
      skipped.push({ url, reason: "excluded by filter" });
      continue;
    }

    seen.add(url);
    queuedPaths.add(path);
    initialRequests.push({ url, userData: { depth: 1 } });
  }

  logger.info(`Crawling up to ${options.maxPages} page(s)`);
  let homepageHtml = "";

  /** Shared page handling for both crawler flavours. */
  const handleHtml = async (
    html: string,
    loadedUrl: string,
    requestedUrl: string,
    depth: number,
  ): Promise<void> => {
    const url = loadedUrl.replace(/\/$/, "");

    if (!/<html|<!doctype|<body/i.test(html.slice(0, 4000))) {
      skipped.push({ url, reason: "not an HTML document" });
      return;
    }
    if (url !== requestedUrl.replace(/\/$/, "")) {
      redirects.push({ from: requestedUrl, to: url, reason: "source redirect" });
    }

    const page = extractPage(html, url, { origin, depth });

    // Two URLs can render the same page (`/` and `/index.html`); keep it once.
    if (crawledPaths.has(page.path)) {
      skipped.push({ url, reason: `duplicate of ${page.path}` });
      return;
    }
    crawledPaths.add(page.path);

    await localiseAssets(page, store);
    await writeText(`${options.outDir}/raw/${page.id.replace(/[^\w.-]+/g, "_")}.html`, html);

    pages.push(page);
    if (page.kind === "home" && !homepageHtml) homepageHtml = html;

    logger.info(
      `${page.path}  ${c.dim(
        [page.kind, `${wordCount(page.text)}w`, page.sections.map((s) => s.type).join("+")].join("  "),
      )}`,
    );
  };

  const sharedSettings = {
    maxRequestsPerCrawl: options.maxPages,
    maxConcurrency: options.concurrency,
    minConcurrency: 1,
    requestHandlerTimeoutSecs: 60,
    maxRequestRetries: 2,
    sameDomainDelaySecs: options.delayMs / 1000,
    respectRobotsTxtFile: options.respectRobots,
  };

  const depthOf = (request: { userData: unknown }): number =>
    Number((request.userData as { depth?: number } | undefined)?.depth ?? 0);

  /** Depth-limited link following, shared by both crawlers. */
  const makeTransform =
    (depth: number) =>
    (request: RequestOptions): RequestOptions | false => {
      const target = (normaliseUrl(request.url) ?? request.url).replace(/\/$/, "");
      if (!shouldVisit(target)) return false;
      if (seen.has(target)) return false;

      // Do not queue a second URL that resolves to a path we already have.
      const targetPath = toPath(target);
      if (queuedPaths.has(targetPath)) return false;

      seen.add(target);
      queuedPaths.add(targetPath);
      request.url = target;
      request.userData = { ...(request.userData as object), depth: depth + 1 };
      return request;
    };

  const onFailed = (request: { url: string }, error: unknown): void => {
    const message = error instanceof Error ? error.message : String(error);
    skipped.push({ url: request.url, reason: message });
    logger.warn(`Skipped ${request.url}: ${message}`);
  };

  try {
    if (options.render) {
      const { PlaywrightCrawler } = await import("crawlee");
      const crawler = new PlaywrightCrawler({
        ...sharedSettings,
        async requestHandler({ request, page, enqueueLinks }) {
          const depth = depthOf(request);
          await handleHtml(await page.content(), request.loadedUrl, request.url, depth);
          if (depth < options.maxDepth) {
            await enqueueLinks({
              strategy: "same-origin",
              transformRequestFunction: makeTransform(depth),
            });
          }
        },
        failedRequestHandler: ({ request, error }) => onFailed(request, error),
      });
      await crawler.run(initialRequests);
    } else {
      const { CheerioCrawler } = await import("crawlee");
      const crawler = new CheerioCrawler({
        ...sharedSettings,
        async requestHandler({ request, body, enqueueLinks }) {
          const depth = depthOf(request);
          const html = typeof body === "string" ? body : body.toString("utf8");
          await handleHtml(html, request.loadedUrl, request.url, depth);
          if (depth < options.maxDepth) {
            await enqueueLinks({
              strategy: "same-origin",
              transformRequestFunction: makeTransform(depth),
            });
          }
        },
        failedRequestHandler: ({ request, error }) => onFailed(request, error),
      });
      await crawler.run(initialRequests);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (options.render && /playwright/i.test(message)) {
      throw new Error(
        "JavaScript rendering needs Playwright:\n" +
          "  pnpm --filter ./tools/scraper add -D playwright\n" +
          "  pnpm --filter ./tools/scraper exec playwright install chromium\n\n" +
          `Original error: ${message}`,
      );
    }
    throw error;
  }

  const cssTexts = homepageHtml ? await collectStylesheets(homepageHtml, options.url) : [];
  logger.info(`Captured ${cssTexts.length} stylesheet(s) for brand detection`);

  // Now that every page is in hand, improve the gallery images.
  promoteGalleryThumbnails(pages, logger);

  // Site-wide identity and imagery, taken from the home page.
  const chrome = homepageHtml ? extractChrome(homepageHtml, options.url, origin) : null;
  if (chrome?.logo) {
    const local = await store.fetch(chrome.logo.src);
    if (local !== chrome.logo.src) chrome.logo = { ...chrome.logo, src: local };
  }
  for (const logo of chrome?.logos ?? []) {
    if (!logo.image) continue;
    const local = await store.fetch(logo.image.src);
    if (local !== logo.image.src) logo.image = { ...logo.image, src: local };
  }

  return { origin, homepage: options.url, pages, skipped, redirects, cssTexts, warnings, chrome };
}
