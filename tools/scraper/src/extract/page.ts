import type { Cheerio, CheerioAPI } from "cheerio";
import type { Element } from "domhandler";
import type { ContactInfo, FooterColumn, ImageRef, NavChild, NavItem } from "../types.ts";
import { resolveHref } from "../utils/url.ts";
import { normaliseWhitespace, textOf } from "./content.ts";
import { cleanLabel, humanise, parseDate, truncate } from "./text.ts";

/** Host -> display name, used to rebuild a social link list. */
const SOCIAL_HOSTS: Record<string, string> = {
  "facebook.com": "Facebook",
  "instagram.com": "Instagram",
  "linkedin.com": "LinkedIn",
  "x.com": "X",
  "twitter.com": "X",
  "youtube.com": "YouTube",
  "youtu.be": "YouTube",
  "tiktok.com": "TikTok",
  "pinterest.com": "Pinterest",
  "github.com": "GitHub",
  "vimeo.com": "Vimeo",
  "wa.me": "WhatsApp",
  "whatsapp.com": "WhatsApp",
  "threads.net": "Threads",
  "mastodon.social": "Mastodon",
};

export interface PageMeta {
  title: string;
  description: string;
  canonical?: string;
  lang?: string;
  ogImage?: string;
  siteName?: string;
  publishedAt?: string;
  updatedAt?: string;
  author?: string;
  tags: string[];
}

export interface PageChrome {
  navigation: NavItem[];
  footerLinks: { label: string; href: string }[];
  footerColumns: FooterColumn[];
  footerText: string;
  socials: { label: string; href: string }[];
  contact: ContactInfo;
  logo: ImageRef | null;
  jsonLd: Record<string, unknown>[];
}

/** Resolve a possibly-relative URL, returning null when it is not http(s). */
function absoluteFor(raw: string | undefined, baseUrl: string): string | null {
  return raw ? resolveHref(raw, baseUrl) : null;
}

/** Title, meta description, canonical, language and publish dates. */
export function extractMeta($: CheerioAPI, baseUrl: string): PageMeta {
  const meta = (selector: string): string | undefined => {
    const value = $(selector).first().attr("content");
    return value ? normaliseWhitespace(value) : undefined;
  };

  const h1 = normaliseWhitespace($("h1").first().text());
  const rawTitle = meta("meta[property='og:title']") ?? normaliseWhitespace($("title").first().text());
  const siteName = meta("meta[property='og:site_name']");

  // Drop a trailing "| Site name" / "- Site name" from the title.
  let title = rawTitle ?? h1;
  if (siteName && title.endsWith(siteName)) {
    title = title.slice(0, -siteName.length).replace(/[\s|•–—-]+$/, "").trim();
  }
  if (!title) title = h1 || "Untitled page";

  const description =
    meta("meta[name='description']") ??
    meta("meta[property='og:description']") ??
    truncate(normaliseWhitespace($("main p").first().text()), 158);

  const published =
    meta("meta[property='article:published_time']") ??
    meta("meta[name='date']") ??
    $("time[datetime]").first().attr("datetime");

  const updated =
    meta("meta[property='article:modified_time']") ??
    meta("meta[name='last-modified']") ??
    $("time[datetime]").last().attr("datetime");

  const author = meta("meta[name='author']") ?? normaliseWhitespace($("[rel='author']").first().text());

  const tags = $("a[rel='tag'], .tags a, [class*='tag'] a")
    .map((_, element) => normaliseWhitespace($(element).text()))
    .get()
    .filter((tag): tag is string => Boolean(tag) && tag.length < 40)
    .slice(0, 8);

  const canonical = absoluteFor($("link[rel='canonical']").first().attr("href"), baseUrl);
  const ogImage = absoluteFor(meta("meta[property='og:image']"), baseUrl);
  const lang = $("html").attr("lang");
  const publishedAt = parseDate(published);
  const updatedAt = parseDate(updated);

  return {
    title: normaliseWhitespace(title),
    description: truncate(description ?? "", 158),
    ...(canonical ? { canonical } : {}),
    ...(lang ? { lang: lang.split("-")[0] ?? lang } : {}),
    ...(ogImage ? { ogImage } : {}),
    ...(siteName ? { siteName } : {}),
    ...(publishedAt ? { publishedAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(author ? { author } : {}),
    tags,
  };
}

/** Every `application/ld+json` block, flattened out of `@graph` wrappers. */
export function extractJsonLd($: CheerioAPI): Record<string, unknown>[] {
  const nodes: Record<string, unknown>[] = [];

  $("script[type='application/ld+json']").each((_, element) => {
    const raw = $(element).text();
    if (!raw.trim()) return;
    try {
      const parsed: unknown = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const item of list) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const graph = record["@graph"];
        if (Array.isArray(graph)) {
          for (const entry of graph) {
            if (entry && typeof entry === "object") nodes.push(entry as Record<string, unknown>);
          }
        } else {
          nodes.push(record);
        }
      }
    } catch {
      // Malformed structured data is common on the web; ignore it.
    }
  });

  return nodes;
}

