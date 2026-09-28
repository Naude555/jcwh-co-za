import { z } from "astro/zod";
import raw from "./site.json";

/* ------------------------------------------------------------------------- *
 * Site data.
 *
 * `site.json` is written by `tools/scraper` (business details, navigation,
 * palette, provenance) and this module is the single typed entry point for it,
 * so every component reads validated data instead of raw JSON.
 * ------------------------------------------------------------------------- */

const social = z.object({
  label: z.string(),
  href: z.string(),
  icon: z.string().optional(),
});

const navItem = z.object({
  label: z.string(),
  href: z.string(),
  description: z.string().optional(),
  icon: z.string().optional(),
  children: z
    .array(
      z.object({
        label: z.string(),
        href: z.string(),
        description: z.string().optional(),
      }),
    )
    .optional(),
});

const address = z.object({
  street: z.string().default(""),
  city: z.string().default(""),
  region: z.string().default(""),
  postalCode: z.string().default(""),
  country: z.string().default(""),
});

/** Used when site.json omits contact details entirely. */
const emptyAddress = { street: "", city: "", region: "", postalCode: "", country: "" };
const emptyFonts = { heading: "", body: "" };

const siteSchema = z.object({
  name: z.string(),
  legalName: z.string().default(""),
  tagline: z.string().default(""),
  description: z.string().default(""),
  url: z.url(),
  locale: z.string().default("en"),

  logo: z.object({
    src: z.string().default(""),
    alt: z.string().default(""),
    text: z.string().default(""),
  }),

  contact: z.object({
    email: z.string().default(""),
    phone: z.string().default(""),
    address: address.default(emptyAddress),
    hours: z
      .array(z.object({ days: z.string(), hours: z.string() }))
      .default([]),
  }),

  socials: z.array(social).default([]),

  navigation: z.object({
    primary: z.array(navItem).default([]),
    actions: z.array(social).default([]),
    footer: z.array(navItem).default([]),
  }),

  footer: z.object({
    tagline: z.string().default(""),
    columns: z
      .array(z.object({ title: z.string(), links: z.array(navItem) }))
      .default([]),
    legal: z.string().default(""),
    credit: z.string().default(""),
  }),

  theme: z.object({
    /** "auto" follows the system colour scheme; "light" is light-only. */
    mode: z.enum(["auto", "light"]).default("auto"),
    light: z.string().default("brand"),
    dark: z.string().default("brand-dark"),
    fonts: z
      .object({ heading: z.string().default(""), body: z.string().default("") })
      .default(emptyFonts),
    /** Raw palette extracted from the source site, kept for reference. */
    palette: z.record(z.string(), z.string()).default({}),
  }),

  /** Where this build came from, so a migration stays traceable. */
  source: z.object({
    url: z.string().default(""),
    scrapedAt: z.string().nullable().default(null),
    pagesMigrated: z.number().int().nonnegative().default(0),
  }),
});

export type SiteConfig = z.infer<typeof siteSchema>;
export type NavItem = z.infer<typeof navItem>;
export type SocialLink = z.infer<typeof social>;
export type SiteAddress = z.infer<typeof address>;

const parsed = siteSchema.safeParse(raw);

if (!parsed.success) {
  throw new Error(
    `src/data/site.json does not match the expected shape. Fix the data or ` +
      `re-run \`pnpm modernize\`:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
  );
}

/**
 * The scraper records the *source* site's URL, which is the right default while
 * a migration is being reviewed. Set PUBLIC_SITE_URL at build time to publish
 * canonical URLs, the sitemap and structured data for the real domain.
 */
const publicUrl = import.meta.env.PUBLIC_SITE_URL;

export const site: SiteConfig = {
  ...parsed.data,
  ...(publicUrl ? { url: publicUrl } : {}),
};

/* ------------------------------------------------------------------------- *
 * Helpers
 * ------------------------------------------------------------------------- */

/** Turn a site-relative path into the canonical absolute URL. */
export function absoluteUrl(path = "/"): string {
  return new URL(path, site.url).href;
}

/** The wordmark, falling back to the site name when no logo file was found. */
export function logoText(): string {
  return site.logo.text || site.name;
}

export function hasLogo(): boolean {
  return site.logo.src.trim().length > 0;
}

/**
 * True when the site is built light-only.
 *
 * Used to hide the theme switch and skip the dark palette entirely — the right
 * choice when a brand's colours only work on light backgrounds.
 */
export function lightOnly(): boolean {
  return site.theme.mode === "light";
}

/** Street address as printable lines, ignoring empty parts. */
export function addressLines(): string[] {
  const { street, city, region, postalCode, country } = site.contact.address;
  const cityLine = [city, region, postalCode].filter(Boolean).join(", ");
  return [street, cityLine, country].map((l) => l.trim()).filter(Boolean);
}

/** `tel:`/`mailto:` friendly contact rows for the contact section. */
export function contactDetails(): { icon: string; label: string; value: string; href?: string }[] {
  const details: { icon: string; label: string; value: string; href?: string }[] = [];
  const lines = addressLines();

  if (site.contact.phone) {
    details.push({
      icon: "phone",
      label: "Phone",
      value: site.contact.phone,
      href: `tel:${site.contact.phone.replace(/[^\d+]/g, "")}`,
    });
  }
  if (site.contact.email) {
    details.push({
      icon: "mail",
      label: "Email",
      value: site.contact.email,
      href: `mailto:${site.contact.email}`,
    });
  }
  if (lines.length) {
    details.push({ icon: "map-pin", label: "Address", value: lines.join(", ") });
  }
  if (site.contact.hours.length) {
    details.push({
      icon: "clock",
      label: "Opening hours",
      value: site.contact.hours.map((h) => `${h.days}: ${h.hours}`).join(" · "),
    });
  }

  return details;
}
