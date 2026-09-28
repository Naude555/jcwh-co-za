import type { BrandFonts, BrandPalette } from "./types.ts";
import {
  contrastRatio,
  distance,
  ensureContrast,
  formatOklch,
  makeOklch,
  oklchToRgb,
  parseColor,
  readableOn,
  rgbToHex,
  rgbToOklch,
  shiftLightness,
  type Oklch,
} from "./utils/color.ts";

/**
 * Brand extraction.
 *
 * The point of modernizing a site rather than replacing it is that it should
 * still look like the client's brand afterwards, so the palette and type scale
 * are read back out of the site's own CSS and turned into a daisyUI theme.
 */

export interface BrandResult {
  palette: BrandPalette;
  fonts: BrandFonts;
  radii: { selector: string; field: string; box: string };
  warnings: string[];
}

interface ColorEvidence {
  hex: string;
  oklch: Oklch;
  count: number;
  source: string;
  /** Extra weight for colours that look like brand colours. */
  weight: number;
}

interface FontEvidence {
  family: string;
  count: number;
}

const GENERIC_FAMILIES = new Set([
  "inherit",
  "initial",
  "unset",
  "revert",
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-sans-serif",
  "ui-serif",
  "ui-monospace",
  "ui-rounded",
  "-apple-system",
  "blinkmacsystemfont",
  "segoe ui",
  "roboto",
  "helvetica neue",
  "helvetica",
  "arial",
  "noto sans",
  "emojis",
  "apple color emoji",
  "segoe ui emoji",
  "segoe ui symbol",
]);

/** Custom-property names that suggest a brand colour, which we weight higher. */
const BRAND_HINT = /(primary|brand|main|accent|theme|corporate|highlight)/i;

function firstFamily(value: string): string | null {
  const first = value.split(",")[0]?.trim().replace(/^['"]|['"]$/g, "") ?? "";
  if (!first) return null;
  if (GENERIC_FAMILIES.has(first.toLowerCase())) return null;
  if (first.length > 40) return null;
  return first;
}

/** Every colour declaration in a stylesheet, weighted by how it is used. */
function collectColors(css: string, into: Map<string, ColorEvidence>): void {
  const add = (raw: string, source: string, weight: number) => {
    const rgb = parseColor(raw);
    if (!rgb || rgb.a < 0.85) return;

    const hex = rgbToHex(rgb);
    const key = hex.toLowerCase();
    const existing = into.get(key);

    if (existing) {
      existing.count += 1;
      existing.weight = Math.max(existing.weight, weight);
      return;
    }

    into.set(key, {
      hex,
      oklch: rgbToOklch(rgb),
      count: 1,
      source,
      weight,
    });
  };

  // Custom properties: the strongest signal of an intentional design token.
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)[;}]/g)) {
    const name = match[1] ?? "";
    const value = match[2] ?? "";
    if (!/#|rgb|hsl|oklch/i.test(value)) continue;
    const weight = BRAND_HINT.test(name) ? 6 : 2;
    for (const candidate of value.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)/gi)) {
      add(candidate[0], `custom property ${name}`, weight);
    }
  }

  // Direct usage in colour-ish properties.
  for (const match of css.matchAll(
    /(?:^|[;{\s])(background(?:-color)?|color|border(?:-color)?|fill|stroke|--[\w-]+)\s*:\s*([^;{}]+)/gi,
  )) {
    const property = (match[1] ?? "").toLowerCase();
    const value = match[2] ?? "";
    if (!/#|rgb|hsl|oklch/i.test(value)) continue;
    const weight = BRAND_HINT.test(property) ? 4 : 1;
    for (const candidate of value.matchAll(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|oklch\([^)]*\)/gi)) {
      add(candidate[0], `${property} declaration`, weight);
    }
  }
}

/**
 * Font families, counted separately for headings and for everything else.
 * `var(--token)` references are resolved because design systems often keep the
 * font stack in a custom property.
 */