function socialLabelFor(host: string): string | null {
  const bare = host.replace(/^www\./, "");
  for (const [domain, label] of Object.entries(SOCIAL_HOSTS)) {
    if (bare === domain || bare.endsWith(`.${domain}`)) return label;
  }
  return null;
}

/** Links that point at known social platforms, deduplicated by platform. */
export function extractSocials($: CheerioAPI, baseUrl: string): { label: string; href: string }[] {
  const seen = new Map<string, string>();

  $("a[href]").each((_, element) => {
    const href = (element as Element).attribs?.["href"];
    if (!href) return;
    const resolved = resolveHref(href, baseUrl);
    if (!resolved) return;

    const label = socialLabelFor(new URL(resolved).hostname);
    if (label && !seen.has(label)) seen.set(label, resolved);
  });

  return [...seen.entries()].map(([label, href]) => ({ label, href }));
}

/**
 * Primary navigation: from every nav-like list on the page we keep the one with
 * the most internal links, which is reliably the main menu rather than a footer
 * or a sidebar.
 */
export function extractNavigation($: CheerioAPI, baseUrl: string, origin: string): NavItem[] {
  let bestLinks: { label: string; href: string }[] = [];

  $("header nav, nav, header ul, [role='navigation'] ul").each((_, scope) => {
    const links: { label: string; href: string }[] = [];

    $(scope)
      .children("li")
      .each((__, li) => {
        const anchor = $(li).children("a").first();
        const resolved = absoluteFor(anchor.attr("href"), baseUrl);
        const label = normaliseWhitespace(anchor.text());
        if (!resolved || !resolved.startsWith(origin)) return;
        if (!label || label.length > 40) return;
        if (socialLabelFor(new URL(resolved).hostname)) return;
        links.push({ label: cleanLabel(label), href: resolved });
      });

    if (links.length > bestLinks.length) bestLinks = links;
  });

  return bestLinks.slice(0, 8).map((link) => ({ label: link.label, href: link.href }));
}

/** Sub-navigation for the current page, used to give a parent item children. */
export function extractChildren($: CheerioAPI, baseUrl: string, origin: string): NavChild[] {
  const children: NavChild[] = [];

  $("aside a[href], .subnav a[href], .sidebar a[href]").each((_, element) => {
    const el = element as Element;
    const resolved = absoluteFor(el.attribs?.["href"], baseUrl);
    if (!resolved || !resolved.startsWith(origin)) return;

    const label = normaliseWhitespace($(el as never).text());
    if (!label || label.length > 40) return;
    if (children.some((child) => child.href === resolved)) return;
    children.push({ label: cleanLabel(label), href: resolved });
  });

  return children.slice(0, 8);
}

/** Footer links, grouped by the heading that precedes each list. */
export function extractFooter(
  $: CheerioAPI,
  baseUrl: string,
  origin: string,
): { links: { label: string; href: string }[]; columns: FooterColumn[]; text: string } {
  const footer = $("footer").last();
  const scope = footer.length > 0 ? footer : $("body");

  const links: { label: string; href: string }[] = [];
  scope.find("a[href]").each((_, element) => {
    const el = element as Element;
    const resolved = absoluteFor(el.attribs?.["href"], baseUrl);
    if (!resolved || !resolved.startsWith(origin)) return;

    const label = normaliseWhitespace($(el as never).text());
    if (!label || label.length > 60) return;
    if (links.some((link) => link.href === resolved)) return;
    links.push({ label: cleanLabel(label), href: resolved });
  });

  const columns: FooterColumn[] = [];
  scope.find("h2, h3, h4").each((_, heading) => {
    const title = cleanLabel(normaliseWhitespace($(heading as never).text()));
    if (!title || title.length > 40) return;

    // Find the next list-like sibling after this heading.
    const list = $(heading as never)
      .nextAll()
      .filter((_, el) => /^(UL|DIV|NAV)$/.test((el as Element).tagName.toUpperCase()))
      .first();

    const columnLinks: { label: string; href: string }[] = [];
    list.find("a[href]").each((__, anchor) => {
      const el = anchor as Element;
      const resolved = absoluteFor(el.attribs?.["href"], baseUrl);
      if (!resolved || !resolved.startsWith(origin)) return;

      const label = normaliseWhitespace($(el as never).text());
      if (!label || label.length > 60) return;
      columnLinks.push({ label: cleanLabel(label), href: resolved });
    });

    if (columnLinks.length > 0) columns.push({ title, links: columnLinks.slice(0, 8) });
  });

  const uniqueColumns = columns.filter(
    (column, index) => columns.findIndex((other) => other.title === column.title) === index,
  );

  // Footer copy that is not a link (copyright line, company blurb).
  const text = normaliseWhitespace(scope.clone().find("a, ul, nav, script, style").remove().end().text());

  return { links: links.slice(0, 24), columns: uniqueColumns.slice(0, 4), text: text.slice(0, 400) };
}

