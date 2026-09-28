// @ts-check
import { defineConfig, fontProviders } from "astro/config";
import tailwindcss from "@tailwindcss/vite";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";

/**
 * Site config for a modernized rebuild.
 *
 * `site` drives canonical URLs, the generated sitemap and RSS feed, so it must be
 * set to the production origin of whatever site we are modernizing.
 */
const remoteFonts = process.env.PUBLIC_REMOTE_FONTS !== "0";

export default defineConfig({
  site: process.env.PUBLIC_SITE_URL ?? "https://example.com",

  integrations: [mdx(), sitemap()],

  fonts: remoteFonts
    ? [
        {
          name: "Plus Jakarta Sans",
          cssVariable: "--font-heading",
          provider: fontProviders.fontsource(),
          weights: [500, 600, 700],
          styles: ["normal"],
          subsets: ["latin"],
          fallbacks: ["sans-serif"],
        },
        {
          name: "Inter",
          cssVariable: "--font-body",
          provider: fontProviders.fontsource(),
          weights: [400, 500, 600],
          styles: ["normal"],
          subsets: ["latin"],
          fallbacks: ["sans-serif"],
        },
      ]
    : undefined,

  // Tailwind CSS v4 is wired in through Vite (there is no tailwind.config.js in v4).
  vite: {
    plugins: [tailwindcss()],
  },

  // Remote images stay allowed only for the origin we migrated from; everything
  // downloaded by the scraper lives in src/assets and is optimized by Sharp.
  image: {
    remotePatterns: [],
  },

  prefetch: {
    prefetchAll: true,
    defaultStrategy: "viewport",
  },

  build: {
    inlineStylesheets: "auto",
  },

  markdown: {
    shikiConfig: {
      themes: { light: "github-light", dark: "github-dark" },
      wrap: true,
    },
  },
});
