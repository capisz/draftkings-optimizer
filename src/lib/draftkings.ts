// src/lib/draftkings.ts
// Server-side client for DraftKings' public lobby/draftables JSON endpoints.
// Fetches the current NBA slate (live salaries, FPPG, player images) and
// falls back to the bundled demo snapshot when no slate is available.

import demoData from "@/data/players-2025-11-14-last5.json";
import { getHeadshotUrl } from "@/lib/nbaHeadshots";
import { getLastFiveByPlayer, normalizeName } from "@/lib/nbaGameLogs";
import { enrichMlbMatchups, getMlbLast5 } from "@/lib/mlbStats";

export type Sport = "NBA" | "MLB";

export type Last5Game = {
  date: string;
  opp: string;
  dk: number;
  min?: number;
};

export type PoolPlayer = {
  id: string;
  name: string;
  position: string;
  team: string;
  salary: number;
  // Projection used by the optimizer: last-5-game DK average when we have
  // recent logs, otherwise DraftKings' season FPPG
  avgDK: number;
  // DraftKings' season-long FPPG (their pricing basis)
  fppg: number;
  efficiency: number;
  // Recent form minus FPPG: positive = outperforming the price, undervalued
  valueDelta: number | null;
  // Unreliable recent usage: few/no recent games, long layoff, or sporadic
  // minutes. The optimizer down-weights these and the AI is told about them.
  tentative: boolean;
  tentativeReason: string | null;
  image: string | null;
  gameInfo: string;
  status: string;
  last5: Last5Game[];
  // DraftKings' own player id (playerDkId) — used for the CSV import string
  dkId?: string | null;
  // MLB only: opposing probable pitcher + this player's MLB id (for BvP)
  mlbId?: number | null;
  opposingPitcher?: { id: number; name: string } | null;
};

export type SlateInfo = {
  source: "live" | "demo";
  sport: Sport;
  draftGroupId: number | null;
  gameType: "classic" | "showdown";
  gameTypeName: string;
  startDate: string | null;
  label: string;
};

export type PlayerPool = {
  players: PoolPlayer[];
  slate: SlateInfo;
};

const DRAFTABLES_URL = (id: number) =>
  `https://api.draftkings.com/draftgroups/v1/draftgroups/${id}/draftables?format=json`;

const DK_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

// Per-sport DraftKings configuration. ContestTypeId is the field on lobby
// draft groups; FPPG lives in draftStatAttributes under the given id.
type SportConfig = {
  lobbyUrl: string;
  classicCtid: number;
  showdownCtid: number;
  fppgAttr: number;
  classicName: string;
  showdownName: string;
};

const SPORTS: Record<Sport, SportConfig> = {
  NBA: {
    lobbyUrl: "https://www.draftkings.com/lobby/getcontests?sport=NBA",
    classicCtid: 5,
    showdownCtid: 81,
    fppgAttr: 219,
    classicName: "NBA Classic",
    showdownName: "NBA Showdown (Captain Mode)",
  },
  MLB: {
    lobbyUrl: "https://www.draftkings.com/lobby/getcontests?sport=MLB",
    classicCtid: 28,
    showdownCtid: 114,
    fppgAttr: 408,
    classicName: "MLB Classic",
    showdownName: "MLB Showdown (Captain Mode)",
  },
};

const CACHE_TTL_MS = 5 * 60 * 1000;

const cachedBySport: Partial<Record<Sport, { pool: PlayerPool; at: number }>> =
  {};

function formatGameInfo(name: string, startTimeIso: string | null): string {
  // Match the demo data format the UI parses: "NYK@SAS 06/13/2026 08:30PM ET"
  const teams = (name || "").replace(/\s+/g, "");
  if (!startTimeIso) return teams;

  const d = new Date(startTimeIso);
  if (Number.isNaN(d.getTime())) return teams;

  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(d);

  const get = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";

  const date = `${get("month")}/${get("day")}/${get("year")}`;
  const time = `${get("hour")}:${get("minute")}${get("dayPeriod").toUpperCase()}`;
  return `${teams} ${date} ${time} ET`;
}

