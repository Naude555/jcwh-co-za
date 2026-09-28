---
title: How we migrate a legacy site without losing its search rankings
description: The URL mapping, metadata and redirect work that keeps a rebuild
  from undoing years of accumulated authority.
publishedAt: 2026-08-14
author: Sarah Whitfield
cover:
  src: assets/images/work1.jpg
  alt: Migration planning on a whiteboard
tags:
  - migration
  - seo
  - process
---

A rebuild is the most dangerous moment in a website's life. Every URL you change
is a chance to lose the authority that page accumulated. Here is the checklist we
run on every migration.

## 1. Crawl and freeze the current site

Before touching anything, crawl the live site and store the raw HTML of every
page that returns 200. That snapshot becomes the reference for the whole project:
it is how we prove nothing was dropped, and it is the only reliable source of
titles, descriptions and headings once the old site is gone.

## 2. Inventory URLs, one by one

Write down every URL and decide its fate:

- **Keep** — same path, same purpose, re-built as-is.
- **Move** — new path, so it needs a permanent (301) redirect.
- **Merge** — two thin pages become one stronger page.
- **Retire** — genuinely obsolete, and redirected to a relevant page, never to
  the home page as a catch-all.

A spreadsheet beats memory here. Every "retire" decision needs a destination.

## 3. Preserve metadata deliberately

Titles and descriptions are usually written by humans over years and represent
real search intent. Carry them across verbatim where the page still serves the
same purpose, and only rewrite them where the page itself has changed.

## 4. Rebuild the structure, not just the look

Structured data that described your organisation, services or articles should be
re-published in the new build. In Astro this is a component-level concern: the
layout emits the site-level nodes and each page adds its own, so the markup
cannot drift out of step with the content.

## 5. Verify before and after launch

The final step is mechanical: check that every redirect resolves, that
`sitemap-index.xml` contains only canonical URLs, that no `noindex` leaked from
staging, and that the rendered titles match the inventory. Only then switch the
domain.

Do this and a rebuild reads to search engines as a renovation of the same
building — which is exactly what it is.
