export const MATCH_DETAIL_API_PATH = "/api/match/detail";
export const MATCH_DETAIL_SIGNATURE_CODE = 0x66;
export const SIGNATURE_BOOTSTRAP_CODES = [0x66, 0x67, 0x68, 0x69];

export const REQUEST_PARAM_ORDER = [
  "matchId",
  "leagueId",
  "seasonId",
  "sportType",
  "language",
  "stream",
];

export const SPORT_SLUGS = {
  football: 1,
  basketball: 2,
  tennis: 3,
  baseball: 4,
  cricket: 6,
  motorsport: 7,
  rugby: 8,
  "american-football": 9,
  "aussie-rules": 10,
  hockey: 11,
  badminton: 12,
  volleyball: 13,
  fighting: 14,
  cycling: 15,
  handball: 16,
  others: 90,
};

export const LOCALE_CODES = new Set(["en", "zh", "th", "vi", "id", "pt", "es", "tr", "ru", "ko", "ja"]);
