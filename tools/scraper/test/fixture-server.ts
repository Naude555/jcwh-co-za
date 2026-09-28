import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
/**
 * Serves `test/fixture` over HTTP so the pipeline can be exercised against a
 * real site. `PORT` inside text fixtures is replaced with the actual port, which
 * lets robots.txt/sitemap.xml stay realistic.
 */

const fixtureDir = fileURLToPath(new URL("./fixture/", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export interface FixtureServer {
  url: string;
  port: number;
  close: () => Promise<void>;
}

export async function startFixtureServer(port = 0): Promise<FixtureServer> {
  const server: Server = createServer(async (request, response) => {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? "127.0.0.1"}`);
    let pathname = decodeURIComponent(requestUrl.pathname);
    if (pathname === "/") pathname = "/index.html";
    if (!extname(pathname)) pathname = `${pathname}.html`;

    const target = normalize(join(fixtureDir, pathname));
    if (!target.startsWith(normalize(fixtureDir))) {
      response.writeHead(403).end("Forbidden");
      return;
    }

    try {
      const bytes = await readFile(target);
      const type = MIME[extname(target)] ?? "application/octet-stream";
      const isText = /^(text|application\/(xml|json))/.test(type);
      const actualPort = (server.address() as { port: number } | null)?.port ?? port;

      response.writeHead(200, { "content-type": type });
      response.end(isText ? bytes.toString("utf8").replace(/PORT/g, String(actualPort)) : bytes);
    } catch {
      response.writeHead(404, { "content-type": "text/html" }).end("<h1>404</h1>");
    }
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const actual = (server.address() as { port: number }).port;

  return {
    url: `http://127.0.0.1:${actual}`,
    port: actual,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Run directly to keep a fixture site up: `node test/fixture-server.ts`. */
const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  const requested = Number.parseInt(process.env["PORT"] ?? "4321", 10);
  const server = await startFixtureServer(requested);
  console.log(`Fixture site running at ${server.url}`);
  console.log("Point the CLI at it, for example:");
  console.log(`  node src/cli.ts scrape --url ${server.url} --delay 0`);
}
