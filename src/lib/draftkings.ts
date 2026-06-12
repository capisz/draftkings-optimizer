// src/lib/draftkings.ts
// Server-side client for DraftKings' public lobby/draftables JSON endpoints.
// Fetches the current NBA slate (live salaries, FPPG, player images) and
// falls back to the bundled demo snapshot when no slate is available.

import demoData from "@/data/players-2025-11-14-last5.json";
import { getHeadshotUrl } from "@/lib/nbaHeadshots";

export type Last5Game = {
  date: string;
  opp: string;
  dk: number;
};

export type PoolPlayer = {
  id: string;
  name: string;
  position: string;
  team: string;
  salary: number;
  avgDK: number;
  efficiency: number;
  image: string | null;
  gameInfo: string;
  status: string;
  last5: Last5Game[];
};

export type SlateInfo = {
  source: "live" | "demo";
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

const LOBBY_URL = "https://www.draftkings.com/lobby/getcontests?sport=NBA";
const DRAFTABLES_URL = (id: number) =>
  `https://api.draftkings.com/draftgroups/v1/draftgroups/${id}/draftables?format=json`;

const DK_HEADERS = {
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
};

// DraftKings game type ids (ContestTypeId on draft groups)
const CLASSIC_NBA = 5;
const SHOWDOWN_CAPTAIN = 81;

// FPPG lives in draftStatAttributes under this id
const FPPG_ATTR_ID = 219;

const CACHE_TTL_MS = 5 * 60 * 1000;

let cached: { pool: PlayerPool; at: number } | null = null;

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

function parseFppg(attrs: any[]): number {
  if (!Array.isArray(attrs)) return 0;
  const fppg = attrs.find((a) => a?.id === FPPG_ATTR_ID);
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
const NBA_TEAMS = new Set([
  "ATL", "BOS", "BKN", "CHA", "CHI", "CLE", "DAL", "DEN", "DET", "GSW",
  "HOU", "IND", "LAC", "LAL", "MEM", "MIA", "MIL", "MIN", "NOP", "NYK",
  "OKC", "ORL", "PHI", "PHX", "POR", "SAC", "SAS", "TOR", "UTA", "WAS",
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

function pickDraftGroup(lobby: any): DraftGroupChoice | null {
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
        (g.contestTypeId === CLASSIC_NBA ||
          g.contestTypeId === SHOWDOWN_CAPTAIN) &&
        isNbaGroup(g)
    );

  if (!groups.length) return null;

  // Prefer classic slates, then featured groups, then the earliest start
  groups.sort((a, b) => {
    if (a.contestTypeId !== b.contestTypeId) {
      return a.contestTypeId === CLASSIC_NBA ? -1 : 1;
    }
    const aFeat = a.tag === "Featured" ? 0 : 1;
    const bFeat = b.tag === "Featured" ? 0 : 1;
    if (aFeat !== bFeat) return aFeat - bFeat;
    return a.startDate.localeCompare(b.startDate);
  });

  return groups[0];
}

function mapDraftables(json: any, group: DraftGroupChoice): PlayerPool {
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
    const avgDK = parseFppg(d.draftStatAttributes);
    const comp = competitions.get(d?.competition?.competitionId);
    const startTime = comp?.startTime ?? d?.competition?.startTime ?? null;
    const compName = d?.competition?.name ?? "";

    players.push({
      id: String(d.playerId),
      name: d.displayName ?? `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim(),
      position: d.position ?? "",
      team: d.teamAbbreviation ?? "",
      salary,
      avgDK,
      efficiency: efficiencyOf(avgDK, salary),
      image:
        d.playerImage160 ||
        d.playerImage50 ||
        getHeadshotUrl(d.displayName) ||
        null,
      gameInfo: formatGameInfo(compName, startTime),
      status: d.status ?? "",
      last5: [],
    });
  }

  players.sort((a, b) => b.salary - a.salary);

  const isClassic = group.contestTypeId === CLASSIC_NBA;
  const slate: SlateInfo = {
    source: "live",
    draftGroupId: group.draftGroupId,
    gameType: isClassic ? "classic" : "showdown",
    gameTypeName: isClassic ? "NBA Classic" : "NBA Showdown (Captain Mode)",
    startDate: group.startDate || null,
    label: isClassic
      ? "Live NBA Classic slate"
      : `Live NBA Showdown${players[0]?.gameInfo ? ` — ${players[0].gameInfo}` : ""}`,
  };

  return { players, slate };
}

function demoPool(): PlayerPool {
  const payload = demoData as { count: number; data: any[] };
  const players: PoolPlayer[] = (payload.data || []).map((p) => {
    const name = (p.name || "").trim();
    return {
      id: String(p.id),
      name,
      position: p.position ?? "",
      team: p.team ?? "",
      salary: Number(p.salary) || 0,
      avgDK: Number(p.avgDK) || 0,
      efficiency: Number(p.efficiency) || 0,
      image: getHeadshotUrl(name),
      gameInfo: p.gameInfo ?? "",
      status: "",
      last5: p.last5 ?? [],
    };
  });

  return {
    players,
    slate: {
      source: "demo",
      draftGroupId: null,
      gameType: "classic",
      gameTypeName: "NBA Classic",
      startDate: null,
      label: "Demo slate (Nov 14, 2025) — live DraftKings data unavailable",
    },
  };
}

export async function getPlayerPool(): Promise<PlayerPool> {
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.pool;
  }

  try {
    const lobby = await fetchJson(LOBBY_URL);
    const group = pickDraftGroup(lobby);
    if (!group) throw new Error("No NBA draft groups in the lobby");

    const draftables = await fetchJson(DRAFTABLES_URL(group.draftGroupId));
    const pool = mapDraftables(draftables, group);
    if (!pool.players.length) throw new Error("Slate returned no players");

    cached = { pool, at: Date.now() };
    return pool;
  } catch (err) {
    console.error("[draftkings] live fetch failed, using demo data:", err);
    const pool = demoPool();
    // Cache the fallback briefly too, so a DK outage doesn't hammer them
    cached = { pool, at: Date.now() };
    return pool;
  }
}
