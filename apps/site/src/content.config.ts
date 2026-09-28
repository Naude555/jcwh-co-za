import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";

/* ------------------------------------------------------------------------- *
 * Shared primitives
 * ------------------------------------------------------------------------- */

/** A local (or remote) image plus the alt text we recovered while scraping. */
const image = z.object({
  src: z.string(),
  alt: z.string().default(""),
  width: z.number().int().positive().optional(),
  height: z.number().int().positive().optional(),
  credit: z.string().optional(),
});

const action = z.object({
  label: z.string(),
  href: z.string().default("#"),
  style: z
    .enum(["primary", "secondary", "accent", "neutral", "outline", "ghost", "link"])
    .default("primary"),
  icon: z.string().optional(),
});

const heading = {
  eyebrow: z.string().optional(),
  heading: z.string().optional(),
  subheading: z.string().optional(),
};

const seo = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  image: z.string().optional(),
  noindex: z.boolean().default(false),
});

const columns = (fallback: number) => z.number().int().min(1).max(4).default(fallback);

const testimonial = z.object({
  quote: z.string(),
  name: z.string(),
  role: z.string().optional(),
  company: z.string().optional(),
  avatar: image.optional(),
  rating: z.number().min(1).max(5).optional(),
});

const faqItem = z.object({
  question: z.string(),
  answer: z.string(),
});

const person = z.object({
  name: z.string(),
  role: z.string().optional(),
  bio: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  photo: image.optional(),
  socials: z.array(action).default([]),
});

/* ------------------------------------------------------------------------- *
 * Section blocks — the composable vocabulary every page is rebuilt from.
 * tools/scraper emits these from the scraped DOM, and
 * src/components/sections/<type>.astro renders each one.
 * ------------------------------------------------------------------------- */

const section = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hero"),
    ...heading,
    body: z.string().optional(),
    image: image.optional(),
    actions: z.array(action).default([]),
    variant: z.enum(["split", "centered", "overlay"]).default("split"),
    align: z.enum(["left", "center"]).default("left"),
  }),
  z.object({
    type: z.literal("richText"),
    eyebrow: z.string().optional(),
    heading: z.string().optional(),
    body: z.string(),
    narrow: z.boolean().default(true),
  }),
  z.object({
    type: z.literal("features"),
    ...heading,
    columns: columns(3),
    items: z
      .array(
        z.object({
          icon: z.string().optional(),
          title: z.string(),
          body: z.string().optional(),
          href: z.string().optional(),
          image: image.optional(),
        }),
      )
      .default([]),
  }),
  z.object({
    type: z.literal("imageText"),
    ...heading,
    body: z.string().optional(),
    image,
    bullets: z.array(z.string()).default([]),
    actions: z.array(action).default([]),
    reverse: z.boolean().default(false),
  }),
  z.object({
    type: z.literal("stats"),
    ...heading,
    items: z
      .array(
        z.object({
          value: z.string(),
          label: z.string(),
          description: z.string().optional(),
        }),
      )
      .default([]),
  }),
  z.object({
    type: z.literal("gallery"),
    ...heading,
    columns: columns(3),
    images: z.array(image).default([]),
  }),
  z.object({
    type: z.literal("logos"),
    ...heading,
    items: z
      .array(
        z.object({
          name: z.string(),
          image: image.optional(),
          href: z.string().optional(),
        }),
      )
      .default([]),
  }),
  z.object({
    type: z.literal("testimonials"),
    ...heading,
    columns: columns(3),
    items: z.array(testimonial).default([]),
  }),
  z.object({
    type: z.literal("faq"),
    ...heading,
    items: z.array(faqItem).default([]),
  }),
  z.object({
    type: z.literal("steps"),
    ...heading,
    items: z
      .array(
        z.object({
          title: z.string(),
          body: z.string().optional(),
          icon: z.string().optional(),
        }),
      )
      .default([]),
  }),
  z.object({
    type: z.literal("pricing"),
    ...heading,
    note: z.string().optional(),
    tiers: z
      .array(
        z.object({
          name: z.string(),
          price: z.string().optional(),
          period: z.string().optional(),
          description: z.string().optional(),
          features: z.array(z.string()).default([]),
          featured: z.boolean().default(false),
          actions: z.array(action).default([]),
        }),
      )
      .default([]),
  }),
  z.object({
    type: z.literal("team"),
    ...heading,
    columns: columns(3),
    members: z.array(person).default([]),
  }),
  z.object({
    type: z.literal("cta"),
    ...heading,
    body: z.string().optional(),
    actions: z.array(action).default([]),
    style: z.enum(["primary", "neutral", "soft", "accent"]).default("soft"),
  }),
  z.object({
    type: z.literal("contact"),
    ...heading,
    body: z.string().optional(),
    details: z
      .array(
        z.object({
          icon: z.string().optional(),
          label: z.string(),
          value: z.string(),
          href: z.string().optional(),
        }),
      )
      .default([]),
    form: z
      .object({
        action: z.string().default("/api/contact"),
        method: z.enum(["post", "get"]).default("post"),
        submitLabel: z.string().default("Send message"),
        fields: z
          .array(
            z.object({
              name: z.string(),
              label: z.string(),
              type: z
                .enum(["text", "email", "tel", "textarea", "select", "url"])
                .default("text"),
              required: z.boolean().default(false),
              options: z.array(z.string()).default([]),
              placeholder: z.string().optional(),
              half: z.boolean().default(false),
            }),
          )
          .default([]),
      })
      .optional(),
  }),
  z.object({
    type: z.literal("embed"),
    ...heading,
    url: z.string(),
    aspect: z.enum(["video", "wide", "square"]).default("video"),
  }),
]);

