import { load, type Cheerio, type CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import type { Heading, ImageRef, PageLink } from "../types.ts";
import { resolveHref } from "../utils/url.ts";

/**
 * Boilerplate that is never part of the article body. Removing it before the
 * Markdown conversion is what stops menus and cookie banners leaking into the
 * migrated content.
 */
const STRIP_SELECTORS = [
  "script",
  "style",
  "noscript",
  "template",
  "svg",
  "canvas",
  "iframe",
  "form",
  "nav",
  "header",
  "footer",
  "aside",
  "button",
  "dialog",
  "[role='navigation']",
  "[role='banner']",
  "[role='contentinfo']",
  "[role='search']",
  "[aria-hidden='true']",
  "[hidden]",
  "[class*='cookie']",
  "[class*='consent']",
  "[class*='gdpr']",
  "[class*='newsletter']",
  "[class*='social']",
  "[class*='share']",
  "[class*='breadcrumb']",
  "[class*='pagination']",
  "[class*='sidebar']",
  "[class*='skip-link']",
  "[class*='sr-only']",
  "[id*='cookie']",
  "[id*='newsletter']",
];

/** Candidates for the article body, most specific first, with a score bonus. */
const CONTENT_CANDIDATES: { selector: string; bonus: number }[] = [
  { selector: "main", bonus: 1200 },
  { selector: "[role='main']", bonus: 1100 },
  { selector: "article", bonus: 1000 },
  { selector: ".entry-content", bonus: 900 },
  { selector: ".post-content", bonus: 900 },
  { selector: ".page-content", bonus: 800 },
  { selector: "#content", bonus: 700 },
  { selector: "#main", bonus: 650 },
  { selector: ".content", bonus: 400 },
  { selector: ".container", bonus: 100 },
  { selector: "body", bonus: 0 },
];

export function normaliseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/** Text of a node as a single normalised line. */
export function textOf(node: Cheerio<Element>): string {
  return normaliseWhitespace(node.text());
}

/** Ratio of link text to total text — high values indicate navigation, not prose. */
function linkDensity(node: Cheerio<Element>): number {
  const total = textOf(node).length;
  if (total === 0) return 1;

  const links = node.find("a");
  let linkText = 0;
  for (let index = 0; index < links.length; index += 1) {
    linkText += textOf(links.eq(index) as Cheerio<Element>).length;
  }

  return Math.min(linkText / total, 1);
}

/**
 * Pick the element that most likely holds the page's real content by scoring
 * text length against link density, then preferring semantic landmarks.
 */
export function findMainContent($: CheerioAPI): Cheerio<Element> {
  let bestNode: Cheerio<Element> | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const { selector, bonus } of CONTENT_CANDIDATES) {
    $(selector).each((_, element) => {
      const node = $(element) as unknown as Cheerio<Element>;
      const text = textOf(node);
      if (text.length < 80) return;

      // Paragraph count is a stronger signal of an article than raw characters.
      const paragraphs = node.find("p").length;
      const score =
        text.length * (1 - linkDensity(node)) + paragraphs * 40 + bonus - node.find("li").length * 5;

      if (score > bestScore) {
        bestScore = score;
        bestNode = node;
      }
    });
  }

  return bestNode ?? ($("body") as unknown as Cheerio<Element>);
}

function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    hr: "---",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
    emDelimiter: "*",
    strongDelimiter: "**",
    linkStyle: "inlined",
  });

  service.use(gfm);

  // Drop decorative images that carry no information.
  service.addRule("skipEmptyImages", {
    filter: (node) => node.nodeName === "IMG",
    replacement: (_content, node) => {
      const element = node as unknown as Element;
      const src = element.attribs?.["src"] ?? "";
      const alt = element.attribs?.["alt"] ?? "";
      if (!src || /^data:/i.test(src)) return "";
      return alt ? `![${alt}](${src})` : "";
    },
  });

  // Anchors without a URL should not become links.
  service.addRule("anchorWithoutHref", {
    filter: (node) => node.nodeName === "A" && !(node as unknown as Element).attribs?.["href"],
    replacement: (content) => content,
  });

  return service;
}

const turndown = createTurndown();

export interface ContentResult {
  html: string;
  markdown: string;
  text: string;
  headings: Heading[];
}

/**
 * Convert one node to Markdown, resolving relative URLs and stripping
 * boilerplate first. Shared by full-page extraction and block composition (which
 * needs to re-render whatever the block extractors did not claim).
 */
