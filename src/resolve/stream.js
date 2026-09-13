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

    // Get ALL streams that have a streamId
    const availableStreams = (match.stream || []).filter((item) => item.streamId);
    if (availableStreams.length === 0) throw new Error("no stream on match");

    const results = [];

    for (const stream of availableStreams) {
      try {
        if (stream.siteType == null) continue;

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

        if (!detail.stream?.url) continue;

        const streamUrl = buildSignedStreamUrl(detail.stream.url, detail.sessionToken);

        results.push({
          name: stream.name || "Unknown",
          streamUrl,
          referer: parsed.playerReferer,
          playableUrl: buildProxyUrl(streamUrl, parsed.playerReferer, origin),
        });
      } catch (err) {
        // skip broken individual streams
        console.error("Skipping one stream:", err.message);
      }
    }

    if (results.length === 0) throw new Error("no usable streams found");

    // Return all streams
    return Response.json({
      matchName: match.name || results[0].name,
      streams: results,          // array of all streams
      // keep backward compatibility
      name: results[0].name,
      streamUrl: results[0].streamUrl,
      referer: results[0].referer,
      playableUrl: results[0].playableUrl,
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "resolve failed" },
      { status: 502 },
    );
  }
}
