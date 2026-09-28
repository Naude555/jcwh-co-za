#!/usr/bin/env node
/**
 * Scaffold a new client site from this base template.
 *
 *   pnpm new-site acme-corp --url https://acme.example
 *
 * Creates a sibling directory, keeps the toolkit and design system, clears the
 * demo content, and records where the instance came from in site.config.json so
 * the whole multi-site workflow stays traceable (see docs/WORKFLOW.md).
 */
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const baseDir = resolve(scriptDir, "..");

/* ---------------------------------------------------------------- output -- */

const colour = process.stdout.isTTY && process.env.NO_COLOR === undefined;
const paint = (code, text) => (colour ? `\u001b[${code}m${text}\u001b[0m` : text);

const log = {
  step: (message) => console.log(`\n${paint(1, paint(36, "▸"))} ${paint(1, message)}`),
  info: (message) => console.log(`  ${message}`),
  ok: (message) => console.log(`  ${paint(32, "✓")} ${message}`),
  warn: (message) => console.log(`  ${paint(33, "!")} ${message}`),
  fail: (message) => console.error(`\n${paint(31, "✗")} ${message}\n`),
};

/* ------------------------------------------------------------------ args -- */

const USAGE = `
Scaffold a new client site from the base template.

Usage
  pnpm new-site <slug> [options]

Options
  -u, --url <url>       Live site to modernize (recorded in site.config.json)
      --client <name>   Client name (defaults to the title-cased slug)
      --dir <parent>    Parent directory for instances
                        (default $JCWH_SITES_DIR, else ../sites)
      --keep-demo       Keep the demo content instead of clearing it
      --fresh-history   Start a clean git history instead of inheriting the base's
      --install         Run pnpm install in the new instance
  -h, --help            Show this help

Examples
  pnpm new-site acme-corp --url acme.example --install
  JCWH_SITES_DIR=~/clients pnpm new-site brightside --url brightside.example
`.trim();

function parseArgs(argv) {
  const options = {
    slug: "",
    url: "",
    client: "",
    parent: process.env.JCWH_SITES_DIR ?? join(dirname(baseDir), "sites"),
    keepDemo: false,
    freshHistory: false,
    install: false,
  };

  const queue = [...argv];
  while (queue.length > 0) {
    const arg = queue.shift();
    if (!arg) break;

    switch (arg) {
      case "-u":
      case "--url":
        options.url = queue.shift() ?? "";
        break;
      case "--client":
        options.client = queue.shift() ?? "";
        break;
      case "--dir":
        options.parent = queue.shift() ?? options.parent;
        break;
      case "--keep-demo":
        options.keepDemo = true;
        break;
      case "--fresh-history":
        options.freshHistory = true;
        break;
      case "--install":
        options.install = true;
        break;
      case "-h":
      case "--help":
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        if (arg.startsWith("-")) {
          log.fail(`Unknown option: ${arg}\n\n${USAGE}`);
          process.exit(1);
        }
        if (!options.slug) options.slug = arg;
        break;
    }
  }

  return options;
}

