import { LOCALE_CODES, SPORT_SLUGS } from "../config/site.js";

function decodeMetadataParam(raw) {
  try {
    const normalized = decodeURIComponent(raw).replace(/\s/g, "");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const plain = Buffer.from(padded, "base64").toString("utf8");
    const [matchId, sportType] = plain.split("_");
    if (!matchId || !sportType || !/^\d+$/.test(matchId)) return null;
    return { matchId, sportType: Number(sportType) };
  } catch {
    return null;
  }
}

function parseMatchPagePath(input) {
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const parts = url.pathname.split("/").filter(Boolean);
  let index = 0;
  if (parts[index] && LOCALE_CODES.has(parts[index])) index += 1;
  const sportSlug = parts[index];
  if (!sportSlug) return null;
  const sportType = SPORT_SLUGS[sportSlug];
  if (sportType === undefined) return null;
  const slugSegment = parts[index + 1];
  if (!slugSegment?.includes("-")) return null;
  const matchId = slugSegment.slice(slugSegment.lastIndexOf("-") + 1);
  if (!/^\d+$/.test(matchId)) return null;
  const pageReferer = `${url.origin}/`;
  const metadata = url.searchParams.get("mdata");
  if (metadata) {
    const fromMetadata = decodeMetadataParam(metadata);
    if (fromMetadata) {
      return {
        matchId: fromMetadata.matchId,
        sportType: fromMetadata.sportType,
        pageReferer,
        pageOrigin: url.origin,
      };
    }
  }
  return {
    matchId,
    sportType,
    pageReferer,
    pageOrigin: url.origin,
  };
}

function parseStreamSiteDigitFromPage(pageHtml) {
  const match = pageHtml.match(/layout:"livestream-([^"]+)"/);
  if (!match?.[1]) throw new Error("stream site digit not found on match page");
  return match[1];
}

function parseDataApiBaseUrlFromPage(pageHtml) {
  const match = pageHtml.match(/apis-data\d+\.[a-z0-9.-]+/);
  if (!match) throw new Error("data api host not found on match page");
  return `https://${match[0]}`;
}

function buildPlaySiteUrl(playerDomainBase, pageUrl) {
  const source = new URL(pageUrl.trim());
  const target = new URL(playerDomainBase);
  target.pathname = source.pathname
    .replace(/-match-(\d+)/, "-$1")
    .replace(/-\d{2}-\d{4}(\.html)$/i, "$1");
  target.searchParams.set("icg", "UEs");
  target.searchParams.set("ilang", source.searchParams.get("ilang") || "en");
  return target.href;
}

export function validateStreamPageUrl(input) {
  if (!input?.trim()) return { ok: false, error: "Paste the stream page URL from your browser address bar" };
  try {
    new URL(input.trim());
  } catch {
    return { ok: false, error: "Enter a valid stream page URL" };
  }
  if (!parseMatchPagePath(input)) {
    return {
      ok: false,
      error: "URL must be a match stream page with a sport path and match ID (e.g. /basketball/…-2187976/…)",
    };
  }
  return { ok: true };
}

export async function parseMatchPageUrl(input, apiClient) {
  let pageUrl = input.trim();
  let parsed = parseMatchPagePath(pageUrl);
  if (!parsed) throw new Error("Could not parse match page URL");
  let requestContext = { pageReferer: parsed.pageReferer, pageOrigin: parsed.pageOrigin };
  let pageHtml = await apiClient.fetchMatchPageHtml(pageUrl, requestContext);
  apiClient.setDataApiBaseUrl(parseDataApiBaseUrlFromPage(pageHtml));
  let streamSiteDigit = parseStreamSiteDigitFromPage(pageHtml);
  const playerDomain = (await apiClient.fetchPlayerDomainBases(streamSiteDigit, requestContext))[0];
  if (playerDomain && new URL(playerDomain).hostname !== new URL(pageUrl).hostname) {
    pageUrl = buildPlaySiteUrl(playerDomain, pageUrl);
    parsed = parseMatchPagePath(pageUrl);
    if (!parsed) throw new Error("Could not parse play site URL");
    requestContext = { pageReferer: parsed.pageReferer, pageOrigin: parsed.pageOrigin };
    pageHtml = await apiClient.fetchMatchPageHtml(pageUrl, requestContext);
    apiClient.setDataApiBaseUrl(parseDataApiBaseUrlFromPage(pageHtml));
    streamSiteDigit = parseStreamSiteDigitFromPage(pageHtml);
  }
  const playerReferer = await apiClient.resolvePlayerReferer(streamSiteDigit, requestContext);
  return { ...parsed, streamSiteDigit, playerReferer };
}