export function nodeToMarkdown(node: Cheerio<Element>, baseUrl: string): {
  markdown: string;
  text: string;
  html: string;
  headings: Heading[];
} {
  const clone = node.clone();

  for (const selector of STRIP_SELECTORS) {
    clone.find(selector).remove();
  }

  // Make every URL absolute so the Markdown is portable.
  clone.find("a[href]").each((_, anchor) => {
    const el = anchor as Element;
    const resolved = resolveHref(el.attribs?.["href"] ?? "", baseUrl);
    if (resolved && el.attribs) el.attribs["href"] = resolved;
  });
  clone.find("img").each((_, image) => {
    const el = image as Element;
    const src = pickImageSrc(el);
    if (src && el.attribs) el.attribs["src"] = src;
  });

  const html = clone.html() ?? "";

  return {
    html,
    markdown: tidyMarkdown(turndown.turndown(html)),
    text: normaliseWhitespace(clone.text()),
    headings: extractHeadings(clone),
  };
}

/**
 * Convert the chosen content element to Markdown, resolving relative URLs and
 * stripping boilerplate first.
 */
export function extractContent(
  $: CheerioAPI,
  baseUrl: string,
  element?: Cheerio<Element>,
): ContentResult {
  const content = element ?? findMainContent($);
  return nodeToMarkdown(content, baseUrl);
}

/** Collapse the leftover blank lines and stray list markers Turndown produces. */
export function tidyMarkdown(markdown: string): string {
  return markdown
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^[-*]\s*$/gm, "")
    .replace(/(\n\s*){3,}/g, "\n\n")
    .trim();
}

export function extractHeadings(node: Cheerio<Element>): Heading[] {
  const headings: Heading[] = [];

  node.find("h1, h2, h3").each((_, element) => {
    const el = element as Element;
    const text = normaliseWhitespace((node.find(el as never) as unknown as Cheerio<Element>).text());
    if (!text) return;

    const level = Number.parseInt(el.tagName.replace(/[^\d]/g, ""), 10) || 2;
    const id = el.attribs?.["id"];
    headings.push({ level, text, ...(id ? { id } : {}) });
  });

  return headings;
}

/**
 * Real image URL for an `<img>`, preferring lazy-loading attributes and
 * ignoring data URIs and tracking pixels.
 */
export function pickImageSrc(element: Element): string | null {
  const attrs = element.attribs ?? {};
  const candidates = [
    attrs["src"],
    attrs["data-src"],
    attrs["data-lazy-src"],
    attrs["data-original"],
    attrs["data-srcset"]?.split(",")[0]?.trim().split(" ")[0],
    attrs["srcset"]?.split(",")[0]?.trim().split(" ")[0],
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;
    if (/^data:/i.test(candidate)) continue;
    if (/(spacer|pixel|blank|1x1|tracking)/i.test(candidate)) continue;
    return candidate;
  }

  return null;
}

/** All content images on the page, resolved to absolute URLs. */
export function extractImages($: CheerioAPI, baseUrl: string): ImageRef[] {
  const images: ImageRef[] = [];
  const seen = new Set<string>();

  $("img").each((_, element) => {
    const el = element as Element;
    const raw = pickImageSrc(el);
    if (!raw) return;

    const resolved = resolveHref(raw, baseUrl) ?? (/^https?:/i.test(raw) ? raw : null);
    if (!resolved || seen.has(resolved)) return;

    const width = Number.parseInt(el.attribs?.["width"] ?? "", 10);
    const height = Number.parseInt(el.attribs?.["height"] ?? "", 10);
    const alt = normaliseWhitespace(el.attribs?.["alt"] ?? "");

    // Ignore thumbnails far too small to be real content.
    if (Number.isFinite(width) && width > 0 && width < 48) return;

    seen.add(resolved);
    images.push({
      src: resolved,
      alt,
      ...(Number.isFinite(width) && width > 0 ? { width } : {}),
      ...(Number.isFinite(height) && height > 0 ? { height } : {}),
    });
  });

  return images;
}

/** All anchors on the page, split into internal and external. */
export function extractLinks($: CheerioAPI, baseUrl: string, origin: string): PageLink[] {
  const links: PageLink[] = [];
  const seen = new Set<string>();

  $("a[href]").each((_, element) => {
    const el = element as Element;
    const href = el.attribs?.["href"];
    if (!href) return;

    const resolved = resolveHref(href, baseUrl);
    if (!resolved || seen.has(resolved)) return;

    const label = textOf($(el as never) as unknown as Cheerio<Element>) || el.attribs?.["title"] || "";
    seen.add(resolved);
    links.push({ href: resolved, label, external: !resolved.startsWith(origin) });
  });

  return links;
}

/** Parse one HTML document. Exported so tests can drive extraction directly. */
export function parseHtml(html: string): CheerioAPI {
  return load(html);
}
