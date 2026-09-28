import { marked } from "marked";

/**
 * Render Markdown that came from a migrated page.
 *
 * Scraped HTML is converted to Markdown by the scraper, but raw HTML is also
 * passed through by `marked`, so the output is stripped of the risky parts
 * (scripts, frames, inline handlers) as defence in depth. This is not a
 * full-blown sanitiser — treat scraped content as semi-trusted and review a
 * migration's diff before publishing.
 */
export function renderMarkdown(markdown: string | undefined): string {
  if (!markdown) return "";
  const html = marked.parse(markdown, { async: false, gfm: true, breaks: false }) as string;
  return stripUnsafe(html);
}

function stripUnsafe(html: string): string {
  return html
    .replace(/<\/?(script|style|iframe|frame|object|embed|form|base|link|meta)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*javascript:[^"']*\2/gi, "$1=$2#$2");
}
