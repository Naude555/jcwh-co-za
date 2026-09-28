/** RGB with channels in 0-255 and alpha in 0-1. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
  a: number;
}

/** Perceptual colour with lightness 0-1, chroma and hue in degrees. */
export interface Oklch {
  l: number;
  c: number;
  h: number;
  a: number;
}

const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));

/** Parse the colour notations a website's CSS realistically uses. */
export function parseColor(input: string): Rgb | null {
  const value = input.trim().toLowerCase();

  const hex = /^#([0-9a-f]{3,8})$/.exec(value)?.[1];
  if (hex) {
    const full =
      hex.length === 3 || hex.length === 4
        ? hex
            .split("")
            .map((char) => char + char)
            .join("")
        : hex;
    const parsed = [0, 2, 4, 6].map((offset) =>
      Number.parseInt(full.slice(offset, offset + 2) || "ff", 16),
    );
    return {
      r: parsed[0] ?? 0,
      g: parsed[1] ?? 0,
      b: parsed[2] ?? 0,
      a: clamp((parsed[3] ?? 255) / 255),
    };
  }

  const rgb = /^rgba?\(([^)]+)\)$/.exec(value)?.[1];
  if (rgb) {
    const parts = rgb
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map((part) =>
        part.endsWith("%") ? (Number.parseFloat(part) / 100) * 255 : Number.parseFloat(part),
      );
    if (parts.length < 3 || parts.some((part) => Number.isNaN(part))) return null;
    return {
      r: clamp(parts[0] ?? 0, 0, 255),
      g: clamp(parts[1] ?? 0, 0, 255),
      b: clamp(parts[2] ?? 0, 0, 255),
      a: clamp(parts[3] ?? 1),
    };
  }

  const oklch = /^oklch\(([^)]+)\)$/.exec(value)?.[1];
  if (oklch) {
    const parts = oklch.split(/[\s,/]+/).filter(Boolean);
    const rawL = parts[0] ?? "";
    const l = rawL.endsWith("%") ? Number.parseFloat(rawL) / 100 : Number.parseFloat(rawL);
    const c = Number.parseFloat(parts[1] ?? "");
    const h = Number.parseFloat(parts[2] ?? "");
    if ([l, c, h].some((part) => Number.isNaN(part))) return null;
    return oklchToRgb({ l, c, h, a: clamp(Number.parseFloat(parts[3] ?? "1")) });
  }

  return null;
}

export function rgbToHex({ r, g, b }: Rgb): string {
  return `#${[r, g, b]
    .map((channel) => Math.round(clamp(channel, 0, 255)).toString(16).padStart(2, "0"))
    .join("")}`;
}

/* -------------------------------------------------------------------------- *
 * sRGB <-> OKLab/OKLCH (Björn Ottosson's reference implementation).
 * Working in OKLCH keeps the generated daisyUI themes perceptually even.
 * -------------------------------------------------------------------------- */

const srgbToLinear = (channel: number) => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

const linearToSrgb = (channel: number) =>
  clamp(channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055) * 255;

export function rgbToOklch({ r, g, b, a }: Rgb): Oklch {
  const lr = srgbToLinear(r);
  const lg = srgbToLinear(g);
  const lb = srgbToLinear(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  const okL = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const okA = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const okB = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const chroma = Math.sqrt(okA * okA + okB * okB);
  let hue = (Math.atan2(okB, okA) * 180) / Math.PI;
  if (hue < 0) hue += 360;

  return { l: okL, c: chroma, h: hue, a };
}

export function oklchToRgb({ l, c, h, a }: Oklch): Rgb {
  const hue = (h * Math.PI) / 180;
  const okA = c * Math.cos(hue);
  const okB = c * Math.sin(hue);

  const l_ = l + 0.3963377774 * okA + 0.2158037573 * okB;
  const m_ = l - 0.1055613458 * okA - 0.0638541728 * okB;
  const s_ = l - 0.0894841775 * okA - 1.291485548 * okB;

  const l3 = l_ ** 3;
  const m3 = m_ ** 3;
  const s3 = s_ ** 3;

  const lr = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const lg = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const lb = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  return { r: linearToSrgb(lr), g: linearToSrgb(lg), b: linearToSrgb(lb), a };
}

/** CSS `oklch()` string with trimmed precision, which is what daisyUI expects. */
export function formatOklch({ l, c, h, a }: Oklch): string {
  const round = (value: number, digits: number) => Number(value.toFixed(digits));
  const lightness = round(clamp(l) * 100, 1);
  const chroma = round(Math.max(c, 0), 4);
  const hue = round(((h % 360) + 360) % 360, 1);
  const alpha = round(clamp(a), 3);
  return alpha >= 1
    ? `oklch(${lightness}% ${chroma} ${hue})`
    : `oklch(${lightness}% ${chroma} ${hue} / ${alpha})`;
}

/* -------------------------------------------------------------------------- *
 * Contrast helpers — used to keep generated themes readable.
 * -------------------------------------------------------------------------- */

/** WCAG relative luminance. */
export function luminance({ r, g, b }: Rgb): number {
  return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

/** WCAG contrast ratio between two colours (1-21). */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = luminance(a);
  const lb = luminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function makeOklch(l: number, c: number, h: number, a = 1): Oklch {
  return { l: clamp(l), c: Math.max(c, 0), h, a };
}

/** Perceptual distance between two OKLCH colours (chroma-weighted). */
export function distance(a: Oklch, b: Oklch): number {
  const chromaScale = Math.max(a.c, b.c, 0.02);
  let hueDelta = Math.abs(a.h - b.h);
  if (hueDelta > 180) hueDelta = 360 - hueDelta;
  const dh = (hueDelta / 180) * chromaScale * 2;
  const dl = a.l - b.l;
  const dc = a.c - b.c;
  return Math.sqrt(dl * dl + dc * dc + dh * dh);
}

/** Nudge lightness until `fg` reaches `target` contrast against `bg`. */
export function ensureContrast(fg: Oklch, bg: Rgb, target = 4.5): Oklch {
  let current = fg;
  const direction = luminance(oklchToRgb(fg)) > luminance(bg) ? 1 : -1;

  for (let step = 0; step < 40; step += 1) {
    if (contrastRatio(oklchToRgb(current), bg) >= target) break;
    const next = clamp(current.l + direction * 0.02);
    if (next === current.l) break;
    current = { ...current, l: next };
  }

  return current;
}

/** Readable foreground for a background: near-white or near-black, whichever wins. */
export function readableOn(background: Oklch): Oklch {
  const backgroundRgb = oklchToRgb(background);
  const white = { r: 255, g: 255, b: 255, a: 1 };
  const black = { r: 17, g: 17, b: 17, a: 1 };

  if (contrastRatio(backgroundRgb, white) >= contrastRatio(backgroundRgb, black)) {
    // Keep a hint of the brand hue so the text does not look flat.
    return makeOklch(0.985, Math.min(background.c * 0.1, 0.01), background.h);
  }
  return makeOklch(0.22, Math.min(background.c * 0.15, 0.02), background.h);
}

/** Lighten/darken in OKLCH, which keeps saturation far steadier than HSL. */
export function shiftLightness(color: Oklch, delta: number, chromaScale = 1): Oklch {
  return {
    l: clamp(color.l + delta),
    c: Math.max(color.c * chromaScale, 0),
    h: color.h,
    a: color.a,
  };
}
