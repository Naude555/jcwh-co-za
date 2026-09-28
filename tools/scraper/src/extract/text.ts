/** Small text helpers used across extraction and generation. */

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

/** Title-cased sentence from a slug or class name, for navigation labels. */
export function humanise(value: string): string {
  const words = value
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Word count, used for content scoring and the migration report. */
export function wordCount(value: string): number {
  return value.split(/\s+/).filter(Boolean).length;
}

/** Truncate to a sensible meta-description length without cutting mid-word. */
export function truncate(value: string, max = 158): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/** Does this label read like a question (used for FAQ detection)? */
export function looksLikeQuestion(value: string): boolean {
  const text = value.trim();
  if (text.endsWith("?")) return true;
  return /^(how|what|why|when|where|who|can|do|does|is|are|will|should)\b/i.test(text) && text.length > 8;
}

/** Strip a surrounding question mark for use as a heading. */
export function cleanLabel(value: string): string {
  return value.replace(/\s+/g, " ").replace(/^[•·\-–—]\s*/, "").trim();
}

/** ISO date from the many formats CMSs emit, or undefined. */
export function parseDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  // ISO-ish first, then anything Date can handle.
  const isoMatch = /(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    const date = new Date(`${year}-${month}-${day}T00:00:00Z`);
    if (!Number.isNaN(date.valueOf())) return date.toISOString();
  }

  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.valueOf()) && parsed.getFullYear() > 1990 && parsed.getFullYear() < 2100) {
    return parsed.toISOString();
  }

  return undefined;
}
