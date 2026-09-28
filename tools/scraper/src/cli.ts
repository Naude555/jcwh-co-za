#!/usr/bin/env node
import { parseArgs, usage } from "./config.ts";
import { createLogger, c } from "./utils/log.ts";
import { AssetStore } from "./assets.ts";
import { crawlSite } from "./crawl.ts";
import { extractBrand } from "./brand.ts";
import { generateSite } from "./generate.ts";
import { readJson, writeJson } from "./utils/fs.ts";
import type { CrawlResult } from "./crawl.ts";

/** Stages of the workflow described in docs/WORKFLOW.md, in order. */
const STAGES = ["template", "scaffolded", "crawled", "generated", "reviewed", "launched"] as const;

type Stage = (typeof STAGES)[number];

interface InstanceManifest {
  status?: Stage;
  runs?: {
    at: string;
    command: string;
    pages?: number;
    posts?: number;
    services?: number;
    redirects?: number;
  }[];
  [key: string]: unknown;
}

/**
 * Record this run in `site.config.json` when the working directory is a client
 * instance scaffolded by scripts/new-site.mjs.
 *
 * The status only ever moves forward, so re-running a crawl on a site that is
 * already live does not move it back to "generated". A missing file simply means
 * this is the base template or a plain checkout, so nothing is recorded.
 */
async function recordRun(
  path: string,
  logger: ReturnType<typeof createLogger>,
  entry: {
    command: string;
    status: Stage;
    pages?: number;
    posts?: number;
    services?: number;
    redirects?: number;
  },
): Promise<void> {
  const manifest = await readJson<InstanceManifest>(path);
  if (!manifest) return;

  // The base template is not an instance, so runs against it are not recorded.
  // Seeing this message means the crawl ran in the base rather than a client
  // instance — scaffold one with `pnpm new-site <slug>` and work there.
  if (manifest.status === "template") {
    if (!warnedAboutTemplate) {
      warnedAboutTemplate = true;
      logger.warn(
        "This looks like the base template, so the run was not recorded. " +
          "Create a client instance with `pnpm new-site <slug>` and run the pipeline there.",
      );
    }
    return;
  }

  const current = STAGES.indexOf(manifest.status ?? "scaffolded");
  const target = STAGES.indexOf(entry.status);
  const status: Stage = STAGES[Math.max(current, target)] ?? entry.status;

  const runs = [{ at: new Date().toISOString(), ...entry }, ...(manifest.runs ?? [])].slice(0, 20);

  await writeJson(path, { ...manifest, status, runs });
  logger.detail(`Recorded this run in ${path} (status: ${status})`);
}

/**
 * Entry point.
 *
 *   modernize   crawl then generate (the usual command)
 *   scrape      crawl only, so the raw material can be reviewed first
 *   generate    regenerate the Astro content from the last crawl
 */

/** Instance manifest, relative to the project root this command runs from. */
const MANIFEST_PATH = "site.config.json";

/** Only warn once per command that the base template is not an instance. */
let warnedAboutTemplate = false;

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${c.red("✗")} ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
    return;
  }

  const { command, options } = parsed;
  if (command === "help") {
    console.log(usage());
    return;
  }

  const logger = createLogger(options.verbose);
  const startedAt = Date.now();
  const store = new AssetStore({
    siteDir: options.siteDir,
    enabled: options.downloadAssets,
    maxBytes: options.maxAssetBytes,
  });

  logger.step(command === "scrape" ? "Crawling the source site" : "Modernizing website");
  logger.info(`Source:  ${options.url}`);
  logger.info(`Site:    ${options.siteDir}`);
  logger.info(`Output:  ${options.outDir}`);

  const cachePath = `${options.outDir}/crawl.json`;
  let crawl: CrawlResult;

  if (options.fromCache || (command === "generate" && !options.render)) {
    const cached = await readJson<CrawlResult>(cachePath);
    if (!cached) {
      throw new Error(
        `No cached crawl at ${cachePath}.\nRun \`pnpm scrape --url ${options.url}\` first, or drop --from-cache.`,
      );
    }
    crawl = cached;
    logger.success(`Reusing cached crawl (${crawl.pages.length} page(s))`);
  } else {
    crawl = await crawlSite(options, store, logger);
    await writeJson(cachePath, crawl);
    logger.success(`Crawled ${crawl.pages.length} page(s); raw HTML kept in ${options.outDir}/raw`);

    await recordRun(MANIFEST_PATH, logger, {
      command: command === "modernize" ? "modernize" : "scrape",
      status: "crawled",
      pages: crawl.pages.length,
    });
  }

  logger.step("Reading the brand from the source CSS");
  const brand = extractBrand(crawl.cssTexts);
  const topColors = brand.palette.evidence.slice(0, 3).map((entry) => entry.color);
  logger.info(
    `Palette: ${topColors.length > 0 ? topColors.join(", ") : "no colours found (defaults used)"}`,
  );
  logger.info(
    `Fonts:   ${[brand.fonts.heading, brand.fonts.body].filter(Boolean).join(" / ") || "not detected"}`,
  );

  if (command === "scrape") {
    logger.step("Crawl complete");
    logger.info(`Review the extracted content in ${cachePath}`);
    logger.info(`Then run: pnpm generate --url ${options.url} --from-cache`);
    return;
  }

  logger.step("Generating the Astro site");
  const result = await generateSite(crawl, brand, options, logger, {
    startedAt,
    assetTotals: store.totals(),
    assets: store.all(),
  });

  await recordRun(MANIFEST_PATH, logger, {
    command,
    status: "generated",
    pages: result.pages,
    posts: result.posts,
    services: result.services,
    redirects: result.redirects,
  });

  logger.step("Done");
  logger.success(
    `${result.pages} page(s), ${result.posts} post(s), ${result.services} service(s) written to ${options.siteDir}/src/content`,
  );
  logger.info(`Theme written to ${options.siteDir}/src/styles/brand.css`);
  logger.info(`Site data written to ${options.siteDir}/src/data/site.json`);
  if (result.redirects > 0) {
    logger.warn(`${result.redirects} redirect(s) required — see ${options.outDir}/_redirects`);
  }
  logger.info(`Report: ${result.reportPath.replace(/report\.json$/, "report.md")}`);
  logger.info("");
  logger.info(`${c.bold("Next:")} review the diff, then run ${c.cyan("pnpm dev")} and ${c.cyan("pnpm build")}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`\n${c.red("✗")} ${message}\n`);
  process.exitCode = 1;
});