function collectFonts(
  css: string,
  vars: Map<string, string>,
): { all: FontEvidence[]; headings: FontEvidence[] } {
  const all = new Map<string, number>();
  const headings = new Map<string, number>();

  const bump = (map: Map<string, number>, family: string, by = 1) => {
    map.set(family, (map.get(family) ?? 0) + by);
  };

  // Rule-by-rule so a heading selector's font can be told apart.
  for (const rule of css.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const selector = rule[1] ?? "";
    const body = rule[2] ?? "";
    const declaration = /font-family\s*:\s*([^;}]+)/i.exec(body);
    const family = declaration ? firstFamily(resolveVar(declaration[1] ?? "", vars)) : null;
    if (!family) continue;

    bump(all, family);
    if (/\b(h1|h2|h3|h4|h5|h6|heading|title|display)\b/i.test(selector)) bump(headings, family, 3);
    if (/\b(body|html|:root)\b/i.test(selector)) bump(all, family, 2);
  }

  const toSorted = (map: Map<string, number>) =>
    [...map.entries()]
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => b.count - a.count);

  return { all: toSorted(all), headings: toSorted(headings) };
}

/** Resolve `var(--name)` references, since design tokens often hold the stack. */
function resolveVar(value: string, vars: Map<string, string>, depth = 0): string {
  if (depth > 3) return value;

  const match = /var\(\s*(--[\w-]+)\s*(?:,\s*([^)]*))?\)/.exec(value);
  if (!match) return value;

  const replacement = vars.get(match[1] ?? "") ?? match[2] ?? "";
  return resolveVar(value.replace(match[0], replacement), vars, depth + 1);
}

/** Typography tokens, recognised by the name of the custom property. */
function collectFontVars(vars: Map<string, string>): {
  all: FontEvidence[];
  headings: FontEvidence[];
} {
  const all = new Map<string, number>();
  const headings = new Map<string, number>();

  for (const [name, value] of vars) {
    if (!/font|typeface/i.test(name)) continue;

    const family = firstFamily(resolveVar(value, vars));
    if (!family) continue;

    const isHeading = /heading|display|title|headline/i.test(name);
    all.set(family, (all.get(family) ?? 0) + (isHeading ? 1 : 3));
    if (isHeading) headings.set(family, (headings.get(family) ?? 0) + 5);
  }

  const toSorted = (map: Map<string, number>) =>
    [...map.entries()]
      .map(([family, count]) => ({ family, count }))
      .sort((a, b) => b.count - a.count);

  return { all: toSorted(all), headings: toSorted(headings) };
}

/** Every `--token: value` pair found across the captured stylesheets. */
function collectVars(cssTexts: string[]): Map<string, string> {
  const vars = new Map<string, string>();

  for (const css of cssTexts) {
    for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
      const name = match[1];
      const value = match[2]?.trim();
      if (name && value && !vars.has(name)) vars.set(name, value);
    }
  }

  return vars;
}

/** Border radii, ignoring pill/circle values that are not a design token. */
function collectRadius(css: string): string | null {
  const counts = new Map<string, number>();

  for (const match of css.matchAll(/border-radius\s*:\s*([^;}]+)/gi)) {
    const value = (match[1] ?? "").trim().toLowerCase();
    if (!/^[\d.]+(px|rem|em)$/.test(value)) continue;

    const numeric = Number.parseFloat(value);
    const unit = value.replace(/[\d.\s]/g, "");
    const px = unit === "px" ? numeric : numeric * 16;
    if (px < 2 || px > 40) continue;

    // Normalise to a rem string so identical values collapse together.
    const normalised = `${Number((px / 16).toFixed(3))}rem`;
    counts.set(normalised, (counts.get(normalised) ?? 0) + 1);
  }

  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : null;
}

