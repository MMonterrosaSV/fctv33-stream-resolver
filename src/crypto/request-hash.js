import { createHash } from "node:crypto";
import { REQUEST_PARAM_ORDER } from "../config/site.js";

const NUMERIC_KEYS = new Set(["sportType", "language", "leagueId", "seasonId", "siteType"]);

function normalizeValue(key, value) {
  if (typeof value === "string" && NUMERIC_KEYS.has(key) && /^\d+$/.test(value)) return Number(value);
  return value;
}

export function sortRequestParams(params) {
  const normalized = Object.fromEntries(
    Object.entries(params).map(([key, value]) => [key, normalizeValue(key, value)]),
  );
  const order = new Map(REQUEST_PARAM_ORDER.map((key, index) => [key, index]));
  const keys = Object.keys(normalized).sort((a, b) => (order.get(a) ?? -1) - (order.get(b) ?? -1));
  return Object.fromEntries(keys.map((key) => [key, normalized[key]]));
}

export function requestHashPrefix(params) {
  return createHash("md5")
    .update(JSON.stringify(sortRequestParams(params)), "utf8")
    .digest("hex")
    .slice(0, 6);
}