function titleCase(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/** Normalise `acme.example` and `https://acme.example/` alike. */
function normaliseUrl(input) {
  if (!input) return "";
  const withProtocol = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  try {
    const url = new URL(withProtocol);
    url.hash = "";
    url.search = "";
    return url.href.replace(/\/$/, "");
  } catch {
    log.fail(`Not a usable URL: ${input}`);
    process.exit(1);
  }
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  return result.status === 0;
}

function hasGit(dir) {
  const result = spawnSync("git", ["-C", dir, "rev-parse", "--git-dir"], { stdio: "ignore" });
  return result.status === 0;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ main -- */

/** Clone (preferred) or copy the base, keeping history so base work can be merged. */
async function copyBase(target, { freshHistory }) {
  let mode = "copy";

  if (hasGit(baseDir)) {
    if (!run("git", ["clone", "--quiet", "--no-hardlinks", baseDir, target])) {
      throw new Error("git clone failed");
    }
    // Free up `origin` for the client's own remote; the base becomes `upstream`.
    run("git", ["-C", target, "remote", "rename", "origin", "upstream"]);
    mode = "clone";
  } else {
    await mkdir(target, { recursive: true });
    await cp(baseDir, target, {
      recursive: true,
      filter: (source) => {
        const relative = source.slice(baseDir.length);
        return !/(^|\/)(node_modules|\.git|dist|\.astro|output|storage|crawlee)(\/|$)/.test(relative);
      },
    });
  }

  if (freshHistory) {
    await rm(join(target, ".git"), { recursive: true, force: true });
    run("git", ["init", "-b", "main"], target);
    run("git", ["-C", target, "add", "-A"]);
    run("git", [
      "-C",
      target,
      "-c",
      "commit.gpgsign=false",
      "commit",
      "-m",
      "Initial commit: site scaffolded from the base template",
    ]);
    mode = "fresh";
  }

  if (hasGit(target)) {
    const remotes = spawnSync("git", ["-C", target, "remote"], { encoding: "utf8" }).stdout ?? "";
    if (!remotes.split("\n").includes("upstream")) {
      run("git", ["-C", target, "remote", "add", "upstream", baseDir]);
    }
  }

  return mode;
}

function latestBaseTag() {
  const result = spawnSync("git", ["-C", baseDir, "describe", "--tags", "--abbrev=0"], {
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "untagged";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (!options.slug) {
    log.fail(`Missing a site slug.\n\n${USAGE}`);
    process.exit(1);
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(options.slug)) {
    log.fail(`Slug "${options.slug}" must be kebab-case (lowercase letters, digits and dashes).`);
    process.exit(1);
  }

  const basePackage = JSON.parse(await readFile(join(baseDir, "package.json"), "utf8"));
  if (!(await exists(join(baseDir, "apps/site"))) || !(await exists(join(baseDir, "tools/scraper")))) {
    log.fail(`${baseDir} does not look like the base template (apps/site + tools/scraper missing).`);
    process.exit(1);
  }

  const target = resolve(options.parent, options.slug);
  if (await exists(target)) {
    log.fail(`Target already exists: ${target}\nPick another slug or remove that directory.`);
    process.exit(1);
  }

  const client = options.client || titleCase(options.slug);
  const sourceUrl = normaliseUrl(options.url);
  const baseTag = latestBaseTag();

  log.step("Scaffolding a new site from the base template");
  log.info(`Base:    ${baseDir} (${baseTag}, v${basePackage.version})`);
  log.info(`Target:  ${target}`);
  log.info(`Client:  ${client}`);
  if (sourceUrl) log.info(`Source:  ${sourceUrl}`);

  const mode = await copyBase(target, { freshHistory: options.freshHistory });
  log.ok(mode === "fresh" ? "Copied with a clean git history" : "Copied from the base");

  if (!options.keepDemo) {
    await clearDemoContent(target);
    await writeFile(
      join(target, "apps/site/src/content/pages/index.md"),
      starterPage(client, sourceUrl),
    );
    await writeFile(
      join(target, "apps/site/src/data/site.json"),
      `${JSON.stringify(siteDataTemplate({ client, clientSlug: options.slug, sourceUrl }), null, 2)}\n`,
    );
    log.ok("Demo content cleared, placeholder home page written");
  } else {
    log.warn("Demo content kept (--keep-demo)");
  }

  await writeFile(
    join(target, "site.config.json"),
    `${JSON.stringify(
      {
        $schema: "./docs/site.config.schema.json",
        slug: options.slug,
        client,
        sourceUrl,
        base: { version: basePackage.version, tag: baseTag, createdAt: new Date().toISOString() },
        status: "scaffolded",
        deployTarget: "",
        notes: "",
        runs: [],
      },
      null,
      2,
    )}\n`,
  );

  await writeFile(join(target, "docs/SITE-NOTES.md"), siteNotes({ client, sourceUrl, baseTag }));

  if (!(await exists(join(target, ".env")))) {
    await cp(join(baseDir, ".env.example"), join(target, ".env"));
  }

  log.ok("site.config.json and docs/SITE-NOTES.md written");

  if (options.install) {
    log.step("Installing dependencies");
    if (!run("pnpm", ["install"], target)) {
      log.warn("pnpm install failed — run it yourself before the first crawl.");
    } else {
      log.ok("Dependencies installed");
    }
  }

  log.step("Next steps");
  log.info(`cd ${target}`);
  if (!options.install) log.info("pnpm install");
  log.info(`pnpm modernize --url ${sourceUrl || "<existing-site>"} --max-pages 20   # recon crawl`);
  log.info("then read tools/scraper/output/<host>/report.md before the full run");
  log.info("pnpm check && pnpm dev");
  log.info("");
  log.info(`Runbook:        ${join(target, "docs/WORKFLOW.md")}`);
  log.info(`Per-site notes: ${join(target, "docs/SITE-NOTES.md")}`);
}

/* -------------------------------------------------------------- content --- */

const DEMO_COLLECTIONS = ["pages", "posts", "services"];

/** Clear the demo content so a client instance never ships the template's copy. */
async function clearDemoContent(target) {
  const contentRoot = join(target, "apps/site/src/content");

  for (const collection of DEMO_COLLECTIONS) {
    const dir = join(contentRoot, collection);
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, ".gitkeep"), "");
  }

  // The placeholder images only exist to demonstrate the blocks.
  const assets = join(target, "apps/site/src/assets/images");
  await rm(assets, { recursive: true, force: true });
  await mkdir(assets, { recursive: true });
  await writeFile(join(assets, ".gitkeep"), "");
  await rm(join(target, "apps/site/public/images"), { recursive: true, force: true });
}

/** A page that validates against the schema, so the instance builds immediately. */
function starterPage(client, sourceUrl) {
  const target = sourceUrl || "<the existing site's URL>";
  return `---
title: ${client}
description: Placeholder page for a site scaffolded from the base template.
template: marketing
breadcrumbs: []
sections:
  - type: hero
    eyebrow: Ready to build
    heading: ${client}
    subheading: This is a placeholder page so the site runs before any content is
      imported.
    variant: centered
    align: center
    actions: []
  - type: richText
    heading: Next steps
    body: |
      1. Run a recon crawl to see what the modernizer can read from the existing
         site: pnpm modernize --url ${target} --max-pages 20

      2. Open the migration report it writes to
         tools/scraper/output/<host>/report.md and check the page list, the
         detected section blocks and the palette.

      3. Run the full migration, then review the generated content in
         apps/site/src/content/ before building.

      See docs/WORKFLOW.md for the full runbook, including the review checklists
      and the launch steps.
`;
}

/** Neutral site data that satisfies apps/site/src/data/site.ts. */
function siteDataTemplate({ client, clientSlug, sourceUrl }) {
  return {
    name: client,
    legalName: "",
    tagline: "",
    description: `${client} website, built from the base template.`,
    url: sourceUrl || `https://${clientSlug}.example`,
    locale: "en",
    logo: { src: "", alt: `${client} logo`, text: client },
    contact: {
      email: "",
      phone: "",
      address: { street: "", city: "", region: "", postalCode: "", country: "" },
      hours: [],
    },
    socials: [],
    navigation: { primary: [], actions: [], footer: [] },
    footer: {
      tagline: "",
      columns: [],
      legal: "",
      credit: "Rebuilt with Astro, Tailwind CSS and daisyUI.",
    },
    theme: {
      light: "brand",
      dark: "brand-dark",
      fonts: { heading: "", body: "" },
      palette: {},
    },
    source: { url: sourceUrl, scrapedAt: null, pagesMigrated: 0 },
  };
}

/** Per-site working document for the decisions the runbook asks you to record. */
function siteNotes({ client, sourceUrl, baseTag }) {
  return `# ${client} — migration notes

Base template: \`${baseTag}\`
Source site: ${sourceUrl || "(not recorded)"}
Started: ${new Date().toISOString().slice(0, 10)}

Fill this in as you go. It is the record of what the tool did, what you changed,
and what the client agreed to — which is what makes the next site faster.

## Access and permissions

- [ ] Written permission to copy the site's content and imagery
- [ ] Staging URL / host access
- [ ] Who signs off the design review

## Scope

- Pages in scope:
- Pages deliberately excluded (and why):
- Sections of the old site that are dropped:

## Recon crawl

- Report reviewed on:
- Pages found / pages crawled:
- Block detection summary:
- Palette and fonts detected:
- Surprises (missing content, JS-only pages, blocked paths):

## Design decisions

- Blocks that needed hand-editing:
- Brand colours accepted or overridden:
- Fonts to load (update \`apps/site/astro.config.mjs\`):
- Components added or removed:

## URLs and redirects

- URLs that changed shape:
- \`_redirects\` deployed with the site: yes / no
- Spot-checked redirects:

## Review checklist

See \`docs/WORKFLOW.md\` for the full list. Record the date each gate passed:

- [ ] Content review — date:
- [ ] Design review — date:
- [ ] Technical QA (links, images, metadata, a11y) — date:
- [ ] Client sign-off — date:

## Launch

- Deployed to:
- Deployed on:
- Sitemap submitted:
- Post-launch 404 check — date:
`;
}

/* ------------------------------------------------------------------ run --- */

main().catch((error) => {
  log.fail(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

