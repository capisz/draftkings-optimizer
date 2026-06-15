// src/lib/mlbStats.ts
// MLB Stats API (statsapi.mlb.com) — free, reliable, public. Provides the
// daily schedule with probable pitchers, a name→player-id map, and
// batter-vs-pitcher (BvP) career splits with sample size. Used to (a) annotate
// each DK hitter with the opposing probable pitcher and (b) power the AI's
// favorable-matchup recommendations.

import type { PoolPlayer, Last5Game } from "@/lib/draftkings";

const GAMELOG_URL = (id: number, season: number, group: string) =>
  `https://statsapi.mlb.com/api/v1/people/${id}/stats?stats=gameLog&season=${season}&group=${group}`;
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

// Full team name → abbreviation (gameLog opponents only carry the full name)
const TEAM_NAME_ABBR: Record<string, string> = {
  "arizona diamondbacks": "ARI",
  athletics: "ATH",
  "atlanta braves": "ATL",
  "baltimore orioles": "BAL",
  "boston red sox": "BOS",
  "chicago cubs": "CHC",
  "chicago white sox": "CWS",
  "cincinnati reds": "CIN",
  "cleveland guardians": "CLE",
  "colorado rockies": "COL",
  "detroit tigers": "DET",
  "houston astros": "HOU",
  "kansas city royals": "KC",
  "los angeles angels": "LAA",
  "los angeles dodgers": "LAD",
  "miami marlins": "MIA",
  "milwaukee brewers": "MIL",
  "minnesota twins": "MIN",
  "new york mets": "NYM",
  "new york yankees": "NYY",
  "philadelphia phillies": "PHI",
  "pittsburgh pirates": "PIT",
  "san diego padres": "SD",
  "san francisco giants": "SF",
  "seattle mariners": "SEA",
  "st. louis cardinals": "STL",
  "tampa bay rays": "TB",
  "texas rangers": "TEX",
  "toronto blue jays": "TOR",
  "washington nationals": "WSH",
};
function shortTeam(abbrOrName: string): string {
  const v = (abbrOrName || "").trim();
  if (!v) return "";
  if (v.length <= 4) return v.toUpperCase();
  return TEAM_NAME_ABBR[v.toLowerCase()] ?? v.slice(0, 3).toUpperCase();
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

// ----- recent form (last-5 DK-scored games) -----

function num(v: any): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

// innings pitched come as "6.1" = 6 innings + 1 out
function parseIp(ip: any): number {
  const s = String(ip ?? "0");
  const [whole, frac] = s.split(".");
  return num(whole) + (frac === "1" ? 1 / 3 : frac === "2" ? 2 / 3 : 0);
}

// Official DraftKings MLB scoring
function dkHitterPoints(s: any): number {
  const h = num(s.hits);
  const d = num(s.doubles);
  const t = num(s.triples);
  const hr = num(s.homeRuns);
  const singles = Math.max(0, h - d - t - hr);
  return (
    singles * 3 +
    d * 5 +
    t * 8 +
    hr * 10 +
    num(s.rbi) * 2 +
    num(s.runs) * 2 +
    num(s.baseOnBalls) * 2 +
    num(s.hitByPitch) * 2 +
    num(s.stolenBases) * 5
  );
}

function dkPitcherPoints(s: any): number {
  const ip = parseIp(s.inningsPitched);
  const cg = num(s.completeGames);
  const cgso = cg > 0 && num(s.shutouts) > 0 ? 1 : 0;
  return (
    ip * 2.25 +
    num(s.strikeOuts) * 2 +
    num(s.wins) * 4 -
    num(s.earnedRuns) * 2 -
    num(s.hits) * 0.6 -
    num(s.baseOnBalls) * 0.6 -
    num(s.hitBatsmen) * 0.6 +
    cg * 2.5 +
    cgso * 2.5
  );
}

function isPitcherPos(position: string): boolean {
  return /^(SP|RP|P)$/i.test((position || "").trim());
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return out;
}

export type Last5Target = {
  dkId: string;
  mlbId: number;
  position: string;
};

/**
 * Last 5 DK-scored games per player (keyed by DraftKings id). One gameLog call
 * per player, so callers should pass a bounded set (e.g. the top names).
 */
export async function getMlbLast5(
  targets: Last5Target[],
  season: number
): Promise<Map<string, Last5Game[]>> {
  const result = new Map<string, Last5Game[]>();

  await mapWithConcurrency(targets, 8, async (t) => {
    const pitcher = isPitcherPos(t.position);
    try {
      const json = await fetchJson(
        GAMELOG_URL(t.mlbId, season, pitcher ? "pitching" : "hitting")
      );
      const splits = json?.stats?.[0]?.splits ?? [];
      const last5 = splits
        .slice(-5)
        .reverse()
        .map((sp: any) => {
          const oppRaw =
            sp?.opponent?.abbreviation || sp?.opponent?.name || "";
          const at = sp?.isHome ? "vs" : "@";
          const dk = pitcher
            ? dkPitcherPoints(sp.stat)
            : dkHitterPoints(sp.stat);
          return {
            date: sp?.date ?? "",
            opp: `${at} ${shortTeam(oppRaw)}`.trim(),
            dk: Number(dk.toFixed(2)),
          } as Last5Game;
        });
      if (last5.length) result.set(t.dkId, last5);
    } catch {
      /* skip players whose log fails */
    }
  });

  return result;
}
