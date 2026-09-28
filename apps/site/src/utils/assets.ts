/**
 * Resolve a content image path to the URL of the file Astro emits.
 *
 * Content stores image paths as plain strings ("assets/images/hero.jpg") because
 * data has to stay serialisable, so anything that needs a *link* to the full-size
 * file (a lightbox, a download) goes through here. Rendering goes through
 * SmartImage instead, which needs the image metadata rather than just the URL.
 */
const modules = import.meta.glob<string>("/src/assets/images/**/*", {
  eager: true,
  query: "?url",
  import: "default",
});

const byKey = new Map<string, string>();
for (const [path, url] of Object.entries(modules)) {
  byKey.set(path, url);
  byKey.set(path.split("/").pop() ?? path, url);
}

export function assetUrl(value: string): string | undefined {
  if (!value) return undefined;

  // Remote and /public files are already URLs.
  if (/^(https?:)?\/\//.test(value) || value.startsWith("data:")) return value;
  if (value.startsWith("/")) return value;

  const file = value.replace(/^\.?\//, "").replace(/^src\//, "").replace(/^public\//, "");
  return (
    byKey.get(`/src/${file}`) ??
    byKey.get(`/src/assets/images/${file}`) ??
    byKey.get(file) ??
    byKey.get(file.split("/").pop() ?? file)
  );
}
