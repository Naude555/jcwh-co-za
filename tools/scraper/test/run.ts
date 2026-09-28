import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetStore } from "../src/assets.ts";
import { crawlSite } from "../src/crawl.ts";
import { extractBrand } from "../src/brand.ts";
import { generateSite } from "../src/generate.ts";
import { DEFAULTS, type Options } from "../src/config.ts";
import { createLogger } from "../src/utils/log.ts";
import { parseColor, rgbToOklch } from "../src/utils/color.ts";
import { startFixtureServer } from "./fixture-server.ts";

/**
 * Integration test.
 *
 * Serves the fixture site in `test/fixture` over HTTP, runs the whole pipeline
 * against it (crawl → brand → generate) into a temporary directory, and asserts
 * on the result. Nothing outside the temp directory is written, so running the
 * tests never touches apps/site.
 */

interface Check {
  name: string;
  passed: boolean;
  detail?: string;
}

const checks: Check[] = [];

function check(name: string, passed: boolean, detail?: string): void {
  checks.push({ name, passed, ...(detail ? { detail } : {}) });
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Create the minimal app layout generateSite writes into. */
async function makeSiteDirs(siteDir: string): Promise<void> {
  for (const dir of ["pages", "posts", "services"]) {
    await mkdir(join(siteDir, "src/content", dir), { recursive: true });
  }
  await mkdir(join(siteDir, "src/data"), { recursive: true });
  await mkdir(join(siteDir, "src/styles"), { recursive: true });
}

async function main(): Promise<void> {
  const server = await startFixtureServer();
  const root = join(tmpdir(), `jcwh-scraper-test-${Date.now()}`);
  const outDir = join(root, "output");
  const siteDir = join(root, "site");

  await makeSiteDirs(siteDir);

  const options: Options = {
    ...DEFAULTS,
    url: server.url,
    outDir,
    siteDir,
    maxPages: 20,
    concurrency: 3,
    delayMs: 0,
    include: null,
    exclude: [],
    logo: null,
  };

  const logger = createLogger(false);
  const store = new AssetStore({ siteDir, enabled: true, maxBytes: options.maxAssetBytes });

  const startedAt = Date.now();
  const crawl = await crawlSite(options, store, logger);
  const brand = extractBrand(crawl.cssTexts);
  const result = await generateSite(crawl, brand, options, logger, {
    startedAt,
    assetTotals: store.totals(),
    assets: store.all(),
  });
  await server.close();

  const byPath = new Map(crawl.pages.map((page) => [page.path, page]));
  const home = byPath.get("/");
  const about = byPath.get("/about");
  const contact = byPath.get("/contact");
  const service = byPath.get("/services/web-design");
  const post = byPath.get("/blog/why-rebuild");

  const sectionTypes = (page?: { sections: { type: string }[] }) =>
    (page?.sections ?? []).map((section) => section.type);
  const hasSection = (page: { sections: { type: string }[] } | undefined, type: string) =>
    sectionTypes(page).includes(type);

  /* ---- Crawl ---------------------------------------------------------- */
  check("discovers every sitemap URL", crawl.pages.length === 5, `got ${crawl.pages.length}`);
  check("home page classified as home", home?.kind === "home", String(home?.kind));
  check("about page classified as page", about?.kind === "page", String(about?.kind));
  check("contact page classified as contact", contact?.kind === "contact", String(contact?.kind));
  check("service page classified as service", service?.kind === "service", String(service?.kind));
  check("article classified as post", post?.kind === "post", String(post?.kind));
  check(".html URLs map to clean routes", byPath.has("/about") && !byPath.has("/about.html"));
  check("meta description recovered", (about?.description.length ?? 0) > 40, about?.description);
  check("post publish date parsed", Boolean(post?.publishedAt), post?.publishedAt);
  check("post author parsed", post?.author === "Dr Priya Raman", post?.author);

  /* ---- Blocks --------------------------------------------------------- */
  check("hero built from the h1", hasSection(home, "hero"));
  check("client logos recognised", hasSection(home, "logos"), sectionTypes(home).join(","));
  check("stats recognised", hasSection(home, "stats"), sectionTypes(home).join(","));
  check("gallery recognised", hasSection(home, "gallery"), sectionTypes(home).join(","));
  check("testimonials recognised", hasSection(home, "testimonials"), sectionTypes(home).join(","));
  check("steps recognised", hasSection(home, "steps"), sectionTypes(home).join(","));
  check("pricing recognised", hasSection(home, "pricing"), sectionTypes(home).join(","));
  check("faq recognised", hasSection(home, "faq"), sectionTypes(home).join(","));

  const faq = home?.sections.find((section) => section.type === "faq");
  check(
    "every <details> became an FAQ item",
    faq?.type === "faq" && faq.items.length === 3,
    faq?.type === "faq" ? `${faq.items.length} items` : "no faq",
  );

  const testimonials = home?.sections.find((section) => section.type === "testimonials");
  check(
    "testimonials carry a name",
    testimonials?.type === "testimonials" &&
      testimonials.items.length >= 2 &&
      testimonials.items.every((item) => item.name.length > 1),
    testimonials?.type === "testimonials" ? JSON.stringify(testimonials.items.map((i) => i.name)) : "",
  );

  const stats = home?.sections.find((section) => section.type === "stats");
  check(
    "stats have a value and a label",
    stats?.type === "stats" && stats.items.length === 3,
    stats?.type === "stats" ? JSON.stringify(stats.items.map((i) => `${i.value}/${i.label}`)) : "",
  );

  const pricing = home?.sections.find((section) => section.type === "pricing");
  check(
    "pricing tiers found with prices",
    pricing?.type === "pricing" && pricing.tiers.length >= 2,
    pricing?.type === "pricing" ? JSON.stringify(pricing.tiers.map((t) => `${t.name}:${t.price}`)) : "",
  );

  const hero = home?.sections.find((section) => section.type === "hero");
  check(
    "hero heading is the h1",
    hero?.type === "hero" && hero.heading === "Gentle dental care you can actually look forward to",
    hero?.type === "hero" ? hero.heading : "",
  );
  check(
    "hero actions come from the CTA buttons",
    hero?.type === "hero" && (hero.actions ?? []).length >= 1,
    hero?.type === "hero" ? JSON.stringify((hero.actions ?? []).map((a) => a.label)) : "",
  );
  check(
    "a hero image inside the content is still used",
    hero?.type === "hero" && Boolean(hero.image),
    hero?.type === "hero" ? JSON.stringify(hero.image?.src ?? null) : "",
  );
  check(
    "hero markup is not duplicated into the prose",
    (home?.sections ?? []).every(
      (section) => section.type !== "richText" || !section.body.includes("Gentle dental care"),
    ),
  );

  /* ---- Navigation, footer, contact ------------------------------------ */
  check(
    "primary navigation recovered",
    (crawl.chrome?.navigation.length ?? 0) >= 4,
    String(crawl.chrome?.navigation.length),
  );
  check(
    "footer grouped into columns",
    (crawl.chrome?.footerColumns.length ?? 0) >= 2,
    JSON.stringify(crawl.chrome?.footerColumns.map((column) => column.title)),
  );
  check("contact email recovered", crawl.chrome?.contact.email === "hello@brightside.example", crawl.chrome?.contact.email);
  check("contact phone recovered", (crawl.chrome?.contact.phone ?? "").includes("0113"), crawl.chrome?.contact.phone);
  check(
    "postal address recovered",
    (crawl.chrome?.contact.address.street ?? "").includes("Park Row"),
    crawl.chrome?.contact.address.street,
  );
  check(
    "social links recovered",
    (crawl.chrome?.socials ?? []).some((social) => social.label === "Facebook"),
    JSON.stringify(crawl.chrome?.socials),
  );
  check(
    "opening hours recovered",
    (crawl.chrome?.contact.hours.length ?? 0) >= 1,
    JSON.stringify(crawl.chrome?.contact.hours),
  );

  /* ---- Content quality ------------------------------------------------ */
  check("prose keeps the article text", (about?.markdown ?? "").includes("Brightside Dental opened in 2001"));
  check("prose excludes the footer", !(about?.markdown ?? "").includes("All rights reserved"));
  check("prose excludes the navigation", !(about?.markdown ?? "").includes("About us\n"));
  check(
    "markdown headings are preserved",
    (post?.markdown ?? "").includes("## What we are actually looking for"),
  );
  check("contact page gains a contact block", hasSection(contact, "contact"));

  /* ---- Assets --------------------------------------------------------- */
  check("report.json written", (await readFile(join(outDir, "report.json"), "utf8")).length > 0);
  check("raster images downloaded into src/assets/images", await exists(join(siteDir, "src/assets/images")));
  check("svg logo downloaded into public/images", await exists(join(siteDir, "public/images")));
  check(
    "downloaded images are referenced by local path",
    (home?.sections ?? []).some((section) => JSON.stringify(section).includes("assets/images/")),
  );
  check("asset totals recorded", store.totals().downloaded >= 4, JSON.stringify(store.totals()));

  /* ---- Brand ---------------------------------------------------------- */
  const themePrimary = brand.palette.light["primary"] ?? "";
  const themePrimaryRgb = parseColor(themePrimary);
  const themePrimaryHue = themePrimaryRgb ? rgbToOklch(themePrimaryRgb).h : -1;
  check(
    "brand hue carried into the generated theme",
    themePrimaryRgb !== null && themePrimaryHue > 150 && themePrimaryHue < 200,
    `${themePrimary} hue ${themePrimaryHue.toFixed(1)}`,
  );
  check(
    "teal brand colour found in the source CSS",
    brand.palette.evidence.some((entry) => entry.color.toLowerCase() === "#0f766e"),
    JSON.stringify(brand.palette.evidence.slice(0, 4)),
  );
  check("heading font detected", brand.fonts.heading === "Fraunces", brand.fonts.heading);
  check("body font detected", brand.fonts.body === "Work Sans", brand.fonts.body);
  check("border radius detected", brand.radii.box === "0.875rem", JSON.stringify(brand.radii));

  const brandCss = await readFile(join(siteDir, "src/styles/brand.css"), "utf8");
  check("brand.css declares the daisyUI theme", brandCss.includes('@plugin "daisyui/theme"'));
  check(
    "brand.css defines a light and a dark theme",
    brandCss.includes('name: "brand"') && brandCss.includes('name: "brand-dark"'),
  );

  /* ---- Generated site data and content -------------------------------- */
  const siteJson = JSON.parse(await readFile(join(siteDir, "src/data/site.json"), "utf8")) as {
    name: string;
    logo: { src: string };
    navigation: { primary: { href: string }[] };
    contact: { email: string };
    theme: { light: string };
  };
  check("site name from structured data", siteJson.name === "Brightside Dental", siteJson.name);
  check("logo points at the downloaded file", siteJson.logo.src.startsWith("/images/"), siteJson.logo.src);
  check(
    "navigation hrefs are site-relative",
    siteJson.navigation.primary.length > 0 &&
      siteJson.navigation.primary.every((item) => item.href.startsWith("/")),
    JSON.stringify(siteJson.navigation.primary.map((item) => item.href)),
  );
  check("site.json keeps the contact details", siteJson.contact.email === "hello@brightside.example");
  check("site.json references the generated theme", siteJson.theme.light === "brand");

  check("home page content written", await exists(join(siteDir, "src/content/pages/index.md")));
  check("about page content written", await exists(join(siteDir, "src/content/pages/about.md")));
  check(
    "post written to the posts collection",
    await exists(join(siteDir, "src/content/posts/blog/why-rebuild.md")),
  );
  check(
    "service written to the services collection",
    await exists(join(siteDir, "src/content/services/web-design.md")),
  );

  const indexFile = await readFile(join(siteDir, "src/content/pages/index.md"), "utf8");
  check("frontmatter has sections", indexFile.includes("sections:"));
  check("frontmatter keeps provenance", indexFile.includes("scrapedAt"));
  check("page files carry no duplicated prose body", (indexFile.split("---")[2] ?? "").trim() === "");

  /* ---- Redirects and report ------------------------------------------- */
  check("redirects cover the .html URLs", result.redirects >= 4, String(result.redirects));
  check("_redirects file written", await exists(join(outDir, "_redirects")));

  const report = JSON.parse(await readFile(join(outDir, "report.json"), "utf8")) as {
    pages: unknown[];
    palette: { light: Record<string, string> };
  };
  check("report lists every page", report.pages.length === 5, String(report.pages.length));
  check("report includes the generated light theme", Boolean(report.palette.light["primary"]));

  /* ---- Legacy site: image navigation, no <h1>, labelled contact -------- */
  const legacyServer = await startFixtureServer(0, "fixture-legacy");
  const legacyOptions: Options = {
    ...options,
    url: legacyServer.url,
    outDir: join(root, "legacy/output"),
    siteDir: join(root, "legacy/site"),
    // Exercise the optional gallery folding: a home page teaser plus stubs 301'd
    // into the gallery.
    foldGalleries: true,
  };
  await makeSiteDirs(legacyOptions.siteDir);

  const legacyStore = new AssetStore({
    siteDir: legacyOptions.siteDir,
    enabled: true,
    maxBytes: legacyOptions.maxAssetBytes,
  });
  const legacyStarted = Date.now();
  const legacyCrawl = await crawlSite(legacyOptions, legacyStore, createLogger(false));
  const legacyBrand = extractBrand(legacyCrawl.cssTexts);
  await generateSite(legacyCrawl, legacyBrand, legacyOptions, createLogger(false), {
    startedAt: legacyStarted,
    assetTotals: legacyStore.totals(),
    assets: legacyStore.all(),
  });
  await legacyServer.close();

  const legacyHome = legacyCrawl.pages.find((page) => page.path === "/");
  const legacyCatalogue = legacyCrawl.pages.find((page) => page.path === "/cat");
  const legacyHero = legacyHome?.sections.find((section) => section.type === "hero");
  const legacySite = JSON.parse(
    await readFile(join(legacyOptions.siteDir, "src/data/site.json"), "utf8"),
  ) as {
    name: string;
    navigation: { primary: { label: string; href: string }[] };
    contact: { phone: string; email: string; address: { street: string } };
  };

  check("site name voted from repeated title segments", legacySite.name === "Legacy Joinery", legacySite.name);
  check(
    "navigation labels come from image alt text",
    legacySite.navigation.primary.some((item) => item.label === "Catalogue") &&
      legacySite.navigation.primary.some((item) => item.label === "Contact Us"),
    JSON.stringify(legacySite.navigation.primary.map((item) => `${item.label}→${item.href}`)),
  );
  check(
    "home is restored to a menu that cannot link to itself",
    legacySite.navigation.primary[0]?.label === "Home" && legacySite.navigation.primary[0]?.href === "/",
    JSON.stringify(legacySite.navigation.primary[0]),
  );
  check(
    "phone merged into the site data from the contact page",
    legacySite.contact.phone === "(021) 555-1234",
    legacySite.contact.phone,
  );
  check(
    "fax is not mistaken for the phone number",
    !legacySite.contact.phone.includes("9999"),
    legacySite.contact.phone,
  );
  check(
    "postal address merged into the site data",
    legacySite.contact.address.street.includes("PO Box 1234"),
    legacySite.contact.address.street,
  );
  check(
    "email merged into the site data",
    legacySite.contact.email === "info@legacyjoinery.example",
    legacySite.contact.email,
  );
  check(
    "hero heading falls back to an <h4> when there is no <h1>",
    legacyHero?.type === "hero" && legacyHero.heading === "Welcome to Legacy Joinery",
    legacyHero?.type === "hero" ? legacyHero.heading : "no hero",
  );
  check(
    "chrome images never become the hero image",
    !(legacyHero?.type === "hero" && legacyHero.image),
    legacyHero?.type === "hero" ? JSON.stringify(legacyHero.image ?? null) : "no hero",
  );
  const legacyHomeMarkdown = await readFile(
    join(legacyOptions.siteDir, "src/content/pages/index.md"),
    "utf8",
  );
  const legacyGalleryMarkdown = await readFile(
    join(legacyOptions.siteDir, "src/content/pages/gallery.md"),
    "utf8",
  );
  const legacyRedirects = JSON.parse(
    await readFile(join(root, "legacy/output/redirects.json"), "utf8"),
  ) as { from: string; to: string }[];

  check(
    "the home page features the gallery and links to it",
    legacyHomeMarkdown.includes("- type: gallery") &&
      legacyHomeMarkdown.includes("See all photos") &&
      legacyHomeMarkdown.includes("href: /gallery"),
    legacyHomeMarkdown.split("- type: gallery")[1]?.trim().slice(0, 140) ?? "no gallery section",
  );
  check(
    "the gallery page keeps all of its photos",
    (legacyGalleryMarkdown.match(/- src:/g) ?? []).length >= 4,
    `${(legacyGalleryMarkdown.match(/- src:/g) ?? []).length} image(s)`,
  );
  check(
    "thumbnail stub pages are folded away",
    !(await exists(join(legacyOptions.siteDir, "src/content/pages/p1.md"))),
  );
  check(
    "folded pages 301 to the gallery",
    legacyRedirects.some((entry) => entry.from === "/p1.html" && entry.to === "/gallery"),
    JSON.stringify(legacyRedirects.filter((entry) => /^\/p\d/.test(entry.from))),
  );
  check(
    "the home hero links on using the site's own navigation",
    legacyHomeMarkdown.includes("- type: hero") &&
      legacyHomeMarkdown.includes("href: /cat") &&
      legacyHomeMarkdown.includes("href: /contact"),
    legacyHomeMarkdown.split("sections:")[1]?.trim().slice(0, 160) ?? "no sections",
  );
  check(
    "table caption rows are lifted out of the Markdown table",
    !(legacyCatalogue?.markdown ?? "").includes("| | | |") &&
      (legacyCatalogue?.markdown ?? "").includes("Various other sizes are available"),
    (legacyCatalogue?.markdown ?? "").slice(0, 220),
  );

  const legacyPrimaryRgb = parseColor(legacyBrand.palette.light["primary"] ?? "");
  const legacyPrimaryHue = legacyPrimaryRgb ? rgbToOklch(legacyPrimaryRgb).h : -1;
  check(
    "brown link colour becomes the primary, not the pale page background",
    legacyPrimaryHue > 35 && legacyPrimaryHue < 95,
    `hue ${legacyPrimaryHue.toFixed(1)} from ${legacyBrand.palette.light["primary"]}`,
  );
  const legacyBaseRgb = parseColor(legacyBrand.palette.light["base-200"] ?? "");
  check(
    "the brand's light tint carries into the surfaces",
    legacyBaseRgb !== null && rgbToOklch(legacyBaseRgb).c > 0.02,
    legacyBrand.palette.light["base-200"],
  );
  check(
    "an image-only detail page still migrates",
    legacyCrawl.pages.some((page) => page.path === "/p1" && page.images.length > 0),
  );
  check(
    "content images are not mistaken for a client logo strip",
    legacyCrawl.pages.every((page) => !page.sections.some((section) => section.type === "logos")),
    JSON.stringify(
      legacyCrawl.pages
        .flatMap((page) => page.sections.filter((section) => section.type === "logos"))
        .map((section) => section.type),
    ),
  );
  check(
    "gallery detail pages are flagged for review",
    (legacyCrawl.pages.find((page) => page.path === "/p1")?.warnings ?? []).some((warning) =>
      warning.includes("gallery detail page"),
    ),
    JSON.stringify(legacyCrawl.pages.find((page) => page.path === "/p1")?.warnings ?? []),
  );

  const legacyContactMarkdown = legacyCrawl.pages.find((page) => page.path === "/contact")?.markdown ?? "";
  check(
    "contact details are not duplicated into the prose",
    !legacyContactMarkdown.includes("(021) 555-1234") &&
      !legacyContactMarkdown.includes("PO Box 1234") &&
      !legacyContactMarkdown.includes("info@legacyjoinery.example"),
    legacyContactMarkdown.trim().slice(0, 120) || "(prose is empty, as intended)",
  );

  check(
    "layout tables are unwrapped into prose",
    legacyCrawl.pages.every((page) => !page.markdown.includes("<table")),
    JSON.stringify(
      legacyCrawl.pages
        .filter((page) => page.markdown.includes("<table"))
        .map((page) => page.path),
    ),
  );
  check(
    "the hero heading is not repeated in the body",
    !(legacyHome?.markdown ?? "").includes("Welcome to Legacy Joinery"),
    (legacyHome?.markdown ?? "").slice(0, 120),
  );

  /* ---- Results -------------------------------------------------------- */
  const failures = checks.filter((entry) => !entry.passed);
  for (const entry of checks) {
    console.log(`${entry.passed ? "✓" : "✗"} ${entry.name}${entry.detail ? `  (${entry.detail})` : ""}`);
  }

  console.log(`\n${checks.length - failures.length}/${checks.length} checks passed`);
  if (failures.length > 0) {
    console.log(`Artifacts kept for inspection: ${root}`);
    process.exitCode = 1;
  } else {
    await rm(root, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
