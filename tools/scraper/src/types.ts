/**
 * Shapes shared by the whole pipeline.
 *
 * The `Section` union mirrors the content schema in
 * apps/site/src/content.config.ts — the scraper writes content that the site
 * validates at build time, so any change must be made in both places.
 */

export type ButtonStyle =
  | "primary"
  | "secondary"
  | "accent"
  | "neutral"
  | "outline"
  | "ghost"
  | "link";

export interface ImageRef {
  /** Either `assets/images/<file>` (downloaded) or an absolute URL (kept remote). */
  src: string;
  alt: string;
  width?: number;
  height?: number;
}

export interface Action {
  label: string;
  href: string;
  style?: ButtonStyle;
  icon?: string;
}

export interface NavChild {
  label: string;
  href: string;
  description?: string;
}

export interface NavItem {
  label: string;
  href: string;
  description?: string;
  icon?: string;
  children?: NavChild[];
}

export interface FaqItem {
  question: string;
  answer: string;
}

export interface Testimonial {
  quote: string;
  name: string;
  role?: string;
  company?: string;
  rating?: number;
  avatar?: ImageRef;
}

export interface StatItem {
  value: string;
  label: string;
  description?: string;
}

export interface StepItem {
  title: string;
  body?: string;
  icon?: string;
}

export interface FeatureItem {
  icon?: string;
  title: string;
  body?: string;
  href?: string;
  image?: ImageRef;
}

export interface LogoItem {
  name: string;
  image?: ImageRef;
  href?: string;
}

export interface PersonItem {
  name: string;
  role?: string;
  bio?: string;
  email?: string;
  phone?: string;
  photo?: ImageRef;
}

export interface PricingTier {
  name: string;
  price?: string;
  period?: string;
  description?: string;
  features: string[];
  featured?: boolean;
  actions?: Action[];
}

export interface ContactField {
  name: string;
  label: string;
  type: "text" | "email" | "tel" | "textarea" | "select" | "url";
  required?: boolean;
  options?: string[];
  placeholder?: string;
  half?: boolean;
}

export interface ContactDetail {
  icon?: string;
  label: string;
  value: string;
  href?: string;
}

export type Section =
  | {
      type: "hero";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      body?: string;
      image?: ImageRef;
      actions?: Action[];
      variant?: "split" | "centered" | "overlay";
      align?: "left" | "center";
    }
  | {
      type: "richText";
      eyebrow?: string;
      heading?: string;
      body: string;
      narrow?: boolean;
    }
  | {
      type: "features";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      columns?: number;
      items: FeatureItem[];
    }
  | {
      type: "imageText";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      body?: string;
      image: ImageRef;
      bullets?: string[];
      actions?: Action[];
      reverse?: boolean;
    }
  | {
      type: "stats";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      items: StatItem[];
    }
  | {
      type: "gallery";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      columns?: number;
      images: ImageRef[];
    }
  | {
      type: "logos";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      items: LogoItem[];
    }
  | {
      type: "testimonials";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      columns?: number;
      items: Testimonial[];
    }
  | {
      type: "faq";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      items: FaqItem[];
    }
  | {
      type: "steps";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      items: StepItem[];
    }
  | {
      type: "pricing";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      note?: string;
      tiers: PricingTier[];
    }
  | {
      type: "team";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      columns?: number;
      members: PersonItem[];
    }
  | {
      type: "cta";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      body?: string;
      actions?: Action[];
      style?: "primary" | "neutral" | "soft" | "accent";
    }
  | {
      type: "contact";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      body?: string;
      details?: ContactDetail[];
      form?: {
        action: string;
        method?: "post" | "get";
        submitLabel?: string;
        fields: ContactField[];
      };
    }
  | {
      type: "embed";
      eyebrow?: string;
      heading?: string;
      subheading?: string;
      url: string;
      aspect?: "video" | "wide" | "square";
    };

/* -------------------------------------------------------------------------- *
 * Crawl output
 * -------------------------------------------------------------------------- */

