import { UpstreamApiClient } from "../upstream/api-client.js";
import { validateStreamPageUrl, parseMatchPageUrl } from "../upstream/match-page-url.js";
import { buildSignedStreamUrl } from "../crypto/stream-token.js";
import { buildProxyUrl } from "../hls/proxy.js";

export async function resolveStream(pageUrl, origin) {
  if (!pageUrl) return Response.json({ error: "url required" }, { status: 400 });
  const validation = validateStreamPageUrl(pageUrl);
  if (!validation.ok) return Response.json({ error: validation.error }, { status: 400 });
  try {
    const apiClient = new UpstreamApiClient();
    const parsed = await parseMatchPageUrl(pageUrl, apiClient);
    const pageContext = { pageReferer: parsed.pageReferer, pageOrigin: parsed.pageOrigin };
    const streamContext = { pageReferer: parsed.playerReferer, pageOrigin: new URL(parsed.playerReferer).origin };
    const geo = await apiClient.fetchUserGeo(pageContext);
    const match = await apiClient.fetchMatchDetail(
      { matchId: parsed.matchId, sportType: parsed.sportType },
      pageContext,
    );
    const stream = match.stream.find((item) => item.streamId);
    if (!stream?.streamId) throw new Error("no stream on match");
    if (stream.siteType == null) throw new Error("stream missing site type");
    const detail = await apiClient.fetchStreamDetail(
      {
        streamId: stream.streamId,
        matchId: parsed.matchId,
        sportType: parsed.sportType,
        siteType: stream.siteType,
        streamSiteDigit: parsed.streamSiteDigit,
        country: geo.country,
        continent: geo.continent,
      },
      streamContext,
    );
    if (!detail.stream.url) throw new Error("stream detail missing url");
    const streamUrl = buildSignedStreamUrl(detail.stream.url, detail.sessionToken);
    return Response.json({
      name: stream.name,
      streamUrl,
      playableUrl: buildProxyUrl(streamUrl, parsed.playerReferer, origin),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "resolve failed" },
      { status: 502 },
    );
  }
}
