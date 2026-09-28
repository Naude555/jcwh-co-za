import { mkdir, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import type { AssetRecord } from "./types.ts";
import { hash, safeFileName } from "./utils/fs.ts";

/**
 * Downloads the images a page depends on and stores them inside the Astro app.
 *
 * Raster images land in `src/assets/images/` so Astro (Sharp) can resize and
 * convert them per breakpoint. SVG goes to `public/images/` because it needs no
 * transformation — SmartImage renders it as a plain `<img>`.
 */
export class AssetStore {
  private readonly records = new Map<string, AssetRecord>();
  private readonly byContentHash = new Map<string, string>();
  private siteDir: string;
  private enabled: boolean;
  private maxBytes: number;
  private downloaded = 0;
  private failed = 0;

  constructor(options: { siteDir: string; enabled: boolean; maxBytes: number }) {
    this.siteDir = options.siteDir;
    this.enabled = options.enabled;
    this.maxBytes = options.maxBytes;
  }

  /** Local path already recorded for a source URL, if any. */
  localFor(sourceUrl: string): string | undefined {
    return this.records.get(sourceUrl)?.localPath;
  }

  /** Mark a URL as intentionally kept remote (asset downloads disabled). */
  keepRemote(sourceUrl: string, reason: string): string {
    if (!this.records.has(sourceUrl)) {
      this.records.set(sourceUrl, {
        sourceUrl,
        localPath: "",
        kind: "image",
        bytes: 0,
        skipped: reason,
      });
    }
    return sourceUrl;
  }

  /**
   * Fetch one asset. Returns the site-relative path to use in content
   * (`assets/images/foo-1a2b3c4d.webp`) or the original URL when it was skipped.
   */
  async fetch(sourceUrl: string): Promise<string> {
    const existing = this.records.get(sourceUrl);
    if (existing) return existing.localPath || sourceUrl;

    if (!this.enabled) return this.keepRemote(sourceUrl, "asset downloads disabled");

    try {
      const response = await fetch(sourceUrl, {
        redirect: "follow",
        signal: AbortSignal.timeout(20000),
        headers: {
          "user-agent": "jcwh-modernizer/0.1 (+site modernization crawl)",
          accept: "image/*,*/*;q=0.8",
        },
      });

      if (!response.ok) {
        this.failed += 1;
        return this.keepRemote(sourceUrl, `HTTP ${response.status}`);
      }

      const contentType = (response.headers.get("content-type") ?? "").split(";")[0]?.trim() ?? "";
      const declaredSize = Number.parseInt(response.headers.get("content-length") ?? "", 10);
      if (Number.isFinite(declaredSize) && declaredSize > this.maxBytes) {
        return this.keepRemote(sourceUrl, `${Math.round(declaredSize / 1024)}kB exceeds the limit`);
      }

      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.byteLength > this.maxBytes) {
        return this.keepRemote(sourceUrl, `${Math.round(bytes.byteLength / 1024)}kB exceeds the limit`);
      }
      if (bytes.byteLength < 128) return this.keepRemote(sourceUrl, "suspiciously small file");

      const isSvg = contentType.includes("svg") || sourceUrl.toLowerCase().endsWith(".svg");
      const extension = extensionFor(contentType, sourceUrl, isSvg);
      const digest = hash(bytes, 8);

      // Identical bytes under a different URL is the same asset.
      const reusable = this.byContentHash.get(digest);
      if (reusable) {
        this.records.set(sourceUrl, {
          sourceUrl,
          localPath: reusable,
          kind: "image",
          bytes: bytes.byteLength,
          contentType,
        });
        return reusable;
      }

      const base = safeFileName(
        (sourceUrl.split("?")[0]?.split("/").pop() ?? "image").replace(extname(sourceUrl), ""),
        "image",
      );
      const fileName = `${base}-${digest}.${extension}`;
      const relativeDir = isSvg ? "public/images" : "src/assets/images";
      const localPath = isSvg ? `/images/${fileName}` : `assets/images/${fileName}`;

      const target = join(this.siteDir, relativeDir, fileName);
      await mkdir(join(this.siteDir, relativeDir), { recursive: true });
      await writeFile(target, bytes);

      this.byContentHash.set(digest, localPath);
      this.records.set(sourceUrl, {
        sourceUrl,
        localPath,
        kind: "image",
        bytes: bytes.byteLength,
        contentType,
      });
      this.downloaded += 1;

      return localPath;
    } catch (error) {
      this.failed += 1;
      const reason = error instanceof Error ? error.name : "unknown error";
      return this.keepRemote(sourceUrl, reason);
    }
  }

  all(): AssetRecord[] {
    return [...this.records.values()];
  }

  totals(): { downloaded: number; bytes: number; remote: number; failed: number } {
    let bytes = 0;
    let remote = 0;
    for (const record of this.records.values()) {
      bytes += record.bytes;
      if (record.skipped) remote += 1;
    }
    return { downloaded: this.downloaded, bytes, remote, failed: this.failed };
  }
}

const CONTENT_TYPE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "image/x-icon": "ico",
  "image/vnd.microsoft.icon": "ico",
};

/** Best-effort file extension from the content type, then the URL. */
function extensionFor(contentType: string, sourceUrl: string, isSvg: boolean): string {
  if (isSvg) return "svg";
  const fromType = CONTENT_TYPE_EXTENSIONS[contentType.toLowerCase()];
  if (fromType) return fromType;

  const fromUrl = extname(sourceUrl.split("?")[0] ?? "").replace(".", "").toLowerCase();
  if (/^(png|jpe?g|webp|avif|gif|svg|ico)$/.test(fromUrl)) return fromUrl === "jpeg" ? "jpg" : fromUrl;

  return "jpg";
}
