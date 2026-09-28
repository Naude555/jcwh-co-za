/**
 * Command-line options with defaults.
 *
 * Deliberately a hand-written parser: this tool runs with no build step and as
 * few dependencies as possible (Node's native type stripping executes it).
 */

export interface Options {
  /** Root URL of the site being modernized. */
  url: string;
  /** Where raw crawl output is written. */
  outDir: string;
  /** The Astro app that generated content is written into. */
  siteDir: string;
  maxPages: number;
  maxDepth: number;
  concurrency: number;
  /** Politeness delay between requests, in milliseconds. */
  delayMs: number;
  /** Use a real browser for JS-rendered sites (needs Playwright installed). */
  render: boolean;
  downloadAssets: boolean;
  /** Assets larger than this are left remote. */
  maxAssetBytes: number;
  /** Only crawl URLs matching this pattern (regex source). */
  include: string | null;
  /** Never crawl URLs matching these patterns (regex sources). */
  exclude: string[];
  /**
   * `auto` follows the visitor's system colour scheme and shows the toggle;
   * `light` builds a light-only site (no dark palette, no toggle).
   */
  themeMode: "auto" | "light";
  respectRobots: boolean;
  verbose: boolean;
  /** Regenerate content from an existing crawl instead of re-crawling. */
  fromCache: boolean;
  /**
   * Site-relative path to the logo to use (e.g. `assets/images/logo.svg`).
   *
   * A supplied logo survives re-crawls, unlike editing `site.json` by hand.
   */
  logo: string | null;
  /**
   * Treat thumbnail → detail-page galleries as one gallery: feature a few images
   * on the home page, and retire the detail stubs with redirects.
   */
  foldGalleries: boolean;
}

export type Command = "scrape" | "generate" | "modernize" | "help";

export interface ParsedArgs {
  command: Command;
  options: Options;
}

export const DEFAULTS: Omit<
  Options,
  "url" | "outDir" | "include" | "exclude" | "logo"
> = {
  siteDir: "apps/site",
  maxPages: 60,
  maxDepth: 4,
  concurrency: 4,
  delayMs: 250,
  render: false,
  downloadAssets: true,
  maxAssetBytes: 4 * 1024 * 1024,
  themeMode: "auto",
  foldGalleries: false,
  respectRobots: true,
  verbose: false,
  fromCache: false,
};

const USAGE = `
Modernize a website: crawl it, then generate an Astro + Tailwind + daisyUI rebuild.

Usage
  pnpm modernize --url <site> [options]    crawl + generate (the usual command)
  pnpm scrape    --url <site> [options]    crawl only, keep the raw output
  pnpm generate  --url <site> [options]    regenerate content from the last crawl

Options
  -u, --url <url>        Site to modernize (required)
      --site <dir>       Astro app to write into       (default ${DEFAULTS.siteDir})
      --out <dir>        Crawl output directory        (default tools/scraper/output/<host>)
      --max-pages <n>    Page limit                    (default ${DEFAULTS.maxPages})
      --max-depth <n>    Link depth limit              (default ${DEFAULTS.maxDepth})
      --concurrency <n>  Parallel requests             (default ${DEFAULTS.concurrency})
      --delay <ms>       Delay per request to a host   (default ${DEFAULTS.delayMs})
      --include <regex>  Only crawl matching paths
      --exclude <regex>  Skip matching paths (repeatable)
      --render           Render JavaScript (needs: pnpm --filter scraper browsers)
      --no-assets        Do not download images
      --max-asset-kb <n> Skip assets larger than this  (default ${DEFAULTS.maxAssetBytes / 1024} kB)
      --theme <mode>     light | auto                 (default ${DEFAULTS.themeMode})
      --logo <path>      Logo file inside the app      (e.g. assets/images/logo.svg)
      --fold-galleries   Feature the gallery on the home page and 301 the
                         thumbnail detail pages into it
      --ignore-robots    Do not honour robots.txt
      --from-cache       Reuse the previous crawl of this site
  -v, --verbose          Extra detail
  -h, --help             Show this help
`.trim();

export function usage(): string {
  return USAGE;
}

/** Parse `process.argv` into a command plus normalised options. */
export function parseArgs(argv: string[]): ParsedArgs {
  const args = [...argv];
  const first = args[0];
  let command: Command = "modernize";

  if (first === "scrape" || first === "generate" || first === "modernize" || first === "help") {
    command = first;
    args.shift();
  }

  const options: Options = {
    url: "",
    outDir: "",
    include: null,
    exclude: [],
    logo: null,
    ...DEFAULTS,
  };

  const next = (name: string): string => {
    const value = args.shift();
    if (value === undefined) throw new Error(`Option ${name} requires a value`);
    return value;
  };

  while (args.length > 0) {
    const arg = args.shift();
    if (!arg) break;

    switch (arg) {
      case "-u":
      case "--url":
        options.url = next(arg);
        break;
      case "--site":
        options.siteDir = next(arg);
        break;
      case "--out":
        options.outDir = next(arg);
        break;
      case "--max-pages":
        options.maxPages = Number.parseInt(next(arg), 10);
        break;
      case "--max-depth":
        options.maxDepth = Number.parseInt(next(arg), 10);
        break;
      case "--concurrency":
        options.concurrency = Number.parseInt(next(arg), 10);
        break;
      case "--delay":
        options.delayMs = Number.parseInt(next(arg), 10);
        break;
      case "--max-asset-kb":
        options.maxAssetBytes = Number.parseInt(next(arg), 10) * 1024;
        break;
      case "--include":
        options.include = next(arg);
        break;
      case "--exclude":
        options.exclude.push(next(arg));
        break;
      case "--theme":
        options.themeMode = next(arg) === "light" ? "light" : "auto";
        break;
      case "--fold-galleries":
        options.foldGalleries = true;
        break;
      case "--logo":
        options.logo = next(arg);
        break;
      case "--render":
        options.render = true;
        break;
      case "--no-assets":
        options.downloadAssets = false;
        break;
      case "--ignore-robots":
        options.respectRobots = false;
        break;
      case "--from-cache":
        options.fromCache = true;
        break;
      case "-v":
      case "--verbose":
        options.verbose = true;
        break;
      case "-h":
      case "--help":
        command = "help";
        break;
      default:
        if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}\n\n${USAGE}`);
        // A bare argument is treated as the URL, so `pnpm modernize example.com` works.
        if (!options.url) options.url = arg;
        break;
    }
  }

  if (command !== "help") {
    if (!options.url) throw new Error(`Missing --url.\n\n${USAGE}`);
    options.url = normaliseTarget(options.url);
    if (!options.outDir) options.outDir = defaultOutDir(options.url);
  }

  return { command, options };
}

/** Accept `example.com` and `www.example.com/path` as well as full URLs. */
function normaliseTarget(input: string): string {
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(withProtocol);
  url.hash = "";
  url.search = "";
  const path = url.pathname.replace(/\/+$/, "");
  url.pathname = path === "" ? "/" : path;
  return url.href.replace(/\/$/, "");
}

/** `https://www.example.com` -> `tools/scraper/output/www.example.com`. */
export function defaultOutDir(target: string): string {
  const host = new URL(target).host.replace(/[^\w.-]/g, "_");
  return `tools/scraper/output/${host}`;
}

/** Compile a pattern supplied as a regex source, ignoring invalid input. */
export function compilePattern(source: string | null): RegExp | null {
  if (!source) return null;
  try {
    return new RegExp(source, "i");
  } catch {
    return null;
  }
}