/** Extract palette, fonts and radii from every stylesheet we could read. */
export function extractBrand(cssTexts: string[]): BrandResult {
  const warnings: string[] = [];
  const colors = new Map<string, ColorEvidence>();
  const allFonts = new Map<string, number>();
  const headingFonts = new Map<string, number>();
  let radius: string | null = null;

  const vars = collectVars(cssTexts);

  for (const css of cssTexts) {
    collectColors(css, colors);

    const fonts = collectFonts(css, vars);
    for (const font of fonts.all) {
      allFonts.set(font.family, (allFonts.get(font.family) ?? 0) + font.count);
    }
    for (const font of fonts.headings) {
      headingFonts.set(font.family, (headingFonts.get(font.family) ?? 0) + font.count);
    }

    radius ??= collectRadius(css);
  }

  // Typography tokens are a strong signal even when selectors are unclear.
  const fontVars = collectFontVars(vars);
  for (const font of fontVars.all) {
    allFonts.set(font.family, (allFonts.get(font.family) ?? 0) + font.count);
  }
  for (const font of fontVars.headings) {
    headingFonts.set(font.family, (headingFonts.get(font.family) ?? 0) + font.count);
  }

  const evidence = [...colors.values()].sort((a, b) => b.count * b.weight - a.count * a.weight);

  if (evidence.length === 0) {
    warnings.push(
      "No colours could be read from the site's CSS (a stylesheet may have been unreachable). Using the default brand palette.",
    );
  }

  const sortedFonts = [...allFonts.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => b.count - a.count);
  const sortedHeadingFonts = [...headingFonts.entries()]
    .map(([family, count]) => ({ family, count }))
    .sort((a, b) => b.count - a.count);

  const bodyFont = sortedFonts[0]?.family ?? "";
  const headingFont = sortedHeadingFonts[0]?.family ?? bodyFont;

  const themes = buildThemes(evidence, warnings);

  return {
    palette: {
      evidence: evidence.slice(0, 12).map((item) => ({
        color: item.hex,
        count: item.count,
        source: item.source,
      })),
      light: themes.light,
      dark: themes.dark,
    },
    fonts: {
      heading: headingFont,
      body: bodyFont,
      evidence: sortedFonts.slice(0, 8),
    },
    radii: radiusFromToken(radius),
    warnings,
  };
}

/** Theme radii, derived from the site's most common border radius. */
function radiusFromToken(token: string | null): { selector: string; field: string; box: string } {
  const box = token ? Number.parseFloat(token) : 1;
  const safeBox = Number.isFinite(box) && box > 0.125 && box <= 2.5 ? box : 1;
  const toRem = (value: number) => `${Number(value.toFixed(3))}rem`;

  return {
    box: toRem(safeBox),
    field: toRem(Math.min(Math.max(safeBox * 0.625, 0.25), 0.9)),
    selector: toRem(Math.min(Math.max(safeBox * 0.5, 0.25), 0.75)),
  };
}

interface ThemeColors {
  light: Record<string, string>;
  dark: Record<string, string>;
}

/** Hue for each semantic colour; saturation stays constant so they read evenly. */
const SEMANTIC_HUES = { info: 240, success: 150, warning: 80, error: 25 } as const;

