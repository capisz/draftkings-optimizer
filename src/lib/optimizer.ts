// src/lib/optimizer.ts
// Lineup construction shared by /api/generate-lineup and the recommender.
// Supports DraftKings NBA Classic (8 slots) and Showdown Captain Mode
// (CPT at 1.5x salary/points + 5 UTIL).

import type { PoolPlayer, SlateInfo } from "@/lib/draftkings";

export const SALARY_CAP = 50000;

export const CLASSIC_SLOTS = [
  "PG",
  "SG",
  "SF",
  "PF",
  "C",
  "G",
  "F",
  "UTIL",
] as const;

export const SHOWDOWN_SLOTS = [
  "CPT",
  "UTIL",
  "UTIL",
  "UTIL",
  "UTIL",
  "UTIL",
] as const;

// DraftKings MLB Classic roster
export const MLB_CLASSIC_SLOTS = [
  "P",
  "P",
  "C",
  "1B",
  "2B",
  "3B",
  "SS",
  "OF",
  "OF",
  "OF",
] as const;

export type LineupPlayer = PoolPlayer & {
  slot: string;
  // CPT rows carry 1.5x salary/points so totals add up at face value
  baseSalary: number;
  baseAvgDK: number;
};

export type LineupResult = {
  lineup: LineupPlayer[];
  totalSalary: number;
  totalAvgDK: number;
  totalEfficiency: number;
  totalScore: number;
  salaryCap: number;
};

export function slotsForSlate(slate: SlateInfo): readonly string[] {
  if (slate.gameType === "showdown") return SHOWDOWN_SLOTS;
  return slate.sport === "MLB" ? MLB_CLASSIC_SLOTS : CLASSIC_SLOTS;
}

