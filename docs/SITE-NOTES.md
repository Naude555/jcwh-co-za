# JC Wendy Houses — migration notes

Base template: `base-v0.1.5` (scaffolded from `base-v0.1.0`, tooling synced since)
Source site: https://www.jcwh.co.za/index.html
Started: 2026-09-28

Fill this in as you go. It is the record of what the tool did, what you changed,
and what the client agreed to — which is what makes the next site faster.

## What the source site is

Hand-written XHTML 1.1 from 2010 (last modified 2010-02-24), served from Apache.
No CMS, no robots.txt, no sitemap. Four real pages plus 19 gallery detail pages:

| Old URL | New URL | Notes |
| --- | --- | --- |
| `/index.html` | `/` | welcome text |
| `/cat.html` | `/cat` | sizes/doors/windows table + delivery notes |
| `/gallery.html` | `/gallery` | 19 thumbnails → detail pages |
| `/contact.html` | `/contact` | phones, fax, postal address, email |
| `/p1.html` … `/p20.html` | `/p1` … `/p20` | one photo + "Back to Gallery" each |

Runtime: 23 pages, 46 assets (5.1 MB), 0 assets left remote, 23 redirects generated.

## Decisions taken by the tool (check these)

- **Site name**: "JC Wendy Houses", voted from the segment all page titles share.
- **Navigation**: read from the `alt` text of the image buttons (Home, Catalogue,
  Gallery, Contact Us). Home was re-added because the home page cannot link to itself.
- **Contact**: phone `(021) 905-8335` (not the fax), address "PO Box 963,
  Kuilsrivier 7580, South Africa", email `jcwh@mweb.co.za` — merged from `/contact`.
- **Palette**: primary `oklch(41.4% .0727 63.3)` = the old link brown `#67421D`;
  surfaces are the site's own cream/sand tints (`#d8bd89`, `#E7D5B4`). Dark theme
  is generated from the same hue.
- **Fonts**: Georgia (the only font the site specifies).
- **Gallery**: 19 thumbnails promoted to the full-size photos on their detail pages.

## Open questions for the client

- [x] **The 19 `/p1`–`/p20` pages — resolved.** `--fold-galleries` retired them: they
      are no longer built, and `/p1.html` … `/p20.html` 301 to `/gallery` (19
      redirects in `_redirects`). The full-size photos live in the gallery now, and
      the home page features the first six with a "See all photos" button.
- [ ] **Photo captions.** The gallery images only have numeric alt text ("1"–"20")
      from the old site. Real alt text is needed for accessibility and SEO.
- [ ] **Source image quality.** Photos are 600×388 (2010-era). Ask for originals
      before this goes live, or the gallery will look soft on large screens.
- [ ] **Logo.** Your mark is in the header, but `assets/images/logo.svg` is an
      interim vector drawn from it — swap in your own export (see below).
- [ ] **Tagline.** Currently "Welcome to JC Wendy Houses Online", lifted from the old
      page's own heading. Worth writing a real one.
- [ ] **Content depth.** The home page is 196 words and the catalogue has no prices.
      A modernisation is the moment to ask for room, delivery and price information.
- [ ] **`p14` never existed** in the old site's numbering (19 photos, not 20).
- [ ] **The "See all photos" label** on the home teaser is UI copy the tool wrote.
      Say the word and it becomes whatever you prefer.

## Access and permissions

- [ ] Written permission to copy the site's content and imagery
- [ ] Staging URL / host access
- [ ] Who signs off the design review

## Scope

- Pages in scope: 4 core pages, 19 gallery pages (see open question above)
- Pages deliberately excluded (and why):
- Sections of the old site that are dropped:

## Recon crawl

- Report reviewed on:
- Pages found / pages crawled: 4 main + 19 gallery detail = 23
- Block detection summary: hero + richText on prose pages; gallery on `/gallery`
- Palette and fonts detected: brown primary, cream/sand surfaces; Georgia
- Surprises (missing content, JS-only pages, blocked paths): no robots.txt or
  sitemap (link-following only); image-based navigation; table-based page layout;
  no `<h1>` anywhere (headings start at `<h4>`)

## Design decisions (agreed with the client)

- **Light view only.** Built with `--theme light`: no dark palette is applied, no
  theme switch is rendered, and `color-scheme: light` is set. Re-run with
  `--theme auto` to get the dark theme and switch back.
- **Home hero.** The old site's "Home" image button was being used as a hero image,
  stretched across the page. Heroes now only ever use images from the page's own
  content, so the home page is a centred text hero. Source fix: `base-v0.1.6`.
- **Hero buttons.** The home hero links to Catalogue (primary) and Contact Us,
  taken from the site's own navigation — the old site had no buttons of its own.
- **Gallery.** `--fold-galleries`. The 19 thumbnail detail pages are retired and
  301'd to `/gallery`; the home page features six photos with a "See all photos"
  link. The photos themselves are the full-size images from the detail pages.
- **Logo.** `apps/site/src/assets/images/logo.svg`, applied with
  `--logo assets/images/logo.svg` so a re-crawl cannot drop it.
  **This file is an interim vector drawn from the client's mark — replace it with
  their own export** (see below).
- **Favicon.** `apps/site/public/favicon.svg`, the house mark on the cream tint.
- **Icons.** `apps/site/public/favicon.svg` (house mark) plus the PNG set generated
  from it with `pnpm icons`: `favicon-32x32.png`, `apple-touch-icon.png`,
  `icon-192.png`, `icon-512.png`. Regenerate whenever the mark changes.
- **Gallery lightbox.** Thumbnails open at full size in a native `<dialog>`, with a
  small inline script — no library, and without JavaScript the link still opens the
  image file.
- **Contact page.** Trimmed to hero + contact block: the tool now removes the
  phone/fax/email/address list from the prose once the block renders it, so nothing
  is printed twice.
- **Attribution.** Footer reads "Built by eptsolution.com", linked. Change
  `footer.credit` / `footer.creditUrl` in `src/data/site.json` to change it.
- **Palette** (unchanged, from the old stylesheet): primary
  `oklch(41.4% .0727 63.3)` = the link brown `#67421D`; surfaces from
  `#d8bd89` / `#E7D5B4`.
- **Fonts**: Georgia (the only font the old site names).

### Swapping in the real logo

Drop the export into `apps/site/src/assets/images/` and re-generate — no crawl
needed, so this takes seconds:

```bash
# replace the placeholder (keep the name, or use your own and pass it below)
cp ~/Downloads/jcwh-logo.svg apps/site/src/assets/images/logo.svg

pnpm generate --url https://www.jcwh.co.za --theme light --logo assets/images/logo.svg
pnpm build
```

For a PNG or a differently named file, change the `--logo` path to match
(`--logo assets/images/logo.png`). The header renders it at 32–36px tall, so a
horizontal lockup with a transparent background works best.

## URLs and redirects

- URLs that changed shape: all 23 `.html` URLs → clean paths (see `_redirects`)
- `_redirects` deployed with the site: yes / no
- Spot-checked redirects:

## Review checklist

See `docs/WORKFLOW.md` for the full list. Record the date each gate passed:

- [ ] Content review — date:
- [ ] Design review — date:
- [ ] Technical QA (links, images, metadata, a11y) — date:
- [ ] Client sign-off — date:

## Launch

- Deployed to:
- Deployed on:
- Sitemap submitted:
- Post-launch 404 check — date:
