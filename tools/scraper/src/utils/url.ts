/** URL helpers shared by discovery, extraction and generation. */

/** Remove the hash/query noise that creates duplicate pages. */
export function normaliseUrl(raw: string, base?: string): string | null {
  try {
    const url = new URL(raw, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;

    url.hash = "";

    // Drop tracking parameters but keep meaningful ones (pagination, ids).
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|mc_|ref$)/i.test(key)) url.searchParams.delete(key);
    }

    // Collapse a trailing slash so /about and /about/ are one page.
    if (url.pathname !== "/" && url.pathname.endsWith("/")) {
      url.pathname = url.pathname.replace(/\/+$/, "");
    }

    return url.href.replace(/\/$/, "");
  } catch {
    return null;
  }
}

export function isSameSite(candidate: string, origin: string): boolean {
  try {
    return new URL(candidate).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * The site-relative path for a URL, e.g. `https://x.com/about/` -> `/about`.
 *
 * A `.html`/`.php` suffix is dropped and `/index.*` collapses to `/`, so a static
 * rebuild serves the same URL shape as the modern routing our site uses. The
 * originals are preserved as redirects by the generator.
 */
export function toPath(url: string): string {
  const path = new URL(url).pathname
    .replace(/\/index\.(html?|php|aspx?|jsp)$/i, "/")
    .replace(/\.(html?|php|aspx?|jsp)$/i, "")
    .replace(/\/+$/, "");

  return path === "" ? "/" : path;
}

/** Turn a URL path into a content collection id (`/` -> `index`). */
export function toId(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  return clean === "" ? "index" : clean;
}

/** Sections whose prefix is implied by the collection they are written into. */
const SERVICE_PREFIX = /^(services?|solutions?|what-we-do|treatments?|products?|work)\//i;

/**
 * Collection id for a page.
 *
 * Service pages drop their `/services/` prefix because the rebuilt site already
 * serves them under that section, which keeps the original URL intact. Posts keep
 * their full path so a `/blog/...` hierarchy survives the move.
 */
export function contentId(kind: string, path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, "");
  if (clean === "") return "index";

  if (kind === "service") {
    const stripped = clean.replace(SERVICE_PREFIX, "");
    return stripped === "" ? clean : stripped;
  }

  return clean;
}

/** Human-readable label from a path segment (`about-us` -> `About us`). */
export function toLabel(path: string): string {
  const segment = path.split("/").filter(Boolean).pop() ?? "";
  const words = segment
    .replace(/[-_]+/g, " ")
    .replace(/\.(html?|php|aspx?)$/i, "")
    .trim();
  if (!words) return "Home";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Absolute URL for a possibly relative href, or null when unusable. */
export function resolveHref(href: string, base: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (/^(mailto:|tel:|sms:|javascript:|data:|#)/i.test(trimmed)) return null;
  return normaliseUrl(trimmed, base);
}

/** Heuristic: does this path look like a blog/news article rather than a page? */
export function looksLikeArticle(path: string): boolean {
  return /(^|\/)(blog|news|insights?|articles?|journal|updates?|press)\/.+/i.test(path);
}

/** Heuristic: does this path look like a service or product detail page? */
export function looksLikeService(path: string): boolean {
  return /(^|\/)(services?|solutions?|what-we-do|treatments?|products?)\/[^/]+/i.test(path);
}

/** Heuristic: legal/boilerplate pages, which get a plain layout. */
export function looksLikeLegal(path: string): boolean {
  return /(privacy|terms|cookies?|gdpr|legal|disclaimer|accessibility-statement)/i.test(path);
}

/** Paths that are never worth migrating. */
export function isIgnoredPath(path: string): boolean {
  return (
    /^\/(wp-admin|wp-login|wp-json|feed|rss|comments|search|cart|checkout|account|login|logout|signin|signup|register|admin)\b/i.test(
      path,
    ) ||
    /\.(pdf|zip|rar|gz|dmg|exe|mp4|mp3|mov|avi|css|js|json|xml|txt|ico|webmanifest)$/i.test(path) ||
    /\/(tag|tags|category|categories|author|page)\//i.test(path)
  );
}
