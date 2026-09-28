# Website modernization toolkit

Scrape a live website, rebuild it as a custom **Astro + Tailwind CSS + daisyUI** site,
and keep its content, URL structure, brand palette and SEO metadata intact.

This repository is the **base template**. Each client site is a separate instance
created from it, so the design system and tooling stay shared while the content,
brand and deployment stay per client.

```bash
pnpm install
pnpm test                                    # integration test against a local fixture site
pnpm new-site acme-corp --url acme.example   # scaffold a client instance
```

Full process, with phase gates and checklists: **[docs/WORKFLOW.md](docs/WORKFLOW.md)**.

## What's in the box

| Path | What it is |
| --- | --- |
| `apps/site` | The Astro site: design system, components, routes, content collections |
| `tools/scraper` | The pipeline: crawl → extract → brand → generate (no build step) |
| `tools/scraper/test/fixture` | A small static site used as a deterministic test subject |
| `scripts/new-site.mjs` | Scaffolds a client instance from this base |
| `site.config.json` | Which base version an instance came from, and its workflow status |
| `docs/WORKFLOW.md` | The repeatable runbook: nine phases, checklists, gates |
| `docs/SITE-NOTES.md` | Per-instance decision log (created by the scaffolder) |

## Starting a new client site

```bash
export JCWH_SITES_DIR=~/clients                  # where instances live (defaults to ../sites)
pnpm new-site acme-corp --url acme.example       # clone base → new instance
cd "$JCWH_SITES_DIR/acme-corp" && pnpm install
pnpm modernize --url acme.example --max-pages 20 # recon crawl
```

The scaffolder clones the base (keeping history so improvements can be pulled
later), points an `upstream` remote back at it, clears the demo content, writes a
placeholder home page so the instance runs immediately, and records everything in
`site.config.json` and `docs/SITE-NOTES.md`.

Use `--keep-demo` to keep the example content, `--fresh-history` for a clean
client history, and `--client "Acme Corp Ltd"` when the display name differs from
the directory name.

> **Alternative considered:** a monorepo with `packages/site-kit` and one `apps/<client>`
> per site shares code with zero synchronisation, but couples every client's
> dependencies, deploys and handover into one repository. This template model
> keeps each client independently deployable and transferable; switch if you
> outgrow it (the design system is already in one directory).


Everything in `apps/site/src/components`, `layouts`, `pages`, `utils` and
`styles/global.css` is **hand-written and never overwritten** by the tool. The
scraper only writes to files it owns:

```
apps/site/src/content/{pages,posts,services}/   generated content
apps/site/src/data/site.json                     business details, nav, footer, palette
apps/site/src/styles/brand.css                   generated daisyUI themes
tools/scraper/output/<host>/                     crawl artefacts + migration report
```

## The workflow

> The nine-phase runbook with gates, checklists and post-launch steps lives in
> **[docs/WORKFLOW.md](docs/WORKFLOW.md)**. This section is the tool-level summary.

### 1. Crawl

```
pnpm scrape --url https://client-site.example
```

Discovers URLs from `robots.txt` and the sitemap (falling back to link following),
then crawls with Crawlee — honouring `robots.txt`, with a politeness delay,
retries and bounded concurrency. Raw HTML is kept in `output/<host>/raw/` so the
extraction can be re-run or debugged without hitting the site again.

### 2. Review what was extracted

The crawl is written to `output/<host>/crawl.json` and summarised by
`output/<host>/report.md` — per page: kind, word count, which section blocks were
recognised, and any warnings. **Review this before generating.** Extraction is
heuristic; the report is where you see what the heuristics decided.

### 3. Generate

```
pnpm generate --url https://client-site.example --from-cache
```

Writes content, site data, the brand theme, redirects and the report. Re-running
is safe: generated collections are reset first, and nothing hand-written is
touched.

### 4. Review, then build

```
pnpm check     # astro check + scraper typecheck
pnpm build
```

Expect to spend real time in review. The tool gets structure, copy, images, links,
metadata and brand right; it cannot know that "Our Team" should be a `team` block
rather than prose.

## CLI reference

```
pnpm modernize --url <site> [options]    crawl + generate (the usual command)
pnpm scrape    --url <site> [options]    crawl only
pnpm generate  --url <site> [options]    regenerate from the last crawl
```

| Option | Default | Notes |
| --- | --- | --- |
| `--url <url>` | required | `example.com` is accepted and normalised |
| `--site <dir>` | `apps/site` | Astro app to write into |
| `--out <dir>` | `tools/scraper/output/<host>` | crawl artefacts |
| `--max-pages <n>` | `60` | page limit |
| `--max-depth <n>` | `4` | link-following depth |
| `--concurrency <n>` | `4` | parallel requests |
| `--delay <ms>` | `250` | per-request politeness delay |
| `--include <regex>` / `--exclude <regex>` | – | limit the crawl by path |
| `--render` | off | use Playwright for JS-rendered sites |
| `--no-assets` / `--max-asset-kb <n>` | download, 4 MB | asset handling |
| `--ignore-robots` | off | only for a site you own |
| `--from-cache` | off | reuse `crawl.json` |
| `-v` | off | verbose detail |

### JavaScript-rendered sites

The default crawler reads HTML over plain HTTP, which is fast and covers most
brochure, WordPress and static sites. For a site that builds its pages in the
browser:

```
pnpm --filter ./tools/scraper add -D playwright
pnpm --filter ./tools/scraper exec playwright install chromium
pnpm modernize --url https://client-site.example --render
```

## Environment

| Variable | Used by | Purpose |
| --- | --- | --- |
| `PUBLIC_SITE_URL` | Astro build | canonical URLs, sitemap, RSS, structured data. Overrides the source URL recorded in `site.json` |
| `PUBLIC_REMOTE_FONTS=0` | Astro build | skip downloading brand fonts (offline builds) |