function parseFppg(attrs: any[], attrId: number): number {
  if (!Array.isArray(attrs)) return 0;
  const fppg = attrs.find((a) => a?.id === attrId);
  const candidates = fppg ? [fppg] : attrs;
  for (const a of candidates) {
    const v = parseFloat(a?.sortValue ?? a?.value);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
}

function efficiencyOf(avgDK: number, salary: number): number {
  if (!salary) return 0;
  return Number((avgDK / (salary / 1000)).toFixed(2));
}

// The core of the value model: when we have recent game logs, the player's
// projection becomes their last-5 DK average instead of season FPPG, so a
// player whose recent form outruns their (FPPG-based) salary scores as
// undervalued and rises in the optimizer.
function applyRecentForm(player: PoolPlayer, last5: Last5Game[]): void {
  player.last5 = last5;
  if (last5.length < 2) return; // one game is noise, not form

  const recentAvg = Number(
    (last5.reduce((s, g) => s + g.dk, 0) / last5.length).toFixed(2)
  );
  player.avgDK = recentAvg;
  player.efficiency = efficiencyOf(recentAvg, player.salary);
  player.valueDelta = player.fppg
    ? Number((recentAvg - player.fppg).toFixed(1))
    : null;
}

async function enrichWithRecentForm(players: PoolPlayer[]): Promise<void> {
  const logs = await getLastFiveByPlayer(players.map((p) => p.team));
  for (const p of players) {
    const last5 = logs.get(normalizeName(p.name));
    if (last5?.length) applyRecentForm(p, last5);
  }
  applyReliability(players);
}

// MLB last-5 form. One gameLog call per player, so we bound it to the most
// salient names (by FPPG) — the studs and likely-rostered players. Reliability
// is then judged only over that set so we don't flag everyone "no recent data".
async function enrichMlbRecentForm(
  players: PoolPlayer[],
  startDateIso: string | null
): Promise<void> {
  const season =
    Number((startDateIso ?? "").slice(0, 4)) || new Date().getFullYear();

  const top = [...players]
    .filter((p) => p.mlbId)
    .sort((a, b) => b.fppg - a.fppg)
    .slice(0, 140);

  const logs = await getMlbLast5(
    top.map((p) => ({ dkId: p.id, mlbId: p.mlbId as number, position: p.position })),
    season
  );

  for (const p of top) {
    const last5 = logs.get(p.id);
    if (last5?.length) applyRecentForm(p, last5);
  }
  // judge reliability only over the players we actually pulled logs for
  applyReliability(top);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// Flag players whose recent usage makes their projection shaky: no/few
// recent games, a long layoff, or sporadic minutes. Measured against the
// most recent game date in the pool so it also works on old demo data.
export function applyReliability(players: PoolPlayer[]): void {
  const allDates = players.flatMap((p) =>
    p.last5.map((g) => Date.parse(g.date)).filter(Number.isFinite)
  );
  if (!allDates.length) return;
  const poolLatest = Math.max(...allDates);

  for (const p of players) {
    const n = p.last5.length;
    // Starting/relief pitchers work on a rotation, not daily — the "spaced-out
    // usage" rule (built for NBA minutes / MLB platoon bats) doesn't apply, and
    // a layoff only signals trouble after a longer gap.
    const isPitcher = /^(SP|RP|P)$/i.test((p.position || "").trim());
    const layoffDays = isPitcher ? 14 : 10;

    if (n === 0) {
      p.tentative = true;
      p.tentativeReason = "no recent game data";
      continue;
    }

    const dates = p.last5
      .map((g) => Date.parse(g.date))
      .filter(Number.isFinite)
      .sort((a, b) => a - b);
    const newest = dates[dates.length - 1];
    const oldest = dates[0];
    const daysSinceLast = Math.round((poolLatest - newest) / DAY_MS);
    const avgGapDays = n >= 2 ? (newest - oldest) / DAY_MS / (n - 1) : 0;

    if (daysSinceLast > layoffDays) {
      p.tentative = true;
      p.tentativeReason = `hasn't played in ${daysSinceLast} days`;
    } else if (n < 3) {
      p.tentative = true;
      p.tentativeReason = `only ${n} recent game${n > 1 ? "s" : ""}`;
    } else if (!isPitcher && avgGapDays > 5.5) {
      p.tentative = true;
      p.tentativeReason = "in and out of the lineup";
    } else {
      p.tentative = false;
      p.tentativeReason = null;
    }
  }
}

async function fetchJson(url: string): Promise<any> {
  const res = await fetch(url, {
    headers: DK_HEADERS,
    // Route-level caching is handled by our own TTL cache
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`DraftKings request failed (${res.status})`);
  return res.json();
}

type DraftGroupChoice = {
  draftGroupId: number;
  contestTypeId: number;
  startDate: string;
  tag: string;
  suffix: string;
};

// WNBA games share the NBA lobby (and the Showdown contest type), so the only
// way to tell leagues apart is the team abbreviations in the group suffix.
// Includes DK alias codes (PHO, BRK, …) alongside NBA.com tricodes.
const NBA_TEAMS = new Set([
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
  "PHO", "BRK", "GS", "NO", "NY", "SA", "UTAH", "WSH",
]);

function isNbaGroup(g: DraftGroupChoice): boolean {
  // Suffix looks like " (NYK @ SAS)" for single games; empty for full slates
  const m = g.suffix.match(/\(([^)]+)\)/);
  if (!m) return true;
  const teams = m[1]
    .split("@")
    .map((t) => t.replace(/2H|1H/g, "").trim())
    .filter(Boolean);
  if (teams.length < 2) return true;
  return teams.every((t) => NBA_TEAMS.has(t));
}

function pickDraftGroup(
  lobby: any,
  sport: Sport,
  cfg: SportConfig
): DraftGroupChoice | null {
  const groups: DraftGroupChoice[] = (lobby?.DraftGroups || [])
    .map((g: any) => ({
      draftGroupId: g?.DraftGroupId,
      contestTypeId: g?.ContestTypeId,
      startDate: g?.StartDateEst ?? "",
      tag: g?.DraftGroupTag ?? "",
      suffix: g?.ContestStartTimeSuffix ?? "",
    }))
    .filter(
      (g: DraftGroupChoice) =>
        g.draftGroupId &&
        (g.contestTypeId === cfg.classicCtid ||
          g.contestTypeId === cfg.showdownCtid) &&
        // NBA shares its lobby with WNBA; filter by team codes. MLB doesn't.
        (sport !== "NBA" || isNbaGroup(g))
    );

  if (!groups.length) return null;

  // Prefer classic slates, then featured groups, then the earliest start
  groups.sort((a, b) => {
    if (a.contestTypeId !== b.contestTypeId) {
      return a.contestTypeId === cfg.classicCtid ? -1 : 1;
    }
    const aFeat = a.tag === "Featured" ? 0 : 1;
    const bFeat = b.tag === "Featured" ? 0 : 1;
    if (aFeat !== bFeat) return aFeat - bFeat;
    return a.startDate.localeCompare(b.startDate);
  });

  return groups[0];
}

function mapDraftables(
  json: any,
  group: DraftGroupChoice,
  sport: Sport,
  cfg: SportConfig
): PlayerPool {
  const competitions = new Map<number, any>();
  for (const c of json?.competitions || []) {
    competitions.set(c?.competitionId, c);
  }

  // Players repeat once per roster slot (and at 1.5x salary for CPT in
  // showdown) — dedupe by playerId keeping the cheapest (base) entry.
  const byPlayer = new Map<number, any>();
  for (const d of json?.draftables || []) {
    if (!d?.playerId || d?.isDisabled) continue;
    const prev = byPlayer.get(d.playerId);
    if (!prev || (d.salary ?? Infinity) < (prev.salary ?? Infinity)) {
      byPlayer.set(d.playerId, d);
    }
  }

  const players: PoolPlayer[] = [];
  for (const d of byPlayer.values()) {
    const salary = Number(d.salary) || 0;
    const fppg = parseFppg(d.draftStatAttributes, cfg.fppgAttr);
    const comp = competitions.get(d?.competition?.competitionId);
    const startTime = comp?.startTime ?? d?.competition?.startTime ?? null;
    const compName = d?.competition?.name ?? "";

    players.push({
      id: String(d.playerId),
      dkId: d.playerDkId != null ? String(d.playerDkId) : String(d.playerId),
      name: d.displayName ?? `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim(),
      position: d.position ?? "",
      team: d.teamAbbreviation ?? "",
      salary,
      avgDK: fppg,
      fppg,
      efficiency: efficiencyOf(fppg, salary),
      valueDelta: null,
      tentative: false,
      tentativeReason: null,
      image:
        d.playerImage160 ||
        d.playerImage50 ||
        // NBA.com headshots only exist for NBA names
        (sport === "NBA" ? getHeadshotUrl(d.displayName) : null),
      gameInfo: formatGameInfo(compName, startTime),
      status: d.status ?? "",
      last5: [],
      mlbId: null,
      opposingPitcher: null,
    });
  }

  players.sort((a, b) => b.salary - a.salary);

  const isClassic = group.contestTypeId === cfg.classicCtid;
  const game = players[0]?.gameInfo ? ` — ${players[0].gameInfo}` : "";
  const slate: SlateInfo = {
    source: "live",
    sport,
    draftGroupId: group.draftGroupId,
    gameType: isClassic ? "classic" : "showdown",
    gameTypeName: isClassic ? cfg.classicName : cfg.showdownName,
    startDate: group.startDate || null,
    label: isClassic
      ? `Live ${cfg.classicName} slate`
      : `Live ${cfg.showdownName}${game}`,
  };

  return { players, slate };
}

function demoPool(): PlayerPool {
  const payload = demoData as { count: number; data: any[] };
  const players: PoolPlayer[] = (payload.data || []).map((p) => {
    const name = (p.name || "").trim();
    const player: PoolPlayer = {
      id: String(p.id),
      dkId: String(p.id),
      name,
      position: p.position ?? "",
      team: p.team ?? "",
      salary: Number(p.salary) || 0,
      avgDK: Number(p.avgDK) || 0,
      fppg: Number(p.avgDK) || 0,
      efficiency: Number(p.efficiency) || 0,
      valueDelta: null,
      tentative: false,
      tentativeReason: null,
      image: getHeadshotUrl(name),
      gameInfo: p.gameInfo ?? "",
      status: "",
      last5: p.last5 ?? [],
    };
    applyRecentForm(player, player.last5);
    return player;
  });
  applyReliability(players);

  return {
    players,
    slate: {
      source: "demo",
      sport: "NBA",
      draftGroupId: null,
      gameType: "classic",
      gameTypeName: "NBA Classic",
      startDate: null,
      label: "Demo slate (Nov 14, 2025) — live DraftKings data unavailable",
    },
  };
}

export async function getPlayerPool(sport: Sport = "NBA"): Promise<PlayerPool> {
  const hit = cachedBySport[sport];
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return hit.pool;
  }

  const cfg = SPORTS[sport];

  try {
    const lobby = await fetchJson(cfg.lobbyUrl);
    const group = pickDraftGroup(lobby, sport, cfg);
    if (!group) throw new Error(`No ${sport} draft groups in the lobby`);

    const draftables = await fetchJson(DRAFTABLES_URL(group.draftGroupId));
    const pool = mapDraftables(draftables, group, sport, cfg);
    if (!pool.players.length) throw new Error("Slate returned no players");

    // Stat enrichment is an enhancement — never let it break live data
    try {
      if (sport === "NBA") {
        await enrichWithRecentForm(pool.players);
      } else if (sport === "MLB") {
        await enrichMlbMatchups(pool.players, pool.slate.startDate);
        await enrichMlbRecentForm(pool.players, pool.slate.startDate);
      }
    } catch (err) {
      console.error(`[draftkings] ${sport} enrichment failed:`, err);
    }

    cachedBySport[sport] = { pool, at: Date.now() };
    return pool;
  } catch (err) {
    console.error(
      `[draftkings] ${sport} live fetch failed, using demo data:`,
      err
    );
    // Only NBA has a bundled demo fallback; MLB surfaces an empty pool.
    const pool =
      sport === "NBA"
        ? demoPool()
        : {
            players: [],
            slate: {
              source: "demo" as const,
              sport: "MLB" as const,
              draftGroupId: null,
              gameType: "classic" as const,
              gameTypeName: "MLB Classic",
              startDate: null,
              label: "No live MLB slate available right now",
            },
          };
    cachedBySport[sport] = { pool, at: Date.now() };
    return pool;
  }
}