/** Email, phone, postal address and opening hours, from markup then JSON-LD. */
export function extractContact(
  $: CheerioAPI,
  baseUrl: string,
  jsonLd: Record<string, unknown>[],
): ContactInfo {
  const contact: ContactInfo = {
    email: "",
    phone: "",
    address: { street: "", city: "", region: "", postalCode: "", country: "" },
    hours: [],
  };

  $("a[href^='mailto:']").each((_, element) => {
    const href = (element as Element).attribs?.["href"] ?? "";
    const email = href.replace(/^mailto:/i, "").split("?")[0]?.trim();
    if (email && email.includes("@") && !contact.email) contact.email = email;
  });

  $("a[href^='tel:']").each((_, element) => {
    const href = (element as Element).attribs?.["href"] ?? "";
    const raw = href.replace(/^tel:/i, "").trim();
    if (!raw || contact.phone) return;
    const label = normaliseWhitespace($(element as never).text());
    // Prefer the human-formatted number from the link text when it looks valid.
    contact.phone = label.length >= 7 && /[\d\s()+.-]{7,}/.test(label) ? label : raw;
  });

  const addressText = normaliseWhitespace($("address").first().text());
  if (addressText) contact.address.street = addressText.slice(0, 200);

  // Opening hours: "Monday - Friday 9am - 5pm" style rows.
  const hoursPattern =
    /\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\s*(?:-|–|—|to)\s*(mon|tue|wed|thu|fri|sat|sun)[a-z]*\b[^.!?]{0,40}/i;

  $("li, p, td, div, span").each((_, element) => {
    if (contact.hours.length >= 4) return;
    const text = textOf($(element as never));
    if (text.length > 120) return;
    const match = hoursPattern.exec(text);
    if (!match) return;
    const days = cleanLabel(match[0]);
    if (days.length < 8) return;
    if (contact.hours.some((existing) => existing.days === days)) return;
    contact.hours.push({ days, hours: "" });
  });

  // JSON-LD is authoritative when present.
  for (const node of jsonLd) {
    const type = String(node["@type"] ?? "");
    if (!/Organization|LocalBusiness|Corporation|Store|Restaurant|ProfessionalService/i.test(type)) {
      continue;
    }

    if (!contact.email && typeof node["email"] === "string") {
      contact.email = node["email"].replace(/^mailto:/i, "");
    }
    if (!contact.phone && typeof node["telephone"] === "string") {
      contact.phone = node["telephone"];
    }

    const address = node["address"];
    if (address && typeof address === "object") {
      const record = address as Record<string, unknown>;
      const get = (key: string) => (typeof record[key] === "string" ? (record[key] as string) : "");
      const street = [get("streetAddress"), get("addressLine1")].filter(Boolean).join(", ");
      contact.address = {
        street: street || contact.address.street,
        city: get("addressLocality") || contact.address.city,
        region: get("addressRegion") || contact.address.region,
        postalCode: get("postalCode") || contact.address.postalCode,
        country: get("addressCountry") || contact.address.country,
      };
    }
  }

  return contact;
}

/** The site logo, if the header exposes an image we can download. */
export function extractLogo($: CheerioAPI, baseUrl: string, images: ImageRef[]): ImageRef | null {
  const headerImage = $("header img, [class*='logo'] img, img[class*='logo'], img[id*='logo']").first();
  const candidate =
    headerImage.attr("src") ??
    headerImage.attr("data-src") ??
    $("a[href='/'] img, a[href='./'] img, a[href$='/'] img").first().attr("src");

  const resolved = absoluteFor(candidate, baseUrl);
  if (resolved) {
    return { src: resolved, alt: normaliseWhitespace(headerImage.attr("alt") ?? "") };
  }

  // Fall back to the first image whose URL is plausibly a logo.
  return images.find((image) => /logo|brand/i.test(image.src)) ?? null;
}

/** Site name and tagline, preferring structured data over page titles. */
export function extractBrandIdentity(
  $: CheerioAPI,
  meta: PageMeta,
  jsonLd: Record<string, unknown>[],
  origin: string,
): { name: string; tagline: string; legalName: string } {
  let name = meta.siteName ?? "";
  let legalName = "";

  for (const node of jsonLd) {
    const type = String(node["@type"] ?? "");
    if (!/Organization|LocalBusiness|WebSite/i.test(type)) continue;
    const nodeName = typeof node["name"] === "string" ? node["name"] : "";
    const nodeLegal = typeof node["legalName"] === "string" ? node["legalName"] : "";
    if (!name && nodeName) name = nodeName;
    if (!legalName && nodeLegal) legalName = nodeLegal;
  }

  if (!name) {
    // "About us | Acme Ltd" -> "Acme Ltd"; otherwise the bare host name.
    const parts = meta.title.split(/[|•–—]/).map((part) => part.trim());
    name = parts.length > 1 ? (parts[parts.length - 1] ?? "") : "";
  }
  if (!name) {
    const host = new URL(origin).hostname.replace(/^www\./, "");
    name = humanise(host.split(".")[0] ?? "Site");
  }

  const heroHeading = normaliseWhitespace($("h1").first().text());
  const tagline = heroHeading.length > 4 && heroHeading.length < 140 ? heroHeading : meta.description;

  return { name, tagline, legalName };
}