/** Build light and dark daisyUI themes from the collected colours. */
export function buildThemes(evidence: ColorEvidence[], warnings: string[]): ThemeColors {
  const chromatic = evidence
    .filter((item) => item.oklch.c >= 0.055 && item.oklch.l >= 0.16 && item.oklch.l <= 0.92)
    .map((item) => ({ ...item, score: item.count * (1 + (item.weight - 1) * 0.6) }))
    .sort((a, b) => b.score - a.score);

  // Primary: the most prominent colour that actually carries a hue.
  const primarySource = chromatic[0]?.oklch ?? makeOklch(0.54, 0.19, 262);
  if (chromatic.length === 0) {
    warnings.push("No saturated brand colour found; the palette falls back to a neutral blue.");
  }

  const primary = clampLightness(primarySource, 0.4, 0.68);

  // Secondary and accent: the next distinctly-hued colours.
  const distinct = chromatic.filter(
    (item) => distance(item.oklch, primary) > 0.14 && hueGap(item.oklch, primary) > 25,
  );
  const secondary = distinct[0] ? clampLightness(distinct[0].oklch, 0.4, 0.7) : hueShift(primary, 60);
  const accent = distinct[1] ? clampLightness(distinct[1].oklch, 0.45, 0.78) : hueShift(primary, -70);

  // Neutral: the darkest low-chroma colour found, else derived from primary.
  const darkNeutral = evidence
    .filter((item) => item.oklch.c <= 0.06 && item.oklch.l < 0.45)
    .sort((a, b) => b.count - a.count)[0]?.oklch;
  const neutral = darkNeutral
    ? makeOklch(clamp(darkNeutral.l, 0.2, 0.34), Math.min(darkNeutral.c, 0.03), primary.h)
    : makeOklch(0.28, Math.min(primary.c * 0.12, 0.025), primary.h);

  // Surfaces: reuse a very light colour from the site when there is one.
  const lightSurface = evidence
    .filter((item) => item.oklch.l >= 0.955 && item.oklch.c <= 0.03)
    .sort((a, b) => b.count - a.count)[0]?.oklch;
  const base100 = lightSurface ?? makeOklch(1, Math.min(primary.c * 0.04, 0.006), primary.h);
  const base200 = shiftLightness(base100, -0.026, 1.15);
  const base300 = shiftLightness(base100, -0.062, 1.25);

  const light: Record<string, string> = {
    "base-100": formatOklch(base100),
    "base-200": formatOklch(base200),
    "base-300": formatOklch(base300),
    "base-content": formatOklch(readableOn(base100)),
    primary: formatOklch(primary),
    "primary-content": formatOklch(readableOn(primary)),
    secondary: formatOklch(secondary),
    "secondary-content": formatOklch(readableOn(secondary)),
    accent: formatOklch(accent),
    "accent-content": formatOklch(readableOn(accent)),
    neutral: formatOklch(neutral),
    "neutral-content": formatOklch(readableOn(neutral)),
  };

  // Dark theme: keep the brand hue, invert the surfaces, lift the accents so
  // they stay legible against a dark background.
  const darkBase = makeOklch(0.175, Math.min(primary.c * 0.15, 0.022), primary.h);
  const darkBaseRgb = oklchToRgb(darkBase);
  const lift = (color: Oklch) => ensureContrast(clampLightness(color, 0.62, 0.86), darkBaseRgb, 4.5);

  const darkPrimary = lift(primary);
  const darkSecondary = lift(secondary);
  const darkAccent = lift(accent);

  const dark: Record<string, string> = {
    "base-100": formatOklch(darkBase),
    "base-200": formatOklch(shiftLightness(darkBase, 0.04, 1.1)),
    "base-300": formatOklch(shiftLightness(darkBase, 0.085, 1.2)),
    "base-content": formatOklch(readableOn(darkBase)),
    primary: formatOklch(darkPrimary),
    "primary-content": formatOklch(readableOn(darkPrimary)),
    secondary: formatOklch(darkSecondary),
    "secondary-content": formatOklch(readableOn(darkSecondary)),
    accent: formatOklch(darkAccent),
    "accent-content": formatOklch(readableOn(darkAccent)),
    neutral: formatOklch(makeOklch(0.92, Math.min(primary.c * 0.1, 0.012), primary.h)),
    "neutral-content": formatOklch(makeOklch(0.2, 0.02, primary.h)),
  };

  for (const [name, hue] of Object.entries(SEMANTIC_HUES)) {
    const lightColor = makeOklch(name === "warning" ? 0.79 : 0.62, 0.16, hue);
    const darkColor = makeOklch(name === "warning" ? 0.84 : 0.76, 0.15, hue);

    light[name] = formatOklch(lightColor);
    light[`${name}-content`] = formatOklch(readableOn(lightColor));
    dark[name] = formatOklch(darkColor);
    dark[`${name}-content`] = formatOklch(readableOn(darkColor));
  }

  return { light, dark };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Keep a colour inside a usable lightness band, preserving its chroma ratio. */
function clampLightness(color: Oklch, min: number, max: number): Oklch {
  if (color.l < min) return shiftLightness(color, min - color.l, 0.9);
  if (color.l > max) return shiftLightness(color, max - color.l, 1.05);
  return color;
}

function hueShift(color: Oklch, degrees: number): Oklch {
  return { ...color, h: (color.h + degrees + 360) % 360 };
}

function hueGap(a: Oklch, b: Oklch): number {
  const gap = Math.abs(a.h - b.h) % 360;
  return gap > 180 ? 360 - gap : gap;
}

/* -------------------------------------------------------------------------- *
 * Rendering
 * -------------------------------------------------------------------------- */

const THEME_ORDER = [
  "base-100",
  "base-200",
  "base-300",
  "base-content",
  "primary",
  "primary-content",
  "secondary",
  "secondary-content",
  "accent",
  "accent-content",
  "neutral",
  "neutral-content",
  "info",
  "info-content",
  "success",
  "success-content",
  "warning",
  "warning-content",
  "error",
  "error-content",
] as const;

function themeBlock(
  name: string,
  colors: Record<string, string>,
  radii: { selector: string; field: string; box: string },
  flags: { default: boolean; prefersDark: boolean; colorScheme: "light" | "dark" },
): string {
  const lines = THEME_ORDER.filter((key) => colors[key]).map(
    (key) => `  --color-${key}: ${colors[key]};`,
  );

  return [
    "@plugin \"daisyui/theme\" {",
    `  name: "${name}";`,
    `  default: ${flags.default};`,
    `  prefersdark: ${flags.prefersDark};`,
    `  color-scheme: ${flags.colorScheme};`,
    "",
    ...lines,
    "",
    `  --radius-selector: ${radii.selector};`,
    `  --radius-field: ${radii.field};`,
    `  --radius-box: ${radii.box};`,
    "  --size-selector: 0.25rem;",
    "  --size-field: 0.25rem;",
    "  --border: 1px;",
    "  --depth: 1;",
    "  --noise: 0;",
    "}",
  ].join("\n");
}

/**
 * The contents of apps/site/src/styles/brand.css.
 *
 * global.css imports this file, so regenerating a palette never touches the
 * hand-written design system.
 */
export function renderBrandCss(
  brand: Pick<BrandResult, "palette" | "fonts" | "radii">,
  context: { sourceUrl: string; generatedAt: string },
): string {
  const evidence = brand.palette.evidence
    .slice(0, 8)
    .map((item) => ` *   ${item.color}  x${item.count}  (${item.source})`)
    .join("\n");

  const fontNote = [
    brand.fonts.heading ? `heading: ${brand.fonts.heading}` : null,
    brand.fonts.body ? `body: ${brand.fonts.body}` : null,
  ]
    .filter(Boolean)
    .join(", ");

  return `/* ------------------------------------------------------------------------- *
 * Brand themes — GENERATED FILE, safe to overwrite.
 *
 * Produced by tools/scraper from ${context.sourceUrl}
 * at ${context.generatedAt}.
 *
 * Colours found in the source stylesheets:
${evidence}
 *
 * Fonts detected: ${fontNote || "none detected"}
 * To use the source site's fonts, set them in the \`fonts\` array of
 * apps/site/astro.config.mjs and point \`--font-heading\` / \`--font-body\` at them.
 * ------------------------------------------------------------------------- */

${themeBlock("brand", brand.palette.light, brand.radii, {
  default: true,
  prefersDark: false,
  colorScheme: "light",
})}

${themeBlock("brand-dark", brand.palette.dark, brand.radii, {
  default: false,
  prefersDark: true,
  colorScheme: "dark",
})}
`;
}
