import type { Cheerio } from "cheerio";
import type { Element } from "domhandler";
import type {
  Action,
  ContactDetail,
  FaqItem,
  ImageRef,
  LogoItem,
  PageKind,
  PricingTier,
  Section,
  StatItem,
  StepItem,
  Testimonial,
} from "../types.ts";
import { resolveHref } from "../utils/url.ts";
import { nodeToMarkdown, normaliseWhitespace, textOf } from "./content.ts";
import { cleanLabel, looksLikeQuestion } from "./text.ts";

/**
 * Heuristics that recognise the repeatable blocks a marketing site is built
 * from. Every extractor is deliberately conservative: it only reports a block
 * when the markup matches a specific pattern, so a page with no recognisable
 * blocks becomes hero + prose rather than inventing structure that is not there.
 */

/** Elements whose class/id mentions any of these keywords. */
function byKeyword(scope: Cheerio<Element>, keywords: string[]): Cheerio<Element> {
  const selector = keywords
    .flatMap((keyword) => [`[class*='${keyword}']`, `[id*='${keyword}']`])
    .join(", ");
  return scope.find(selector) as unknown as Cheerio<Element>;
}

/** Text of the first matching descendant. */
function firstText(node: Cheerio<Element>, selector: string): string {
  return normaliseWhitespace((node.find(selector).first() as unknown as Cheerio<Element>).text());
}

/**
 * Wrap an element that was found inside `scope` as its own Cheerio collection.
 * Using the originating scope (rather than a global `$`) keeps every helper
 * operating on the same document.
 */
function wrap(scope: Cheerio<Element>, element: Element): Cheerio<Element> {
  return scope.find(element as never) as unknown as Cheerio<Element>;
}

/* -------------------------------------------------------------------------- *
 * FAQ
 * -------------------------------------------------------------------------- */

/** `<details>/<summary>` pairs — the most common accessible FAQ pattern. */
function faqFromDetails(scope: Cheerio<Element>): FaqItem[] {
  const items: FaqItem[] = [];

  scope.find("details").each((_, element) => {
    const node = wrap(scope, element as Element);
    const question = firstText(node, "summary") || firstText(node, "h2, h3, h4, button");
    if (!question || question.length < 6 || question.length > 220) return;

    const answerNode = node.clone();
    answerNode.find("summary").remove();
    const answer = normaliseWhitespace(answerNode.text());
    if (answer.length < 8) return;

    items.push({ question: cleanLabel(question), answer });
  });

  return items.slice(0, 12);
}

/** Headings phrased as questions, together with the prose that follows them. */
function faqFromHeadings(scope: Cheerio<Element>): FaqItem[] {
  const items: FaqItem[] = [];

  scope.find("h2, h3, h4").each((_, element) => {
    const node = wrap(scope, element as Element);
    const question = normaliseWhitespace(node.text());
    if (!question || !looksLikeQuestion(question) || question.length > 220) return;

    // Collect sibling text up to the next heading of the same level or higher.
    const level = Number.parseInt((element as Element).tagName.replace(/[^\d]/g, ""), 10) || 3;
    let sibling = node.next();
    let answer = "";
    let guard = 0;

    while (sibling.length > 0 && guard < 12) {
      const tag = (sibling.get(0) as Element | undefined)?.tagName.toUpperCase() ?? "";
      const siblingLevel = /^H(\d)$/.exec(tag)?.[1];
      if (siblingLevel && Number.parseInt(siblingLevel, 10) <= level) break;
      if (tag === "H1") break;

      answer += ` ${textOf(sibling)}`;
      sibling = sibling.next();
      guard += 1;
    }

    const trimmed = normaliseWhitespace(answer);
    if (trimmed.length < 10) return;
    items.push({ question: cleanLabel(question), answer: trimmed.slice(0, 1200) });
  });

  return items.slice(0, 12);
}

