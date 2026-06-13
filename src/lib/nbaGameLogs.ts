// src/lib/nbaGameLogs.ts
// Recent-form data from NBA.com's static CDN (stats.nba.com is blocked on
// many networks; cdn.nba.com serves the same boxscores as plain JSON).
// Produces each player's last 5 games scored with DraftKings fantasy rules,
// which powers the under/overvalued analysis against current DK salaries.

import type { Last5Game } from "@/lib/draftkings";

const SCHEDULE_URL =
  "https://cdn.nba.com/static/json/staticData/scheduleLeagueV2.json";
const BOXSCORE_URL = (gameId: string) =>
  `https://cdn.nba.com/static/json/liveData/boxscore/boxscore_${gameId}.json`;

const NBA_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Referer: "https://www.nba.com/",
  Origin: "https://www.nba.com",
  Accept: "application/json",
};

// DraftKings abbreviations that differ from NBA.com tricodes
const TEAM_ALIASES: Record<string, string> = {
  PHO: "PHX",
  BRK: "BKN",
  GS: "GSW",
  NO: "NOP",
  NY: "NYK",
  SA: "SAS",
  UTAH: "UTA",
  WSH: "WAS",
};

export function toNbaTricode(team: string): string {
  const t = (team || "").toUpperCase();
  return TEAM_ALIASES[t] ?? t;
}

// Normalize names so DK ("Luka Doncic") matches NBA.com ("Luka Dončić")
export function normalizeName(name: string): string {
  return (name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, "")
    .replace(/[.'’\-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

type ScheduleGame = {
  gameId: string;
  ts: number;
  home: string;
  away: string;
};

type BoxPlayerLine = {
  date: string;
  opp: string;
  dk: number;
  ts: number;
};

const SCHEDULE_TTL_MS = 60 * 60 * 1000;
let scheduleCache: { games: ScheduleGame[]; at: number } | null = null;

// Boxscores of finished games never change — cache them for the process life
const boxscoreCache = new Map<string, Map<string, BoxPlayerLine>>();

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: NBA_HEADERS, cache: "no-store" });
  if (!res.ok) throw new Error(`NBA CDN request failed (${res.status})`);
  return res.json();
}

async function getCompletedGames(): Promise<ScheduleGame[]> {
  if (scheduleCache && Date.now() - scheduleCache.at < SCHEDULE_TTL_MS) {
    return scheduleCache.games;
  }

  const json = await fetchJson(SCHEDULE_URL);
  const games: ScheduleGame[] = [];
  for (const day of json?.leagueSchedule?.gameDates || []) {
    for (const g of day?.games || []) {
      if (g?.gameStatus !== 3) continue; // finished games only
      const ts = Date.parse(g?.gameDateTimeUTC ?? g?.gameDateEst ?? "");
      games.push({
        gameId: g.gameId,
        ts: Number.isFinite(ts) ? ts : 0,
        home: g?.homeTeam?.teamTricode ?? "",
        away: g?.awayTeam?.teamTricode ?? "",
      });
    }
  }
  games.sort((a, b) => a.ts - b.ts);

  scheduleCache = { games, at: Date.now() };
  return games;
}

function parseMinutes(min: string | undefined): number {
  const m = (min || "").match(/PT(\d+)M/);
  return m ? parseInt(m[1], 10) : 0;
}

// Official DraftKings NBA Classic scoring
function dkPoints(s: any): number {
  const pts = Number(s?.points) || 0;
  const reb = Number(s?.reboundsTotal) || 0;
  const ast = Number(s?.assists) || 0;
  const stl = Number(s?.steals) || 0;
  const blk = Number(s?.blocks) || 0;
  const tov = Number(s?.turnovers) || 0;
  const tpm = Number(s?.threePointersMade) || 0;

  let dk =
    pts * 1 + tpm * 0.5 + reb * 1.25 + ast * 1.5 + stl * 2 + blk * 2 - tov * 0.5;

  const doubles = [pts, reb, ast, stl, blk].filter((v) => v >= 10).length;
  if (doubles >= 2) dk += 1.5;
  if (doubles >= 3) dk += 3;

  return Number(dk.toFixed(2));
}

async function getBoxscoreLines(
  game: ScheduleGame
): Promise<Map<string, BoxPlayerLine>> {
  const cached = boxscoreCache.get(game.gameId);
  if (cached) return cached;

  const json = await fetchJson(BOXSCORE_URL(game.gameId));
  const g = json?.game;
  const lines = new Map<string, BoxPlayerLine>();

  const date = new Date(game.ts).toISOString().slice(0, 10);
  for (const side of ["homeTeam", "awayTeam"] as const) {
    const team = g?.[side];
    const oppCode =
      side === "homeTeam" ? g?.awayTeam?.teamTricode : g?.homeTeam?.teamTricode;
    const opp = side === "homeTeam" ? `vs ${oppCode}` : `@ ${oppCode}`;

    for (const p of team?.players || []) {
      if (parseMinutes(p?.statistics?.minutes) <= 0) continue;
      lines.set(normalizeName(p?.name), {
        date,
        opp,
        dk: dkPoints(p?.statistics),
        ts: game.ts,
      });
    }
  }

  boxscoreCache.set(game.gameId, lines);
  return lines;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R | null>
): Promise<R[]> {
  const results: R[] = [];
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const item = items[i++];
      const r = await fn(item);
      if (r !== null) results.push(r);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
  return results;
}

/**
 * Last 5 DK-scored games for every player on the given teams
 * (DK abbreviations accepted), keyed by normalized player name.
 */
export async function getLastFiveByPlayer(
  dkTeams: Iterable<string>
): Promise<Map<string, Last5Game[]>> {
  const teams = new Set(Array.from(dkTeams, toNbaTricode).filter(Boolean));
  const result = new Map<string, (Last5Game & { ts: number })[]>();
  if (!teams.size) return result;

  const all = await getCompletedGames();

  // Last 5 games per slate team, deduped (opponents share games)
  const wanted = new Map<string, ScheduleGame>();
  for (const team of teams) {
    const teamGames = all.filter((g) => g.home === team || g.away === team);
    for (const g of teamGames.slice(-5)) wanted.set(g.gameId, g);
  }

  const lineMaps = await mapWithConcurrency(
    [...wanted.values()],
    8,
    async (game) => {
      try {
        return await getBoxscoreLines(game);
      } catch (err) {
        console.error(`[nbaGameLogs] boxscore ${game.gameId} failed:`, err);
        return null;
      }
    }
  );

  for (const lines of lineMaps) {
    for (const [name, line] of lines) {
      const list = result.get(name) ?? [];
      list.push({ date: line.date, opp: line.opp, dk: line.dk, ts: line.ts });
      result.set(name, list);
    }
  }

  const trimmed = new Map<string, Last5Game[]>();
  for (const [name, list] of result) {
    list.sort((a, b) => b.ts - a.ts);
    trimmed.set(
      name,
      list.slice(0, 5).map(({ date, opp, dk }) => ({ date, opp, dk }))
    );
  }
  return trimmed;
}