## How the rebuild is structured

A page is a list of **typed section blocks**, declared once in
`apps/site/src/content.config.ts` and rendered by
`apps/site/src/components/sections/*.astro`:

`hero` · `richText` · `features` · `imageText` · `stats` · `gallery` · `logos` ·
`testimonials` · `faq` · `steps` · `pricing` · `team` · `cta` · `contact` · `embed`

Because the schema is Zod-validated, a malformed migration **fails the build**
with the file name and the reason, instead of shipping a broken page.

### Adding a block

1. Add the variant to the `section` union in `apps/site/src/content.config.ts`.
2. Add `apps/site/src/components/sections/<Name>.astro`. Its props type comes from
   `SectionOf<"name">` in `sections/types.ts`, so the schema stays the source of
   truth and the component fails to typecheck if they drift.
3. Register it in the `components` map in `SectionRenderer.astro`.
4. Emit it from `tools/scraper/src/extract/blocks.ts` if it can be detected.

## Design system and theming

Tailwind CSS v4 is wired in through Vite — there is **no `tailwind.config.js`**, so
all configuration is CSS:

| File | Owns | Written by |
| --- | --- | --- |
| `src/styles/global.css` | tokens, base styles, utilities, prose | hand |
| `src/styles/brand.css` | the `brand` / `brand-dark` daisyUI themes | generated |
| `src/data/site.json` | business details, navigation, footer, contact | generated |

`global.css` imports `brand.css`, so regenerating a palette never touches the
design system. Themes are declared with daisyUI 5's CSS plugin syntax:

```css
@plugin "daisyui/theme" {
  name: "brand";
  default: true;
  --color-primary: oklch(51.1% 0.0861 186.4);
  --radius-box: 0.875rem;
}
```

### How the brand is extracted

The scraper downloads the site's own stylesheets and reads:

- **Colours** from custom properties and colour declarations, weighted so tokens
  named `--primary`/`--brand`/`--accent` outrank incidental uses. Candidates are
  clustered in OKLCH; the most prominent hue becomes `primary`, the next two
  distinct hues become `secondary` and `accent`, and surfaces come from the
  lightest colour used.
- **Readable foregrounds** — every `*-content` colour is chosen by WCAG contrast
  ratio, so text on a brand colour stays legible rather than being an assumption.
- **A light and a dark theme** — the dark theme keeps the brand hue and lifts the
  accents until they clear 4.5:1 against the dark surface.
- **Fonts**, from `font-family` declarations with `var()` tokens resolved, split
  into heading and body by selector. Astro's Fonts API self-hosts them at build
  time; update the `fonts` array in `astro.config.mjs` to match.
- **Radii**, from the most common `border-radius` in the source CSS.

Every colour found is listed in `output/<host>/report.md` with its source, so a
surprising palette is easy to trace.

## Migration safety

- **URLs are normalised**: `/about.html` → `/about`, `/index.php` → `/`.
- **Redirects** for every URL whose shape changed are written to
  `output/<host>/redirects.json` and `output/<host>/_redirects`
  (Netlify/Cloudflare Pages format). Deploy them with the site.
- **Metadata is carried over**: title, description, canonical and OG tags feed
  `BaseLayout`; structured data is re-emitted from each page.
- **Provenance**: every generated entry records its `source.url` and `scrapedAt`.
- **Images** are downloaded, content-hash deduplicated, and rewritten to local
  paths. Raster images land in `src/assets/images` (Astro/Sharp resizes and
  converts them per breakpoint); SVG goes to `public/images`.
- **Prose is sanitised** on render (`src/utils/markdown.ts` strips scripts,
  frames and inline handlers) as defence in depth — it is not a full sanitiser.

## Testing

```
pnpm test           # 65 assertions: crawl → extract → brand → generate
```

The suite serves `tools/scraper/test/fixture` over HTTP and runs the real
pipeline against it into a temp directory: URL discovery, classification, every
block extractor, navigation/footer/contact recovery, asset downloading, palette
and font detection, generated files, redirects and the report. Failures keep the
artefacts on disk and print their path.

To try the CLI by hand against the same fixture site:

```
pnpm --filter ./tools/scraper serve-fixture
pnpm modernize --url http://127.0.0.1:4321 --site /tmp/site-check --delay 0
```

## Limits worth knowing

- **Heuristics, not magic.** Block detection is deliberately conservative: a
  single blockquote will not become a testimonials section. Anything not
  recognised stays as prose, which is safe but needs a human pass.
- **Nothing rendered by JavaScript** is extracted unless you pass `--render`.
- **Forms have no backend.** A static build cannot receive a submission; point
  `form.action` at Formspree/Netlify/a Worker, or add an Astro adapter and an
  action.
- **Content behind a login, an accordion, or an A/B test** is crawled in whatever
  state the server returns.
- **Third-party embeds** are only rendered for an allowlist of hosts (YouTube,
  Vimeo, Maps, Spotify) and only over HTTPS.
- **Client components** (carousels, tabs, modals) are rebuilt as static, accessible
  equivalents — no slider library is carried across. Add real interactivity where
  it earns its weight.
- **You must have permission to copy the site.** Scraping respects `robots.txt` by
  default, but that is not the same as having the client's consent, and imagery
  may be licensed to the client rather than owned by them. Confirm before
  publishing a migrated site.

## Requirements

- Node.js ≥ 22.12 (the scraper needs ≥ 24 for native TypeScript execution)
- pnpm ≥ 10 (dependency build scripts are allow-listed in `pnpm-workspace.yaml`)

