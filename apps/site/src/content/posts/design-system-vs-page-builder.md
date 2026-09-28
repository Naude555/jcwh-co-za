---
title: Why a design system beats a page builder
description: Page builders optimise for the first page and punish you on the
  twentieth. Design tokens and reusable sections scale the other way round.
publishedAt: 2026-09-02
author: Daniel Okafor
tags:
  - design systems
  - astro
---

The first page built in a page builder is fast. The twentieth takes a week,
because every previous decision has to be re-negotiated by hand.

## Tokens first

Colour, type, spacing and radius should live in one place and be consumed
everywhere. In Tailwind CSS v4 and daisyUI they are CSS custom properties, which
means a rebrand is a handful of values rather than a search-and-replace across
twenty templates.

```css
@plugin "daisyui/theme" {
  name: "brand";
  --color-primary: oklch(54% 0.2 262);
  --radius-box: 1rem;
}
```

## Sections, not pages

A marketing site is not twenty unique layouts. It is maybe twelve section types —
hero, feature grid, testimonial, FAQ, call to action — arranged differently. Once
those are components, a new page is an arrangement, not a design project.

## Typed content

The single biggest source of quiet breakage in a long-lived site is content that
no longer matches the template. Validate it at build time instead: if a required
field is missing or a section type is misspelled, the build fails with the file
name and the reason.

> The goal is not fewer options. It is that the options available are the ones
> that were designed.

## What this buys you

Consistency without policing, a rebrand measured in minutes, and a codebase where
adding the twenty-first page is no slower than the first.
