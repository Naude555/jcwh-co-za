import type { APIRoute } from "astro";
import { site } from "../data/site";

/**
 * Generated rather than static so the sitemap URL always follows
 * PUBLIC_SITE_URL (staging and production deploy the same source).
 */
export const GET: APIRoute = () => {
  const body = [
    "User-agent: *",
    "Allow: /",
    "",
    "# Uncomment on a staging deployment:",
    "# Disallow: /",
    "",
    `Sitemap: ${new URL("sitemap-index.xml", site.url).href}`,
    "",
  ].join("\n");

  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
