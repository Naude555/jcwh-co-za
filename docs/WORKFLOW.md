# Workflow runbook

The repeatable process for modernizing a client website with this toolkit.
Every site follows the same nine phases; each phase has a gate you should not
skip, because the failures it prevents are much more expensive than the check.

```
scaffold → recon → crawl → generate → content review → design review → QA → deploy → post-launch
   ↓          ↓       ↓        ↓             ↓                ↓            ↓      ↓         ↓
  ①          ②       ③        ④             ⑤                ⑥            ⑦      ⑧         ⑨
```

Per-site status is tracked in `site.config.json` (moves forward automatically as
you run commands) and decisions are recorded in `docs/SITE-NOTES.md`. Those two
files are the memory of a migration — fill them in as you go, not afterwards.

---

## Phase 0 — one-time setup

- [ ] Node ≥ 24 and pnpm ≥ 10 installed
- [ ] The base template cloned and verified once: `pnpm install && pnpm test && pnpm build`
- [ ] Pick where instances live: `export JCWH_SITES_DIR=~/clients` (defaults to `../sites`)
- [ ] `pnpm --filter ./tools/scraper add -D playwright && pnpm --filter ./tools/scraper exec playwright install chromium`
      — only needed for JavaScript-rendered sites, but install it before you need it

Keep the base clean: it is the source of truth for the design system and tooling.
Never scaffold a site *inside* the base (`sites/` is gitignored as a safety net).

---

## Phase 1 — Scaffold

```bash
cd ~/projects/jcwh                                   # the base
pnpm new-site acme-corp --url acme.example
cd "$JCWH_SITES_DIR/acme-corp"                       # or ../sites/acme-corp
pnpm install
```

Creates a fresh instance: toolkit + design system, demo content removed, a
placeholder home page so the site runs, `site.config.json`, `docs/SITE-NOTES.md`
and a `.env`. Git history is inherited from the base with an `upstream` remote
pointing back at it, so base improvements can be pulled later.

**Gate 1:** `pnpm dev` renders the placeholder page at `/`. If it does not, fix it
before crawling anything — you have a broken instance, not a broken target site.

### Before you crawl: permission

- [ ] Written permission to copy the site's content, imagery and branding
- [ ] Recorded in `docs/SITE-NOTES.md`
- [ ] Agreed what is out of scope

`robots.txt` compliance is handled by the crawler, but that is not the same as
having consent. If the imagery is licensed to the client rather than owned by
them, that is a scope conversation, not a technical one.

---

## Phase 2 — Recon

Never start with a full crawl. A bounded crawl tells you what the extractors can
and cannot read, in about a minute.

```bash
pnpm modernize --url acme.example --max-pages 20 --out output/recon
```

Then **read the report** — this is the step that decides the rest of the project:

```bash
$EDITOR output/recon/report.md
```

- [ ] Page list and kinds (`home`, `page`, `service`, `post`, `contact`, `legal`)
      — are any important pages missing or misclassified?
- [ ] Sections per page — which blocks were recognised?
- [ ] Section-list and skip-list — *why* were pages skipped?
- [ ] Palette evidence table — do the detected colours match the brand?
- [ ] Fonts detected — do they match the brand guidelines?
- [ ] Redirects list — are the URL changes acceptable, and is anything 404ing?

**Gate 2:** the report accounts for every page you expected. Anything missing is
either a robots/filter issue, a JavaScript-only page, or a link the crawler never
saw — all three are cheap to fix now and expensive to discover after launch.

Record the findings in `docs/SITE-NOTES.md` under *Recon crawl*.

---

## Phase 3 — Full crawl

```bash
pnpm scrape --url acme.example                                  # default: up to 60 pages
pnpm scrape --url acme.example --max-pages 250 --concurrency 6  # bigger site
pnpm scrape --url acme.example --render                         # JS-rendered site
pnpm scrape --url acme.example --include '^(/services|/about)'  # partial re-crawl
```

Raw HTML is kept in `output/<host>/raw/`, so you can re-run step 4 without
touching the client's server again — polite and much faster to iterate on.

- [ ] Check the crawl ended with `0 failed` requests
- [ ] `site.config.json` now reads `"status": "crawled"`