export function extractFaqs(
  scope: Cheerio<Element>,
  jsonLd: Record<string, unknown>[],
): FaqItem[] {
  const items: FaqItem[] = [];

  // FAQPage structured data is the most reliable source when it exists.
  for (const node of jsonLd) {
    const entities = node["mainEntity"];
    if (!Array.isArray(entities)) continue;
    for (const entity of entities) {
      if (!entity || typeof entity !== "object") continue;
      const record = entity as Record<string, unknown>;
      const question = typeof record["name"] === "string" ? record["name"] : "";
      const accepted = record["acceptedAnswer"];
      const answer =
        accepted && typeof accepted === "object"
          ? String((accepted as Record<string, unknown>)["text"] ?? "")
          : "";
      if (question && answer) {
        items.push({ question: cleanLabel(question), answer: normaliseWhitespace(answer) });
      }
    }
  }

  if (items.length === 0) items.push(...faqFromDetails(scope));
  if (items.length === 0) items.push(...faqFromHeadings(scope));

  const unique = items.filter(
    (item, index) => items.findIndex((other) => other.question === item.question) === index,
  );

  return unique.filter((item) => item.answer.length > 10).slice(0, 10);
}

/* -------------------------------------------------------------------------- *
 * Testimonials
 * -------------------------------------------------------------------------- */

export function extractTestimonials(
  scope: Cheerio<Element>,
  jsonLd: Record<string, unknown>[],
): Testimonial[] {
  const items: Testimonial[] = [];

  const push = (testimonial: Testimonial) => {
    if (testimonial.quote.length < 20) return;
    if (items.some((existing) => existing.quote === testimonial.quote)) return;
    items.push(testimonial);
  };

  for (const node of jsonLd) {
    const reviews = Array.isArray(node["review"]) ? node["review"] : [];
    for (const review of reviews) {
      if (!review || typeof review !== "object") continue;
      const record = review as Record<string, unknown>;
      const body =
        typeof record["reviewBody"] === "string"
          ? record["reviewBody"]
          : typeof record["description"] === "string"
            ? record["description"]
            : "";
      const authorNode = record["author"];
      const author =
        authorNode && typeof authorNode === "object"
          ? String((authorNode as Record<string, unknown>)["name"] ?? "")
          : "";
      const ratingNode = record["reviewRating"];
      const rating =
        ratingNode && typeof ratingNode === "object"
          ? Number((ratingNode as Record<string, unknown>)["ratingValue"])
          : Number.NaN;

      push({
        quote: normaliseWhitespace(body),
        name: cleanLabel(author) || "A customer",
        ...(Number.isFinite(rating) ? { rating: Math.min(Math.max(rating, 1), 5) } : {}),
      });
    }
  }

  // Blockquotes, with attribution taken from the surrounding markup.
  scope.find("blockquote").each((_, element) => {
    const node = wrap(scope, element as Element);
    const quote = normaliseWhitespace(node.text());
    if (quote.length < 30 || quote.length > 900) return;

    const parent = node.parent() as unknown as Cheerio<Element>;
    const attribution =
      firstText(node, "cite, footer") ||
      firstText(parent, "cite, .author, .name, figcaption, figcaton");

    const [first = "", ...rest] = attribution.split(/[,–—]/);
    push({
      quote,
      name: cleanLabel(first) || "A customer",
      ...(rest.length > 0 ? { role: cleanLabel(rest.join(",")) } : {}),
    });
  });

  // Elements explicitly marked up as testimonials or reviews.
  byKeyword(scope, ["testimonial", "review", "quote"]).each((_, element) => {
    const node = wrap(scope, element as Element);
    const quote = firstText(node, "p, blockquote, .text, .body");
    if (quote.length < 30 || quote.length > 900) return;

    const name = cleanLabel(
      firstText(node, ".name, .author, cite, strong, h4, h5, figcaption") || "A customer",
    );
    const role = cleanLabel(firstText(node, ".role, .title, .position, .company, .job"));

    push({
      quote,
      name: name.length > 60 ? "A customer" : name,
      ...(role && role.length < 60 ? { role } : {}),
    });
  });

  return items.slice(0, 9);
}

/* -------------------------------------------------------------------------- *
 * Stats
 * -------------------------------------------------------------------------- */

/** Short numeric strings that plausibly represent a headline figure. */
const STAT_VALUE = /^(?:[£$€]\s?)?\d[\d.,]*\s?(?:%|k|m|bn|x|plus|\+|\/7|★)?$/i;

