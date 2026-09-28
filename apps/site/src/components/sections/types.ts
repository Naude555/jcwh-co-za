import type { CollectionEntry } from "astro:content";

/**
 * Section prop types are derived from the content collection schema, so
 * src/content.config.ts stays the single source of truth: change a block there
 * and every component here fails to typecheck until it is updated.
 */
export type PageSection = CollectionEntry<"pages">["data"]["sections"][number];

/** Props for one specific block, e.g. `SectionOf<"hero">`. */
export type SectionOf<T extends PageSection["type"]> = Extract<PageSection, { type: T }>;

/** Props for the optional hero of a post/service page. */
export type Post = CollectionEntry<"posts">["data"];
export type Service = CollectionEntry<"services">["data"];