---

## Phase 4 — Generate

```bash
pnpm generate --url acme.example --from-cache
```

Writes the site's content, `src/data/site.json`, `src/styles/brand.css`,
redirects and the report. Re-running is safe: generated collections are reset
first and hand-written files are never touched.

```bash
pnpm check        # content validates against the schema + types are sound
pnpm dev          # look at it
```

**Gate 3:** `pnpm check` passes. A schema failure means an extractor produced a
block the site cannot render — read the error, it names the file and the field.

- [ ] `site.config.json` now reads `"status": "generated"`
- [ ] `git add -A && git commit -m "Generated from <source>"` ← commit the raw
      output *before* you start editing, so every hand-edit is reviewable

---

## Phase 5 — Content review

This is the phase that takes the longest, and the one where the tool cannot help
you. Work page by page through `apps/site/src/content/`.

Per page:

- [ ] Title and description are the *old* page's, not the site name
- [ ] The main copy reads in the right order (run-on paragraphs are the usual sign
      that a layout used CSS columns or a slider)
- [ ] Nothing important was dropped — compare against the raw HTML in
      `output/<host>/raw/` when in doubt
- [ ] Boilerplate was *not* carried across (cookie banners, "read more" repeats,
      sidebar promos)
- [ ] Headings make sense as an outline, and no page has two `<h1>`s
- [ ] Links go somewhere real (no `href="#"`, no dead internal paths)
- [ ] Images have meaningful alt text — a photo of a person is not "IMG_2043"
- [ ] Tables survived (tables are where HTML→Markdown conversions break first)
- [ ] Numbers, prices, phone numbers and addresses are unchanged

Cross-page:

- [ ] Navigation is the client's real menu, in the right order, with the right
      labels — and any item whose target is out of scope was removed deliberately
- [ ] Footer columns are grouped correctly
- [ ] Contact details are consistent everywhere
- [ ] Testimonials and FAQs are attributed to the right people/pages

Fix content in the Markdown files (`apps/site/src/content/**`). If the *same*
problem appears on every page, fix the extractor in
`tools/scraper/src/extract/` and re-run phase 4 instead — that is where the
toolkit gets better for the next client, and it is worth the extra ten minutes.

---

## Phase 6 — Design review

Compare the rebuild against the original **on the same content**, and record
every decision in `docs/SITE-NOTES.md`.

| What the tool produced | What it should be | Where to change it |
| --- | --- | --- |
| A long `richText` block | `features`, `steps` or `imageText` split | Split the Markdown into blocks (see the schema in `apps/site/src/content.config.ts`) |
| `features` with wrong icons | Correct icon names | Check the list in `apps/site/src/components/Icon.astro` |
| `gallery` of mixed image sizes | Better selection/crops | Trim `images:` in the frontmatter |
| Palette close but not exact | The real brand values | `apps/site/src/styles/brand.css` (or fix `tools/scraper/src/brand.ts`) |
| Wrong heading/body fonts | The brand's fonts | `fonts` array in `apps/site/astro.config.mjs`, then `--font-heading`/`--font-body` |
| A `contact` block with no form | A working form | Point `form.action` at Formspree/Netlify/Worker |
| Sections in the wrong order | The order that sells | Reorder `sections:` in the frontmatter |

- [ ] Type scale and spacing feel deliberate, not default
- [ ] Colour contrast is comfortable (no grey-on-grey from a faint brand colour)
- [ ] Dark mode looks considered, not merely inverted — check `data-theme` in the
      theme toggle
- [ ] Mobile: every block at 320 px, 375 px and 768 px
- [ ] Empty states: a block with no items should not leave a hole
- [ ] Images are the right crops (the `sizes` prop on `SmartImage` controls which
      variants are generated)

**Gate 4:** the client (or the designer) has seen it and signed off. Record the
date in `docs/SITE-NOTES.md`, and set `"status": "reviewed"` in `site.config.json`.

---

## Phase 7 — Technical QA

Run these in order; each one catches a different class of problem.

```bash
pnpm test                     # the toolkit itself still works
pnpm check                    # content + types
pnpm build                    # production build
pnpm preview                  # serve dist/ and click around
```