export function extractStats(scope: Cheerio<Element>): StatItem[] {
  const items: StatItem[] = [];

  byKeyword(scope, ["stat", "counter", "figure", "metric"])
    .filter((_, element) => {
      const tag = (element as Element).tagName.toLowerCase();
      return tag !== "script" && tag !== "style" && tag !== "body" && tag !== "html";
    })
    .each((_, element) => {
      const node = wrap(scope, element as Element);
      if (textOf(node).length > 160) return;

      // The value is the number-like line; the label is the next distinct line.
      const pieces = node
        .find("span, strong, b, h2, h3, h4, p, div")
        .map((__, child) => normaliseWhitespace(wrap(node, child as Element).text()))
        .get()
        .filter((piece): piece is string => Boolean(piece) && piece.length < 60);

      const value = pieces.find((piece) => STAT_VALUE.test(piece));
      if (!value) return;

      const label = pieces.find((piece) => piece !== value && !STAT_VALUE.test(piece));
      if (!label || label.length > 80 || label.length < 3) return;
      if (items.some((item) => item.value === value)) return;

      items.push({ value, label: cleanLabel(label) });
    });

  return items.slice(0, 4);
}

/* -------------------------------------------------------------------------- *
 * Steps, pricing, logos
 * -------------------------------------------------------------------------- */

/** Ordered lists of three or more short items read as a process. */
export function extractSteps(scope: Cheerio<Element>): StepItem[] {
  let best: StepItem[] = [];

  scope.find("ol").each((_, element) => {
    const list = wrap(scope, element as Element);
    const items = list.children("li");
    if (items.length < 3 || items.length > 9) return;

    const collected: StepItem[] = [];
    items.each((__, li) => {
      const item = wrap(list, li as Element);
      const title =
        firstText(item, "h3, h4, strong, b, .title, .step-title") ||
        normaliseWhitespace(item.find("span").first().text());
      if (!title || title.length > 90) return;

      const bodyNode = item.clone();
      bodyNode.find("h3, h4, strong, b, .title, .step-title").remove();
      const body = normaliseWhitespace(bodyNode.text());

      collected.push({
        title: cleanLabel(title),
        ...(body.length > 12 ? { body: body.slice(0, 240) } : {}),
      });
    });

    if (collected.length >= 3 && collected.length > best.length) best = collected;
  });

  return best.slice(0, 6);
}

const PRICE_TEXT = /(?:[£$€]\s?\d[\d,.]*|\d[\d,.]*\s?(?:[£$€]|per month|per year|\/mo|\/yr))/i;

/** Card-like blocks that carry a currency amount and a feature list. */
export function extractPricing(scope: Cheerio<Element>): PricingTier[] {
  const tiers: PricingTier[] = [];

  byKeyword(scope, ["price", "plan", "package", "tier", "membership"])
    .filter((_, element) => !/^(body|html|main|section|header|footer)$/i.test((element as Element).tagName))
    .each((_, element) => {
      const node = wrap(scope, element as Element);
      if (textOf(node).length > 1200) return;

      let price = "";
      node.find("*").each((__, child) => {
        if (price) return;
        const text = normaliseWhitespace(wrap(node, child as Element).text());
        if (text.length <= 26 && PRICE_TEXT.test(text)) price = text;
      });

      const name = firstText(node, "h2, h3, h4, h5, .title, .name, .plan-name");
      if (!name || name.length > 60) return;

      const features = node
        .find("li")
        .map((__, li) => normaliseWhitespace(wrap(node, li as Element).text()))
        .get()
        .filter((feature): feature is string => Boolean(feature) && feature.length > 2 && feature.length < 90)
        .slice(0, 8);

      if (!price && features.length === 0) return;
      if (tiers.some((tier) => tier.name === cleanLabel(name))) return;

      tiers.push({
        name: cleanLabel(name),
        ...(price ? { price } : {}),
        features,
      });
    });

  return tiers.slice(0, 4);
}

