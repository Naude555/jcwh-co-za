import { writeText } from "./utils/fs.ts";
import { toPath } from "./utils/url.ts";

/**
 * URL discovery.
 *
 * Sitemaps are the cheapest and most complete source of a site's URL set, so we
 * try robots.txt and the conventional sitemap locations first and only fall back
 * to link-following (which the crawler always does anyway) when none exist.
 */

export interface DiscoveredUrl {
  url: string;
  path: string;
  lastmod?: string;
}

export interface DiscoveryResult {
  urls: DiscoveredUrl[];
  /** Where the list came from, for the report. */
  sources: string[];
  warnings: string[];
}

const SITEMAP_CANDIDATES = ["/sitemap.xml", "/sitemap_index.xml", "/sitemap-index.xml", "/sitemap"];

async function fetchText(url: string, timeoutMs = 15000): Promise<string | null> {
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "user-agent": "jcwh-modernizer/0.1 (+site modernization crawl)",
        accept: "text/html,application/xhtml+xml,application/xml,text/plain,*/*",
      },
    });
    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

/** Pull `<loc>` values (and `lastmod` where present) out of sitemap XML. */
function parseSitemap(xml: string): { locs: DiscoveredUrl[]; sitemaps: string[] } {
  const locs: DiscoveredUrl[] = [];
  const sitemaps: string[] = [];

  const entries = xml.match(/<url>[\s\S]*?<\/url>/gi) ?? [];
  for (const entry of entries) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(entry)?.[1];
    if (!loc) continue;
    const lastmod = /<lastmod>\s*([^<\s]+)\s*<\/lastmod>/i.exec(entry)?.[1];
    locs.push({ url: loc, path: toPath(loc), ...(lastmod ? { lastmod } : {}) });
  }

  const nested = xml.match(/<sitemap>[\s\S]*?<\/sitemap>/gi) ?? [];
  for (const entry of nested) {
    const loc = /<loc>\s*([^<\s]+)\s*<\/loc>/i.exec(entry)?.[1];
    if (loc) sitemaps.push(loc);
  }

  // A bare list of URLs (some CMSs emit this).
  if (locs.length === 0 && nested.length === 0) {
    for (const match of xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) {
      const loc = match[1];
      if (loc) locs.push({ url: loc, path: toPath(loc) });
    }
  }

  return { locs, sitemaps };
}

/** Sitemap URLs declared in robots.txt (the officially blessed location). */
function sitemapsFromRobots(robots: string): string[] {
  return [...robots.matchAll(/^\s*sitemap:\s*(\S+)\s*$/gim)]
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
}

/**
 * Collect the URL set for a site. Follows sitemap indexes one level down and
 * silently degrades to link-following when a site publishes no sitemap.
 */
export async function discoverUrls(
  origin: string,
  outDir: string,
  maxSitemaps = 12,
): Promise<DiscoveryResult> {
  const sources: string[] = [];
  const warnings: string[] = [];
  const found = new Map<string, DiscoveredUrl>();

  const add = (entry: DiscoveredUrl) => {
    if (!found.has(entry.url)) found.set(entry.url, entry);
  };

  const sitemapUrls: string[] = [];

  const robots = await fetchText(new URL("/robots.txt", origin).href);
  if (robots) {
    const declared = sitemapsFromRobots(robots);
    if (declared.length > 0) {
      sources.push("robots.txt");
      sitemapUrls.push(...declared);
    }
    await writeText(`${outDir}/raw/robots.txt`, robots);
  }

  if (sitemapUrls.length === 0) {
    sitemapUrls.push(...SITEMAP_CANDIDATES.map((path) => new URL(path, origin).href));
  }

  const queue = [...new Set(sitemapUrls)];
  const seen = new Set<string>();
  let fetched = 0;

  while (queue.length > 0 && fetched < maxSitemaps) {
    const sitemapUrl = queue.shift();
    if (!sitemapUrl || seen.has(sitemapUrl)) continue;
    seen.add(sitemapUrl);

    const xml = await fetchText(sitemapUrl);
    if (!xml || !/<(urlset|sitemapindex)/i.test(xml)) continue;

    fetched += 1;
    if (!sources.includes(sitemapUrl)) sources.push(sitemapUrl);

    const { locs, sitemaps } = parseSitemap(xml);
    for (const loc of locs) add(loc);
    for (const nested of sitemaps) if (!seen.has(nested)) queue.push(nested);
  }

  if (found.size === 0) {
    warnings.push(
      "No sitemap found — falling back to following links. Crawl depth and --max-pages will decide coverage.",
    );
  }

  return { urls: [...found.values()], sources, warnings };
}
