function rot13(input) {
  return input.replace(/[a-zA-Z]/g, (char) => {
    const base = char <= "Z" ? 65 : 97;
    return String.fromCharCode(((char.charCodeAt(0) - base + 13) % 26) + base);
  });
}

function decodeQueryParam(value) {
  if (!value) return "";
  return Buffer.from(rot13(decodeURIComponent(value.slice(8))), "base64").toString("utf8");
}

function readHostFromParam(paramValue) {
  for (const entry of paramValue.split(",")) {
    const at = entry.indexOf("@");
    if (at >= 0) return entry.slice(at + 1);
  }
  return null;
}

export function hasEncodedSegmentParams(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.has("_ctump") && parsed.searchParams.has("_ctuph");
  } catch {
    return false;
  }
}

export function decodeSegmentUrl(segmentUrl) {
  let parsed;
  try {
    parsed = new URL(segmentUrl);
  } catch {
    return null;
  }
  const host = readHostFromParam(decodeQueryParam(parsed.searchParams.get("_ctump")));
  const path = decodeQueryParam(parsed.searchParams.get("_ctuph"));
  return host && path ? `https://${host}${path}` : null;
}