/** Client/partner logos, from a container that advertises them. */
export function extractLogos(scope: Cheerio<Element>, baseUrl: string): LogoItem[] {
  // Only look inside containers that are explicitly about clients/partners. A
  // page's other images (navigation buttons, illustrations, photos) are not a
  // logo strip, and guessing otherwise produces nonsense on legacy sites.
  const containers = byKeyword(scope, ["client", "partner", "trust", "as-seen", "logos"]);
  if (containers.length === 0) return [];

  const items: LogoItem[] = [];

  containers.find("img").each((_, element) => {
    const el = element as Element;
    const raw = el.attribs?.["src"] ?? el.attribs?.["data-src"];
    if (!raw) return;

    const resolved = resolveHref(raw, baseUrl);
    if (!resolved) return;

    // The alt text is what tells us which brand this is.
    const alt = normaliseWhitespace(el.attribs?.["alt"] ?? "");
    const name = alt || cleanLabel(decodeURIComponent(resolved.split("/").pop() ?? "").replace(/\.[a-z0-9]+$/i, ""));
    if (!name || name.length > 60) return;
    if (/logo|image|placeholder|banner|icon/i.test(name) && !alt) return;
    if (items.some((item) => item.name.toLowerCase() === name.toLowerCase())) return;

    items.push({ name, image: { src: resolved, alt: alt || name } });
  });

  return items.slice(0, 8);
}

/* -------------------------------------------------------------------------- *
 * Composition — turn a page's markup into the section vocabulary the Astro site
 * renders.
 * -------------------------------------------------------------------------- */

export interface HeroInput {
  eyebrow?: string;
  heading: string;
  subheading?: string;
  image?: ImageRef;
  actions: Action[];
}

export interface BuildContext {
  /** The page's main content node. Claimed blocks are removed from it. */
  content: Cheerio<Element>;
  baseUrl: string;
  origin: string;
  jsonLd: Record<string, unknown>[];
  kind: PageKind;
  hero: HeroInput;
  contactRows: ContactDetail[];
  /** Warnings the caller surfaces in the migration report. */
  warnings: string[];
}

/** Upper bound on images in one gallery block. */
const MAX_GALLERY_IMAGES = 30;

export interface BuildResult {
  sections: Section[];
  /** Markdown of whatever the block extractors did not claim. */
  markdown: string;
  blockTypes: string[];
}

/** Images inside a gallery-like container, or linked thumbnails. */
function galleryImages(scope: Cheerio<Element>, baseUrl: string): ImageRef[] {
  const images: ImageRef[] = [];

  const add = (element: Element) => {
    const raw = element.attribs?.["src"] ?? element.attribs?.["data-src"];
    const resolved = raw ? resolveHref(raw, baseUrl) : null;
    if (!resolved || images.some((image) => image.src === resolved)) return;
    images.push({ src: resolved, alt: normaliseWhitespace(element.attribs?.["alt"] ?? "") });
  };

  const containers = byKeyword(scope, ["gallery", "carousel", "slider", "masonry", "lightbox"]);
  if (containers.length > 0) {
    containers.find("img").each((_, element) => add(element as Element));
    return images;
  }

  // No gallery container: on a classic site the gallery is a grid of thumbnails
  // that each link to a page showing the full image. Four or more linked images is
  // that pattern, and not a stray illustration in a paragraph.
  const linked: Element[] = [];
  scope.find("a[href] > img").each((_, element) => {
    linked.push(element as Element);
  });
  if (linked.length >= 4) {
    for (const element of linked) add(element);
    return images;
  }

  return [];
}

/**
 * Compose a page from the blocks found in its markup.
 *
 * Each extractor runs against the live content node and, when it succeeds, the
 * elements it claimed are removed, so the prose that follows never duplicates
 * them. Thresholds are deliberately above one item: a single blockquote or
 * `<details>` should not become a whole section.
 */