- [ ] Build succeeds with no warnings about missing content or images
- [ ] Every page in the sitemap loads: `curl -I https://…/<page>` in a loop
- [ ] **Redirects**: every entry in `output/<host>/_redirects` resolves to a 200.
      Spot-check at least: home, the old contact URL, and every URL in the report
- [ ] Canonicals point at the *new* domain once `PUBLIC_SITE_URL` is set
- [ ] `/sitemap-index.xml`, `/robots.txt` and `/rss.xml` are correct and the
      sitemap contains only canonical URLs
- [ ] No `noindex` leaked from a draft page
- [ ] Images: none 404, none stretched, none over ~300 kB
- [ ] Keyboard: tab through the header, menu, FAQ and form — focus is always visible
- [ ] Screen reader pass on the home and contact pages (headings, landmarks, form labels)
- [ ] Lighthouse: performance and accessibility ≥ 95 on the home page
- [ ] Structured data validates (Rich Results test) for the organisation and any articles
- [ ] `git status` shows no stray artefacts, and `site.config.json` is committed

**Gate 5:** all of the above pass on the staging deployment, not just locally.

---

## Phase 8 — Deploy

Deploy to staging first, with the staging origin so canonicals are correct while
you test:

```bash
echo 'PUBLIC_SITE_URL=https://staging.acme.example' >> .env
pnpm build
# deploy dist/ to the host, then run phase 7 against the staging URL
```

Then production:

```bash
# .env → PUBLIC_SITE_URL=https://www.acme.example
pnpm build
```

- [ ] Redirects deployed with the site:
      **Netlify/Cloudflare Pages** — `output/<host>/_redirects` (already in the
      right format; copy it into `public/`)
      **Vercel** — translate into `vercel.json` `"redirects"`
      **nginx/Apache** — translate into `return 301` / `Redirect 301` rules
- [ ] Custom domain and HTTPS configured
- [ ] Old site reachable at a fallback URL for at least 30 days
- [ ] `robots.txt` on the *new* site allows crawling (remove any staging `Disallow`)
- [ ] Analytics/consent scripts re-added if the client depends on them

---

## Phase 9 — Post-launch

