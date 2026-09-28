/** URL/id-safe slug used for section anchors and heading ids. */
export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

/** Turn a content collection id into the URL path it should be served from. */
export function idToPath(id: string, base = ""): string {
  const clean = id.replace(/^\/+|\/+$/g, "");
  if (clean === "index" || clean === "") return base || "/";
  return `${base}/${clean}`.replace(/\/{2,}/g, "/");
}