export function parsePosition(pos: string): string[] {
  return (pos || "")
    .split(/[\/,]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

export function canPlay(posStr: string, slot: string): boolean {
  const parts = parsePosition(posStr);
  if (slot === "UTIL" || slot === "CPT") return parts.length > 0;
  // NBA composite slots
  if (slot === "G") return parts.includes("PG") || parts.includes("SG");
  if (slot === "F") return parts.includes("SF") || parts.includes("PF");
  // MLB pitcher slot accepts SP/RP (or generic P)
  if (slot === "P")
    return parts.includes("P") || parts.includes("SP") || parts.includes("RP");
  return parts.includes(slot);
}

// weighted mix: mostly projection, some value
export function weightedScore(p: { avgDK: number; efficiency: number }): number {
  return p.avgDK * 0.7 + p.efficiency * 0.3;
}

// Selection score: tentative players (sparse/stale/sporadic recent usage)
// are down-weighted so steadier options win close calls
export function selectionScore(p: PoolPlayer): number {
  return weightedScore(p) * (p.tentative ? 0.8 : 1);
}

export function asLineupPlayer(p: PoolPlayer, slot: string): LineupPlayer {
  const isCpt = slot === "CPT";
  return {
    ...p,
    slot,
    baseSalary: p.salary,
    baseAvgDK: p.avgDK,
    salary: isCpt ? Math.round(p.salary * 1.5) : p.salary,
    avgDK: isCpt ? Number((p.avgDK * 1.5).toFixed(2)) : p.avgDK,
  };
}

function totalsOf(lineup: LineupPlayer[]): LineupResult {
  const totalSalary = lineup.reduce((s, p) => s + p.salary, 0);
  const totalAvgDK = lineup.reduce((s, p) => s + p.avgDK, 0);
  const totalEfficiency = lineup.reduce((s, p) => s + p.efficiency, 0);
  const totalScore = lineup.reduce(
    (s, p) => s + weightedScore({ avgDK: p.avgDK, efficiency: p.efficiency }),
    0
  );
  return {
    lineup,
    totalSalary,
    totalAvgDK,
    totalEfficiency,
    totalScore,
    salaryCap: SALARY_CAP,
  };
}

function buildClassic(
  players: PoolPlayer[],
  slots: readonly string[]
): LineupPlayer[] | null {
  const ranked = players
    .map((p) => ({ ...p, _score: selectionScore(p) }))
    .sort((a, b) => b._score - a._score);

  const MAX_PER_SLOT = 14;

  // Per-slot candidates drawn from the FULL ranked pool (not a global top-N),
  // so low-scoring positions like catcher always have options.
  const candidatesBySlot = slots.map((slot) =>
    ranked.filter((p) => canPlay(p.position, slot)).slice(0, MAX_PER_SLOT)
  );

  // Cheapest eligible salary for each slot — used to reserve cap for the
  // slots still to come so the search/greedy never paints into a corner.
  const minSalaryForSlot = slots.map((slot) => {
    const elig = ranked.filter((p) => canPlay(p.position, slot));
    return elig.length ? Math.min(...elig.map((p) => p.salary)) : Infinity;
  });
  const reserveAfter = slots.map((_, i) =>
    minSalaryForSlot.slice(i + 1).reduce((s, v) => s + v, 0)
  );

  let bestLineup: LineupPlayer[] | null = null;
  let bestScore = -Infinity;
  // bound the search for the deeper MLB roster so it stays fast
  let nodes = 0;
  const NODE_BUDGET = 3_000_000;

  function search(
    slotIndex: number,
    usedIds: Set<string>,
    salary: number,
    score: number,
    lineup: LineupPlayer[]
  ) {
    if (nodes++ > NODE_BUDGET) return;
    if (slotIndex === slots.length) {
      if (salary <= SALARY_CAP && score > bestScore) {
        bestScore = score;
        bestLineup = [...lineup];
      }
      return;
    }

    const slot = slots[slotIndex];
    for (const p of candidatesBySlot[slotIndex]) {
      if (usedIds.has(p.id)) continue;
      const newSalary = salary + p.salary;
      // leave enough cap for the cheapest fills of the remaining slots
      if (newSalary + reserveAfter[slotIndex] > SALARY_CAP) continue;

      usedIds.add(p.id);
      lineup.push(asLineupPlayer(p, slot));
      search(slotIndex + 1, usedIds, newSalary, score + p._score, lineup);
      lineup.pop();
      usedIds.delete(p.id);
    }
  }

  search(0, new Set(), 0, 0, []);

  if (bestLineup) return bestLineup;

  // Salary-aware greedy fallback: best score per slot that still leaves the
  // cheapest fills affordable for the remaining slots.
  const used = new Set<string>();
  const greedy: LineupPlayer[] = [];
  let salary = 0;
  for (let i = 0; i < slots.length; i++) {
    let chosen: (PoolPlayer & { _score: number }) | null = null;
    for (const p of candidatesBySlot[i]) {
      if (used.has(p.id)) continue;
      if (salary + p.salary + reserveAfter[i] > SALARY_CAP) continue;
      chosen = p;
      break;
    }
    if (!chosen) return null;
    used.add(chosen.id);
    salary += chosen.salary;
    greedy.push(asLineupPlayer(chosen, slots[i]));
  }
  return greedy.length === slots.length ? greedy : null;
}

function buildShowdown(players: PoolPlayer[]): LineupPlayer[] | null {
  const ranked = players
    .filter((p) => p.salary > 0 && p.avgDK > 0)
    .map((p) => ({ ...p, _score: selectionScore(p) }))
    .sort((a, b) => b._score - a._score);

  const cptCandidates = ranked.slice(0, 12);
  const utilPool = ranked.slice(0, 24);

  let bestLineup: LineupPlayer[] | null = null;
  let bestScore = -Infinity;

  for (const cpt of cptCandidates) {
    const cptSalary = Math.round(cpt.salary * 1.5);
    if (cptSalary > SALARY_CAP) continue;

    const flex = utilPool.filter((p) => p.id !== cpt.id);

    // DFS over flex candidates in score order; index ordering avoids
    // exploring permutations of the same five players.
    function pick(
      startIdx: number,
      taken: typeof flex,
      salary: number,
      score: number
    ) {
      if (taken.length === 5) {
        if (score > bestScore) {
          bestScore = score;
          bestLineup = [
            asLineupPlayer(cpt, "CPT"),
            ...taken.map((p) => asLineupPlayer(p, "UTIL")),
          ];
        }
        return;
      }
      for (let i = startIdx; i < flex.length; i++) {
        const p = flex[i];
        const newSalary = salary + p.salary;
        if (newSalary > SALARY_CAP) continue;
        // Optimistic bound: remaining picks can't beat best
        const remaining = 5 - taken.length - 1;
        const optimistic =
          score + p._score + remaining * (flex[i + 1]?._score ?? 0);
        if (optimistic <= bestScore) continue;
        pick(i + 1, [...taken, p], newSalary, score + p._score);
      }
    }

    pick(0, [], cptSalary, cpt._score * 1.5);
  }

  return bestLineup;
}

export function buildLineup(
  players: PoolPlayer[],
  slate: SlateInfo
): LineupResult | null {
  const eligible = players.filter(
    (p) => p.name && p.position && p.salary > 0 && p.avgDK > 0
  );
  if (!eligible.length) return null;

  const lineup =
    slate.gameType === "showdown"
      ? buildShowdown(eligible)
      : buildClassic(eligible, slotsForSlate(slate));

  return lineup ? totalsOf(lineup) : null;
}

export { totalsOf };