- [ ] Submit `sitemap-index.xml` in Search Console; request indexing for the home page
- [ ] Watch Search Console → Pages for coverage errors for the first week
- [ ] Check the host's 404 log after 48 hours and 7 days; add any missed redirect
- [ ] Confirm the old site's traffic is being 301'd, not dropped
- [ ] Archive `output/<host>/` with the project (it is the only copy of the
      original site's HTML)
- [ ] Fill in the *Launch* section of `docs/SITE-NOTES.md` and set
      `"status": "launched"` in `site.config.json`
- [ ] Hand over: `site.config.json`, `docs/SITE-NOTES.md`, the redirect map and
      the content guide

### What actually goes wrong, and when

| Symptom | Usual cause | Fix |
| --- | --- | --- |
| Rankings dip for 2–4 weeks | Normal after a rebuild while search engines re-crawl | Do not change anything; verify redirects and canonicals, then wait |
| A page 404s that used to rank | URL changed without a redirect | Add it to `output/<host>/_redirects` and redeploy |
| Contact form silently does nothing | Static build with no handler behind `form.action` | Point it at a real endpoint |
| Images look soft | Source images were small but `sizes` asks for more | Fix the `sizes` prop, or accept the source resolution |
| Fonts flash on load | Brand font not preloaded | Add `preload` to the `<Font />` in `BaseLayout.astro` |

---

## Keeping the base sharp

When something was wrong in a way **any** site would hit, fix the base — not just
the instance. That is the whole point of doing this repeatedly.

```bash
cd ~/projects/jcwh            # the base
# make the fix
pnpm test && pnpm check && pnpm build     # must be green before it becomes the base
git commit -am "Extractor: handle nested accordions"
git tag base-v0.1.1
```

### Pulling base improvements into an existing site

Merging wholesale fights with generated content, so pull **specific paths** from
the base instead:

```bash
cd "$JCWH_SITES_DIR/acme-corp"
git fetch upstream --tags
git checkout upstream/main -- \
  apps/site/src/components \
  apps/site/src/layouts \
  apps/site/src/utils \
  apps/site/src/styles/global.css \
  tools/scraper
pnpm install && pnpm check && pnpm build
```

**Never** sync these from the base — they are per-site:

- `apps/site/src/content/**` (generated, then hand-edited)
- `apps/site/src/data/site.json`, `apps/site/src/styles/brand.css` (generated)
- `apps/site/astro.config.mjs` (the `site` and `fonts` differ per client)
- `site.config.json`, `docs/SITE-NOTES.md`

---

## Managing several sites

One directory per client, all created from the same base:

```
$JCWH_SITES_DIR/
├── acme-corp/          status: launched    base-v0.1.0
├── brightside-dental/  status: generated   base-v0.1.1
└── verde-insurance/    status: scaffolded  base-v0.1.1
```

List every instance and where it is in the workflow:

```bash
for f in "$JCWH_SITES_DIR"/*/site.config.json; do
  node -e 'const s=require(process.argv[1]);
    console.log([String(s.slug).padEnd(22), String(s.status).padEnd(11),
      ("base " + (s.base?.tag ?? "-")).padEnd(15), s.sourceUrl || "-"].join(" "))' "$f"
done
```

Keep `site.config.json` committed in each instance — it is the dashboard, and the
scraper updates it automatically as you run the phases.

---

## Rough effort guide

For a 20-page brochure site, from the first scaffold to launch. A planning aid,
not a promise; content volume and review cycles dominate.

| Phase | Typical effort | Notes |
| --- | --- | --- |
| Scaffold | minutes | |
| Recon | 30 min | Mostly reading the report carefully |
| Crawl + generate | minutes | Longer for 100+ page sites |
| Content review | **1–3 days** | The real work; scales with page count |
| Design review | 0.5–2 days | Faster on the second site — patterns repeat |
| Technical QA | 2–4 hours | Redirects and accessibility take the longest |
| Deploy + post-launch | 1–2 hours | Plus passive monitoring |

The second and third sites are meaningfully faster: the block vocabulary, the
review checklist and the extractors all improve as you go.

---

## Quick reference

```bash
# New site
pnpm new-site acme-corp --url acme.example
cd "$JCWH_SITES_DIR/acme-corp" && pnpm install

# Recon, then read the report
pnpm modernize --url acme.example --max-pages 20 --out output/recon
$EDITOR output/recon/report.md

# Full run
pnpm scrape   --url acme.example
pnpm generate --url acme.example --from-cache

# Verify
pnpm check && pnpm test && pnpm build && pnpm preview
```

| If you need to… | Do this |
| --- | --- |
| See what the tool read from a site | `output/<host>/report.md` |
| See the original markup of a page | `output/<host>/raw/<path>.html` |
| Re-generate without re-crawling | `pnpm generate --url <site> --from-cache` |
| Crawl a JavaScript-rendered site | `pnpm scrape --url <site> --render` |
| Crawl only part of a site | `--include '^(/services|/about)'` / `--exclude '/blog'` |
| Add a new kind of block | README → *Adding a block* (schema → component → renderer → extractor) |
| Change the brand palette | `apps/site/src/styles/brand.css` |
| Change layout or SEO tags | `apps/site/src/layouts/BaseLayout.astro` |
| Run the fixture site by hand | `pnpm --filter ./tools/scraper serve-fixture` |

---

## Phase record

Sign each gate off as you pass it. Copy this table into `docs/SITE-NOTES.md` per
site, or keep one per project management system — either way, the point is that
"done" has a definition.

| # | Gate | Passed when | Date |
| --- | --- | --- | --- |
| 1 | Instance runs | `pnpm dev` renders the placeholder page | |
| 2 | Recon accounted for | Report explains every expected page | |
| 3 | Content builds | `pnpm check` passes on generated content | |
| 4 | Reviewed | Client/designer signed off the rebuild | |
| 5 | Staging verified | Phase 7 checklist green on staging | |
| 6 | Launched | Production deployed, redirects live, sitemap submitted | |
| 7 | Post-launch clean | No new 404s after 7 days | |



