#!/usr/bin/env node
/**
 * Rasterise an SVG mark into the icon files a site needs.
 *
 * Browsers, iOS home screens and search results disagree about favicon formats, so
 * a site wants the SVG plus a small PNG set. Draw the mark once as SVG and run
 * this:
 *
 *   pnpm icons                                  # apps/site/public/favicon.svg
 *   pnpm icons path/to/mark.svg                 # from another file
 *
 * The source should be a square mark, not a wide logo lockup: at 32px only the
 * mark is legible.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const source = resolve(process.cwd(), process.argv[2] ?? "apps/site/public/favicon.svg");
const outDir = resolve(process.cwd(), process.argv[3] ?? "apps/site/public");

const targets = [
  { file: "favicon-32x32.png", size: 32 },
  { file: "apple-touch-icon.png", size: 180 },
  { file: "icon-192.png", size: 192 },
  { file: "icon-512.png", size: 512 },
];

const svg = await readFile(source);
await mkdir(outDir, { recursive: true });

for (const target of targets) {
  // A high density keeps the vector crisp when it is scaled down.
  const png = await sharp(svg, { density: 384 })
    .resize(target.size, target.size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  await writeFile(resolve(outDir, target.file), png);
  console.log(`  ${target.file} — ${target.size}x${target.size} (${Math.round(png.length / 1024)} kB)`);
}

console.log(`\nIcons written to ${outDir}\nfrom ${source}`);