export function buildSections(context: BuildContext): BuildResult {
  const scope = context.content;
  const sections: Section[] = [];
  const blockTypes: string[] = [];

  const hero: Section = {
    type: "hero",
    ...(context.hero.eyebrow ? { eyebrow: context.hero.eyebrow } : {}),
    heading: context.hero.heading,
    ...(context.hero.subheading ? { subheading: context.hero.subheading } : {}),
    ...(context.hero.image ? { image: context.hero.image } : {}),
    actions: context.hero.actions,
    variant: context.hero.image ? "split" : "centered",
    align: context.hero.image ? "left" : "center",
  };

  // --- Hero --------------------------------------------------------------
  // The hero is rebuilt from the h1 (and its container when that container is
  // clearly just a banner), so remove it from the working content. Otherwise the
  // same heading and intro would reappear in the prose below.
  const heroHeadingNode = scope.find("h1").first();
  if (heroHeadingNode.length > 0) {
    const container = heroHeadingNode.closest("section, header, article, div");
    const containerText = container.length > 0 ? textOf(container as unknown as Cheerio<Element>) : "";
    const containerSignal = container.attr("class") ?? container.attr("id") ?? "";
    const isBanner =
      /hero|banner|masthead|jumbotron|intro/i.test(containerSignal) ||
      (containerText.length < 600 && /^(section|header)$/i.test((container.get(0) as Element | undefined)?.tagName ?? ""));

    if (container.length > 0 && isBanner) container.remove();
    else heroHeadingNode.remove();
  }

  // --- Logos -------------------------------------------------------------
  const logos = extractLogos(scope, context.baseUrl);
  if (logos.length >= 3) {
    sections.push({ type: "logos", heading: "Trusted by", items: logos });
    blockTypes.push("logos");
    byKeyword(scope, ["client", "partner", "trust", "as-seen", "logos"]).remove();
  }

  // --- Stats -------------------------------------------------------------
  const stats = extractStats(scope);
  if (stats.length >= 2) {
    sections.push({ type: "stats", heading: "By the numbers", items: stats });
    blockTypes.push("stats");
    byKeyword(scope, ["stat", "counter", "figure", "metric"]).remove();
  }

  // --- Steps -------------------------------------------------------------
  const steps = extractSteps(scope);
  if (steps.length >= 3) {
    sections.push({ type: "steps", heading: "How it works", items: steps });
    blockTypes.push("steps");
    scope
      .find("ol")
      .filter((_, element) => wrap(scope, element as Element).children("li").length >= 3)
      .remove();
  }

  // --- Gallery -----------------------------------------------------------
  const gallery = galleryImages(scope, context.baseUrl);
  if (gallery.length >= 3) {
    // Cap the count so a page with hundreds of product images cannot blow up the
    // content file — but never silently: dropping photos loses real content.
    const images = gallery.slice(0, MAX_GALLERY_IMAGES);
    if (gallery.length > images.length) {
      context.warnings.push(
        `Gallery has ${gallery.length} images; kept the first ${images.length}. Add the rest by hand if they matter.`,
      );
    }

    sections.push({ type: "gallery", heading: "Gallery", columns: 3, images });
    blockTypes.push("gallery");
    byKeyword(scope, ["gallery", "carousel", "slider", "masonry", "lightbox"]).remove();
  }

  // --- Pricing -----------------------------------------------------------
  const tiers = extractPricing(scope);
  if (tiers.length >= 2) {
    sections.push({ type: "pricing", heading: "Pricing", tiers });
    blockTypes.push("pricing");
    byKeyword(scope, ["price", "plan", "package", "tier", "membership"]).remove();
  }

  // --- Testimonials ------------------------------------------------------
  const testimonials = extractTestimonials(scope, context.jsonLd);
  if (testimonials.length >= 2) {
    sections.push({
      type: "testimonials",
      heading: "What our clients say",
      columns: Math.min(testimonials.length, 3),
      items: testimonials,
    });
    blockTypes.push("testimonials");
    scope.find("blockquote").remove();
    byKeyword(scope, ["testimonial", "review", "quote"]).remove();
  }

  // --- FAQ ---------------------------------------------------------------
  const faqs = extractFaqs(scope, context.jsonLd);
  if (faqs.length >= 2) {
    sections.push({ type: "faq", heading: "Frequently asked questions", items: faqs });
    blockTypes.push("faq");
    scope.find("details").remove();
    byKeyword(scope, ["faq", "accordion"]).remove();
  }

  // --- Whatever is left becomes prose ------------------------------------
  const remaining = nodeToMarkdown(scope, context.baseUrl);
  const words = remaining.text.split(/\s+/).filter(Boolean).length;
  if (words >= 25 || (sections.length === 0 && remaining.markdown.trim())) {
    sections.push({ type: "richText", body: remaining.markdown.trim() });
    blockTypes.push("richText");
  }

  // --- Contact -----------------------------------------------------------
  if (context.kind === "contact") {
    sections.push({
      type: "contact",
      eyebrow: "Contact",
      heading: "Get in touch",
      details: context.contactRows,
    });
    blockTypes.push("contact");
  }

  return { sections: [hero, ...sections], markdown: remaining.markdown, blockTypes };
}