/* ------------------------------------------------------------------------- *
 * Collections
 * ------------------------------------------------------------------------- */

/**
 * `index.md` -> `index`, `about/index.md` -> `about`, `blog/hello.md` -> `blog/hello`.
 * Keeping ids path-like means the rebuilt site can preserve the original URL
 * structure, which is what keeps SEO equity intact after a migration.
 */
function filePathToId(entry: string): string {
  return entry
    .replace(/\.[^.]+$/, "")
    .replace(/\/index$/, "")
    .replace(/^index$/, "index");
}

/** Provenance for every page we migrated, so the old site stays traceable. */
const sourceRef = z.object({
  url: z.string(),
  scrapedAt: z.coerce.date().optional(),
});

const contentPage = {
  title: z.string(),
  description: z.string().default(""),
  slug: z.string().optional(),
  draft: z.boolean().default(false),
  updatedAt: z.coerce.date().optional(),
  seo: seo.optional(),
  source: sourceRef.optional(),
};

/** A marketing/legal/landing page whose whole body is composed of section blocks. */
const pages = defineCollection({
  loader: glob({
    base: "./src/content/pages",
    pattern: "**/*.{md,mdx}",
    generateId: ({ entry }) => filePathToId(entry),
  }),
  schema: z.object({
    ...contentPage,
    template: z.enum(["marketing", "article", "legal", "contact"]).default("marketing"),
    breadcrumbs: z.array(z.object({ label: z.string(), href: z.string().optional() })).default([]),
    sections: z.array(section).default([]),
  }),
});

/** Long-form dated content (blog, news, insights) rendered from the Markdown body. */
const posts = defineCollection({
  loader: glob({
    base: "./src/content/posts",
    pattern: "**/*.{md,mdx}",
    generateId: ({ entry }) => filePathToId(entry),
  }),
  schema: z.object({
    title: z.string(),
    description: z.string().default(""),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    author: z.string().optional(),
    cover: image.optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    seo: seo.optional(),
    source: sourceRef.optional(),
  }),
});

/** Service detail pages, grouped under /services/<slug>. */
const services = defineCollection({
  loader: glob({
    base: "./src/content/services",
    pattern: "**/*.{md,mdx}",
    generateId: ({ entry }) => filePathToId(entry),
  }),
  schema: z.object({
    title: z.string(),
    summary: z.string().default(""),
    icon: z.string().optional(),
    image: image.optional(),
    price: z.string().optional(),
    highlights: z.array(z.string()).default([]),
    faqs: z.array(faqItem).default([]),
    order: z.number().default(0),
    draft: z.boolean().default(false),
    seo: seo.optional(),
    source: sourceRef.optional(),
  }),
});

export const collections = { pages, posts, services };
