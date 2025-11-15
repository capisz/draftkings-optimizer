// src/app/api/generate-lineup/route.ts
import { NextResponse } from "next/server";
import raw from "@/data/players-2025-11-14-last5.json";

const SALARY_CAP = 50000;

type Last5Game = {
  date: string;
  opp: string;
  dk: number;
};

type PlayerJson = {
  id: string;
  name: string;
  position: string; // e.g. "PG/SG"
  team: string;
  salary: number;
  avgDK: number;
  efficiency: number;
  image?: string | null;
  gameInfo?: string;
  last5?: Last5Game[];
};

type Payload = {
  count: number;
  data: PlayerJson[];
};

type Player = {
  id: string;
  name: string;
  position: string;
  team: string;
  salary: number;
  avgDK: number;
  efficiency: number;
  image?: string | null;
  gameInfo?: string;
  last5?: Last5Game[];
};

type LineupPlayer = Player & { slot: string };

const SLOTS = ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"] as const;
type Slot = (typeof SLOTS)[number];

function parsePosition(pos: string): string[] {
  return pos
    .split(/[\/,]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function canPlay(posStr: string, slot: Slot): boolean {
  const parts = parsePosition(posStr);

  if (slot === "UTIL") return parts.length > 0;
  if (slot === "G") return parts.includes("PG") || parts.includes("SG");
  if (slot === "F") return parts.includes("SF") || parts.includes("PF");
  return parts.includes(slot);
}

// weighted mix: mostly projection, some value
function weightedScore(p: Player): number {
  return p.avgDK * 0.7 + p.efficiency * 0.3;
}

export async function GET() {
  try {
    // ✅ Use the same static JSON as /api/players, no HTTP calls at all
    const payload = raw as Payload;
    const rawPlayers = payload.data || [];

    const allPlayers: Player[] = rawPlayers
      .map((p) => ({
        id: String(p.id),
        name: p.name ?? "",
        position: p.position ?? "",
        team: p.team ?? "",
        salary: Number(p.salary) || 0,
        avgDK: Number(p.avgDK) || 0,
        efficiency: Number(p.efficiency) || 0,
        image: p.image ?? null,
        gameInfo: p.gameInfo ?? "",
        last5: p.last5 ?? [],
      }))
      .filter(
        (p) =>
          p.name &&
          p.position &&
          p.salary > 0 &&
          p.avgDK > 0 // ignore complete scrubs / DNPs
      );

    if (!allPlayers.length) {
      return NextResponse.json(
        { error: "No players available for optimization" },
        { status: 400 }
      );
    }

    // Rank by weighted score
    const ranked = allPlayers
      .map((p) => ({ ...p, _score: weightedScore(p) }))
      .sort((a, b) => b._score - a._score);

    // Keep a reasonably small pool but still plenty of options
    const pool = ranked.slice(0, 60);

    // Candidates per slot (top N that can play that slot)
    const MAX_PER_SLOT = 12;
    const candidatesBySlot: Record<Slot, (Player & { _score: number })[]> =
      {} as any;

    for (const slot of SLOTS) {
      candidatesBySlot[slot] = pool
        .filter((p) => canPlay(p.position, slot))
        .slice(0, MAX_PER_SLOT);
    }

    let bestLineup: LineupPlayer[] | null = null;
    let bestScore = -Infinity;

    function search(
      slotIndex: number,
      usedIds: Set<string>,
      currentSalary: number,
      currentScore: number,
      lineup: LineupPlayer[]
    ) {
      if (slotIndex === SLOTS.length) {
        if (currentSalary <= SALARY_CAP && currentScore > bestScore) {
          bestScore = currentScore;
          bestLineup = [...lineup];
        }
        return;
      }

      const slot = SLOTS[slotIndex];
      const candidates = candidatesBySlot[slot] || [];

      for (const p of candidates) {
        if (usedIds.has(p.id)) continue;

        const newSalary = currentSalary + p.salary;
        if (newSalary > SALARY_CAP) continue;

        usedIds.add(p.id);
        lineup.push({ ...p, slot });

        search(
          slotIndex + 1,
          usedIds,
          newSalary,
          currentScore + (p as any)._score,
          lineup
        );

        lineup.pop();
        usedIds.delete(p.id);
      }
    }

    search(0, new Set<string>(), 0, 0, []);

    // Fallback: greedy if for some reason no lineup found
    if (!bestLineup) {
      const used = new Set<string>();
      const greedy: LineupPlayer[] = [];
      let salary = 0;

      for (const slot of SLOTS) {
        const candidates = candidatesBySlot[slot] || [];
        for (const p of candidates) {
          if (used.has(p.id)) continue;
          if (salary + p.salary > SALARY_CAP) continue;

          used.add(p.id);
          salary += p.salary;
          greedy.push({ ...p, slot });
          break;
        }
      }

      if (!greedy.length) {
        return NextResponse.json(
          { error: "Unable to build a valid lineup" },
          { status: 500 }
        );
      }

      bestLineup = greedy;
      bestScore = greedy.reduce(
        (sum, p) => sum + weightedScore(p),
        0
      );
    }

    const lineup = bestLineup!;
    const totalSalary = lineup.reduce((sum, p) => sum + p.salary, 0);
    const totalAvgDK = lineup.reduce((sum, p) => sum + p.avgDK, 0);
    const totalEfficiency = lineup.reduce(
      (sum, p) => sum + p.efficiency,
      0
    );

    return NextResponse.json({
      lineup,
      totalSalary,
      totalAvgDK,
      totalEfficiency,
      totalScore: bestScore,
      salaryCap: SALARY_CAP,
    });
  } catch (err: any) {
    console.error("API /api/generate-lineup error:", err);
    return NextResponse.json(
      {
        error: "Lineup generation failed",
        details: err?.message ?? "Unknown error",
      },
      { status: 500 }
    );
  }
}
