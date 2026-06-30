import { decodeSegmentUrl, hasEncodedSegmentParams } from "../crypto/segment-url.js";

const CORS_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "Access-Control-Allow-Origin": "*",
};

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function buildCdnHeaders(referer) {
  return { "User-Agent": USER_AGENT, Referer: referer, Origin: referer.replace(/\/$/, "") };
}

function unwrapTransportStream(input) {
  const buffer = input instanceof Buffer ? input : Buffer.from(new Uint8Array(input));
  if (buffer.length < 4 || buffer[0] === 0x47) return new Uint8Array(buffer);
  if (buffer[0] !== 0x89 || buffer[1] !== 0x50 || buffer[2] !== 0x4e || buffer[3] !== 0x47) {
    return new Uint8Array(buffer);
  }
  const iend = buffer.indexOf(Buffer.from("IEND"));
  if (iend >= 0 && iend + 8 < buffer.length) return new Uint8Array(buffer.subarray(iend + 8));
  for (let index = 0; index < Math.min(buffer.length, 65536); index++) {
    if (buffer[index] === 0x47 && index + 188 < buffer.length && buffer[index + 188] === 0x47) {
      return new Uint8Array(buffer.subarray(index));
    }
  }
  return new Uint8Array(buffer);
}

async function fetchUpstreamMedia(url, referer) {
  let target = url;
  if (hasEncodedSegmentParams(url)) {
    const decoded = decodeSegmentUrl(url);
    if (!decoded) throw new Error("encoded segment url could not be decoded");
    target = decoded;
  }
  const response = await fetch(target, { headers: buildCdnHeaders(referer), redirect: "follow" });
  const body = Buffer.from(await response.arrayBuffer());
  const head = body.subarray(0, Math.min(body.length, 200)).toString("utf8").toLowerCase();
  if (response.status >= 200 && response.status < 300 && body.length && !head.includes("<html")) {
    return body;
  }
  throw new Error(`upstream ${response.status}`);
}

export function buildProxyUrl(streamUrl, playerReferer, origin) {
  const params = new URLSearchParams({ url: streamUrl, referer: playerReferer });
  return `${origin.replace(/\/$/, "")}/api/hls?${params}`;
}

function rewriteManifest(body, targetUrl, playerReferer, origin) {
  const base = new URL(targetUrl);
  return body
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) return line;
      return buildProxyUrl(new URL(trimmed, base).href, playerReferer, origin);
    })
    .join("\n");
}

function isPlaylist(body, targetUrl) {
  const head = body.subarray(0, Math.min(body.length, 256)).toString("utf8");
  return head.includes("#EXTM3U") || targetUrl.includes(".m3u8");
}

function readSegmentPayload(body) {
  const stripped = unwrapTransportStream(body);
  if (stripped.length >= 188 && stripped[0] === 0x47) return Buffer.from(stripped);
  throw new Error("invalid segment payload");
}

export async function proxyHls(request) {
  const url = new URL(request.url);
  const targetUrl = url.searchParams.get("url");
  const playerReferer = url.searchParams.get("referer");
  if (!targetUrl || !playerReferer) {
    return Response.json({ error: "url and referer required" }, { status: 400 });
  }
  const origin = url.origin;
  try {
    const body = await fetchUpstreamMedia(targetUrl, playerReferer);
    if (isPlaylist(body, targetUrl)) {
      const text = body.toString("utf8");
      const manifest = text.startsWith("#EXTM3U")
        ? rewriteManifest(text, targetUrl, playerReferer, origin)
        : text;
      return new Response(manifest, {
        status: 200,
        headers: { ...CORS_HEADERS, "Content-Type": "application/vnd.apple.mpegurl" },
      });
    }
    return new Response(new Uint8Array(readSegmentPayload(body)), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "video/mp2t" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "upstream failed";
    return new Response(message, { status: 502, headers: CORS_HEADERS });
  }
}
