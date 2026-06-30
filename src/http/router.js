import { readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { proxyHls } from "../hls/proxy.js";
import { resolveStream } from "../resolve/stream.js";

const projectRoot = fileURLToPath(new URL("../..", import.meta.url));
const publicDir = join(projectRoot, "public");

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
};

async function serveStatic(pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.slice(1);
  try {
    const data = await readFile(join(publicDir, relative));
    const type = MIME_TYPES[extname(relative)] ?? "application/octet-stream";
    return new Response(data, { headers: { "Content-Type": type } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function handleRequest(request) {
  const url = new URL(request.url);
  if (url.pathname === "/api/hls") return proxyHls(request);
  if (url.pathname === "/api/resolve-link") {
    return resolveStream(url.searchParams.get("url") ?? "", url.origin);
  }
  if (url.pathname.startsWith("/api/")) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  return serveStatic(url.pathname);
}
