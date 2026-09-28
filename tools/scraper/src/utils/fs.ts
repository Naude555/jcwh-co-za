import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, posix, relative } from "node:path";

/** Recursively create the parent directory and write UTF-8 content. */
export async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await writeText(path, `${JSON.stringify(value, null, 2)}\n`);
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Short, stable content hash used for asset file names and ids. */
export function hash(value: string | Uint8Array, length = 8): string {
  return createHash("sha1").update(value).digest("hex").slice(0, length);
}

/** Path of `child` relative to `parent`, always using forward slashes. */
export function relativePath(parent: string, child: string): string {
  return relative(parent, child).split("\\").join(posix.sep);
}

/** Make a string safe to use as a file name. */
export function safeFileName(value: string, fallback = "file"): string {
  const cleaned = value
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/\.{2,}/g, ".")
    .slice(0, 80);
  return cleaned || fallback;
}