/** What a page looks like once it has been classified and rebuilt as blocks. */
export type PageKind = "home" | "page" | "post" | "service" | "contact" | "legal";

export interface Heading {
  level: number;
  text: string;
  id?: string;
}

export interface PageLink {
  href: string;
  label: string;
  external: boolean;
}

export interface ScrapedPage {
  /** Absolute URL on the source site. */
  url: string;
  /** Site-relative path, e.g. `/about`. */
  path: string;
  /** Content collection id, e.g. `about` (`index` for the home page). */
  id: string;
  kind: PageKind;
  title: string;
  description: string;
  canonical?: string;
  lang?: string;
  headings: Heading[];
  /** Main content as Markdown, in document order. */
  markdown: string;
  /** Main content as plain text, used for classification and scoring. */
  text: string;
  images: ImageRef[];
  links: PageLink[];
  sections: Section[];
  /** Contact details found on this page, merged site-wide by the generator. */
  contact: ContactInfo;
  /** Social links found on this page, merged site-wide by the generator. */
  socials: { label: string; href: string }[];
  /**
   * Images inside the page's main content, which is what a hero or a social card
   * should use. `images` also holds site chrome such as navigation buttons.
   */
  contentImages: ImageRef[];
  /**
   * Images that link to another page (thumbnails). Used after the crawl to swap a
   * thumbnail for the larger image on the page it points at.
   */
  imageLinks: { src: string; href: string }[];
  publishedAt?: string;
  updatedAt?: string;
  author?: string;
  tags: string[];
  status: number;
  depth: number;
  warnings: string[];
}

/** A navigation/footer link set recovered from the source site chrome. */
export interface SiteNavigation {
  primary: NavItem[];
  actions: { label: string; href: string; icon?: string }[];
  footer: NavItem[];
}

export interface FooterColumn {
  title: string;
  links: { label: string; href: string }[];
}

export interface ContactInfo {
  email: string;
  phone: string;
  address: {
    street: string;
    city: string;
    region: string;
    postalCode: string;
    country: string;
  };
  hours: { days: string; hours: string }[];
}

export interface BrandPalette {
  /** Raw evidence: the colours we found and how often they appeared. */
  evidence: { color: string; count: number; source: string }[];
  light: Record<string, string>;
  dark: Record<string, string>;
}

export interface BrandFonts {
  heading: string;
  body: string;
  evidence: { family: string; count: number }[];
}

export interface SiteProfile {
  name: string;
  legalName: string;
  tagline: string;
  description: string;
  url: string;
  locale: string;
  logo: { src: string; alt: string; text: string };
  contact: ContactInfo;
  socials: { label: string; href: string; icon?: string }[];
  navigation: SiteNavigation;
  footer: { tagline: string; columns: FooterColumn[]; legal: string; credit: string };
  testimonials: Testimonial[];
  faqs: FaqItem[];
  logos: LogoItem[];
  palette: BrandPalette;
  fonts: BrandFonts;
  radii: { selector: string; field: string; box: string };
}

export interface AssetRecord {
  sourceUrl: string;
  /** Path relative to the site's src/ directory, e.g. `assets/images/hero-1a2b.jpg`. */
  localPath: string;
  kind: "image" | "document" | "font" | "other";
  bytes: number;
  width?: number;
  height?: number;
  contentType?: string;
  /** Set when the asset was kept remote or skipped, with the reason. */
  skipped?: string;
}

export interface RedirectRecord {
  from: string;
  to: string;
  reason: string;
}

export interface MigrationReport {
  source: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  pages: {
    url: string;
    path: string;
    kind: PageKind;
    title: string;
    depth: number;
    images: number;
    words: number;
    sections: string[];
    warnings: string[];
  }[];
  skipped: { url: string; reason: string }[];
  assets: AssetRecord[];
  assetTotals: { downloaded: number; bytes: number; remote: number; failed: number };
  redirects: RedirectRecord[];
  palette: BrandPalette;
  fonts: BrandFonts;
  warnings: string[];
}
