import { rot47 } from "../crypto/rot47.js";
import { requestHashPrefix, sortRequestParams } from "../crypto/request-hash.js";
import {
  MATCH_DETAIL_API_PATH,
  MATCH_DETAIL_SIGNATURE_CODE,
  SIGNATURE_BOOTSTRAP_CODES,
} from "../config/site.js";
import {
  parseApiEnvelope,
  parseMatchDetail,
  parseSignatureEntries,
  parseStreamDetail,
  parseUserGeo,
} from "./protobuf.js";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function normalizePlayerReferer(host) {
  const normalized = host.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return `https://${normalized}/`;
}

function resolvePlayerRefererFromConfig(webClients, streamSiteDigit) {
  const host = webClients[streamSiteDigit]?.iframePlayerDomains?.[0];
  if (!host) throw new Error(`player referer not found for site digit ${streamSiteDigit}`);
  return normalizePlayerReferer(host);
}

function buildHeaders(context) {
  if (!context?.pageReferer || !context?.pageOrigin) {
    throw new Error("request context requires page referer and origin");
  }
  return {
    Referer: context.pageReferer,
    Origin: context.pageOrigin,
    Accept: "application/json, text/plain, */*",
    "User-Agent": USER_AGENT,
  };
}

export class UpstreamApiClient {
  constructor() {
    this.signatureKeys = new Map();
    this.signatureCacheKey = "";
    this.webClients = null;
    this.dataApiBaseUrl = null;
  }

  setDataApiBaseUrl(dataApiBaseUrl) {
    this.dataApiBaseUrl = dataApiBaseUrl.replace(/\/$/, "");
    this.webClients = null;
  }

  apiBaseUrl() {
    if (!this.dataApiBaseUrl) throw new Error("data api base url not set");
    return this.dataApiBaseUrl;
  }

  async fetchSiteConfig(context) {
    const response = await fetch(`${this.apiBaseUrl()}/api/common/params`, {
      headers: buildHeaders(context),
    });
    return JSON.parse(rot47(await response.text()));
  }

  async fetchWebClients(context) {
    if (this.webClients) return this.webClients;
    const config = await this.fetchSiteConfig(context);
    const webClients = JSON.parse(config["common:web:client"]);
    if (!webClients || typeof webClients !== "object") {
      throw new Error("site config missing common:web:client");
    }
    this.webClients = webClients;
    return this.webClients;
  }

  async fetchMatchPageHtml(pageUrl, context) {
    const response = await fetch(pageUrl, { headers: buildHeaders(context) });
    return response.text();
  }

  async resolvePlayerReferer(streamSiteDigit, context) {
    return resolvePlayerRefererFromConfig(await this.fetchWebClients(context), streamSiteDigit);
  }

  async fetchUserGeo(context) {
    const buffer = Buffer.from(await this.get("/api/user/info", context));
    return parseUserGeo(buffer);
  }

  async loadSignatureKeys(matchId, sportType, context) {
    const cacheKey = `${matchId}:${sportType}`;
    if (this.signatureCacheKey === cacheKey && this.signatureKeys.size) return;
    const query = new URLSearchParams();
    query.set("stream", "true");
    query.set("sportType", String(sportType));
    query.set("matchId", matchId);
    for (const code of SIGNATURE_BOOTSTRAP_CODES) query.append("code", String(code));
    const buffer = Buffer.from(await this.get(`/api/common/bs?${query}`, context));
    const { message, payload } = parseApiEnvelope(buffer);
    if (message !== "Success") throw new Error(`signature bootstrap failed: ${message}`);
    this.signatureKeys = new Map(
      payload.flatMap((chunk) => parseSignatureEntries(chunk)).map((entry) => [entry.code, entry.value]),
    );
    this.signatureCacheKey = cacheKey;
  }

  async fetchMatchDetail(params, context) {
    await this.loadSignatureKeys(params.matchId, params.sportType, context);
    const query = {
      matchId: params.matchId,
      sportType: params.sportType,
      language: 0,
      stream: true,
    };
    const buffer = Buffer.from(
      await this.signedRequest(MATCH_DETAIL_API_PATH, query, this.signatureKeys, context),
    );
    return parseMatchDetail(buffer);
  }

  async fetchStreamDetail(params, context) {
    if (!params.streamSiteDigit) throw new Error("stream site digit required");
    if (params.siteType == null) throw new Error("stream site type required");
    const url = new URL(`${this.apiBaseUrl()}/api/stream/detail`);
    url.searchParams.set("streamId", params.streamId);
    url.searchParams.set("matchId", params.matchId);
    url.searchParams.set("sportType", String(params.sportType));
    url.searchParams.set("siteType", String(params.siteType));
    url.searchParams.set("digit", params.streamSiteDigit);
    if (params.continent) url.searchParams.set("continent", params.continent);
    if (params.country) url.searchParams.set("country", params.country);
    const response = await fetch(url, { headers: buildHeaders(context) });
    const buffer = Buffer.from(await response.arrayBuffer());
    const envelope = parseApiEnvelope(buffer);
    if (envelope.message !== "Success") {
      throw new Error(`stream detail failed: ${envelope.message}`);
    }
    const sessionToken = response.headers.get("rb-session");
    if (!sessionToken) throw new Error("stream detail missing session token");
    return {
      stream: parseStreamDetail(buffer),
      sessionToken,
    };
  }

  async get(path, context) {
    const response = await fetch(`${this.apiBaseUrl()}${path}`, { headers: buildHeaders(context) });
    return response.arrayBuffer();
  }

  async signedRequest(path, params, signatureKeys, context) {
    const suffix = signatureKeys.get(MATCH_DETAIL_SIGNATURE_CODE);
    if (!suffix) throw new Error(`missing body signature for ${path}`);
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(sortRequestParams(params))) {
      query.set(key, String(value));
    }
    const url = `${this.apiBaseUrl()}/sfver${requestHashPrefix(params)}${suffix}${path}?${query}`;
    const response = await fetch(url, { headers: buildHeaders(context) });
    return response.arrayBuffer();
  }
}
