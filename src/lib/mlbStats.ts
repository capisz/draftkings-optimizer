// src/lib/mlbStats.ts
// MLB Stats API (statsapi.mlb.com) — free, reliable, public. Provides the
// daily schedule with probable pitchers, a name→player-id map, and
// batter-vs-pitcher (BvP) career splits with sample size. Used to (a) annotate
// each DK hitter with the opposing probable pitcher and (b) power the AI's
// favorable-matchup recommendations.

import type { PoolPlayer } from "@/lib/draftkings";

const SCHEDULE_URL = (date: string) =>
  `https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${date}&hydrate=probablePitcher,team`;
const PLAYERS_URL = (season: number) =>
  `https://statsapi.mlb.com/api/v1/sports/1/players?season=${season}`;
const BVP_URL = (batterId: number, pitcherId: number) =>
  `https://statsapi.mlb.com/api/v1/people/${batterId}/stats?stats=vsPlayer&opposingPlayerId=${pitcherId}&group=hitting`;

export function normalizeMlbName(name: string): string {
  return (name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// DraftKings team abbreviations that differ from statsapi's
const TEAM_ALIASES: Record<string, string> = {
  WAS: "WSH",
  CHW: "CWS",
  OAK: "ATH",
  AZ: "ARI",
  SD: "SD",
  SF: "SF",
  TB: "TB",
  KC: "KC",
};
function teamKey(abbr: string): string {
  const up = (abbr || "").toUpperCase();
  return TEAM_ALIASES[up] ?? up;
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`MLB Stats API failed (${res.status})`);
  return res.json();
}

// ----- name → MLB id map (cached per season for the process) -----
let idMapCache: { season: number; map: Map<string, number>; at: number } | null =
  null;
const ID_TTL_MS = 6 * 60 * 60 * 1000;

async function getIdMap(season: number): Promise<Map<string, number>> {
  if (
    idMapCache &&
    idMapCache.season === season &&
    Date.now() - idMapCache.at < ID_TTL_MS
  ) {
    return idMapCache.map;
  }
  const json = await fetchJson(PLAYERS_URL(season));
  const map = new Map<string, number>();
  for (const p of json?.people || []) {
    if (p?.id && p?.fullName) map.set(normalizeMlbName(p.fullName), p.id);
  }
  idMapCache = { season, map, at: Date.now() };
  return map;
}

type ProbableInfo = { id: number; name: string };

// team key → opposing probable pitcher for that team's game
async function getOpposingProbables(
  date: string
): Promise<Map<string, ProbableInfo>> {
  const json = await fetchJson(SCHEDULE_URL(date));
  const out = new Map<string, ProbableInfo>();
  const games = (json?.dates || []).flatMap((d: any) => d?.games || []);
  for (const g of games) {
    const home = g?.teams?.home;
    const away = g?.teams?.away;
    const homeAbbr = teamKey(home?.team?.abbreviation || "");
    const awayAbbr = teamKey(away?.team?.abbreviation || "");
    const homeP = home?.probablePitcher;
    const awayP = away?.probablePitcher;
    // home team's hitters face the away probable pitcher, and vice-versa
    if (homeAbbr && awayP?.id)
      out.set(homeAbbr, { id: awayP.id, name: awayP.fullName });
    if (awayAbbr && homeP?.id)
      out.set(awayAbbr, { id: homeP.id, name: homeP.fullName });
  }
  return out;
}

function dateKeyET(startDateIso: string | null): string {
  const d = startDateIso ? new Date(startDateIso) : new Date();
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(Number.isNaN(d.getTime()) ? new Date() : d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

// A pitcher in DK's pool (SP/RP) is not a hitter; only annotate hitters.
function isHitter(position: string): boolean {
  return !/^(SP|RP|P)$/i.test((position || "").trim());
}

/**
 * Attach each hitter's MLB id and the opposing probable pitcher so the AI can
 * pull batter-vs-pitcher matchups. Best-effort; failures are swallowed.
 */
export async function enrichMlbMatchups(
  players: PoolPlayer[],
  startDateIso: string | null
): Promise<void> {
  const date = dateKeyET(startDateIso);
  const season = Number(date.slice(0, 4)) || new Date().getFullYear();

  const [idMap, probables] = await Promise.all([
    getIdMap(season).catch(() => new Map<string, number>()),
    getOpposingProbables(date).catch(() => new Map<string, ProbableInfo>()),
  ]);

  for (const p of players) {
    p.mlbId = idMap.get(normalizeMlbName(p.name)) ?? null;
    if (isHitter(p.position)) {
      p.opposingPitcher = probables.get(teamKey(p.team)) ?? null;
    }
  }
}

export type BvP = {
  pa: number;
  ab: number;
  hits: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  avg: number;
  ops: number;
};

const bvpCache = new Map<string, BvP | null>();

export async function getBvP(
  batterId: number,
  pitcherId: number
): Promise<BvP | null> {
  const key = `${batterId}:${pitcherId}`;
  if (bvpCache.has(key)) return bvpCache.get(key)!;

  try {
    const json = await fetchJson(BVP_URL(batterId, pitcherId));
    const stats = json?.stats || [];
    const total = stats.find(
      (s: any) => s?.type?.displayName === "vsPlayerTotal"
    );
    const split = total?.splits?.[0]?.stat;
    if (!split) {
      bvpCache.set(key, null);
      return null;
    }
    const bvp: BvP = {
      pa: Number(split.plateAppearances) || 0,
      ab: Number(split.atBats) || 0,
      hits: Number(split.hits) || 0,
      hr: Number(split.homeRuns) || 0,
      rbi: Number(split.rbi) || 0,
      bb: Number(split.baseOnBalls) || 0,
      so: Number(split.strikeOuts) || 0,
      avg: parseFloat(split.avg) || 0,
      ops: parseFloat(split.ops) || 0,
    };
    bvpCache.set(key, bvp);
    return bvp;
  } catch {
    bvpCache.set(key, null);
    return null;
  }
}
