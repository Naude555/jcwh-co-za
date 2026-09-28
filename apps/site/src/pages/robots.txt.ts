import type { APIRoute } from "astro";
import { site } from "../data/site";

/**
 * Generated rather than static so the sitemap URL always follows
 * PUBLIC_SITE_URL (staging and production deploy the same source).
 *
 * A preview deployment (PUBLIC_PREVIEW=1) is closed to crawlers, so a client demo
 * on a subdomain cannot compete with their live site in search results.
 */
export const GET: APIRoute = () => {
  const preview = import.meta.env.PUBLIC_PREVIEW === "1";

  const body = preview
    ? [
        "User-agent: *",
        "Disallow: /",
        "",
        "# Preview deployment: set PUBLIC_PREVIEW=0 to open it up.",
        "",
      ].join("\n")
    : [
        "User-agent: *",
        "Allow: /",
        "",
        `Sitemap: ${new URL("sitemap-index.xml", site.url).href}`,
        "",
      ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
