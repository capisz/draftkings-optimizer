// src/lib/recommender.ts
// Local lineup recommender — ranks eligible replacements for a slot using the
// same weighted form/value model the optimizer uses, with reliability and
// minutes-trend factors. Runs entirely client-side (no external API), and is
// surfaced in the UI as the "AI" analyst.

import type { PoolPlayer } from "@/lib/draftkings";
import { canPlay, selectionScore } from "@/lib/optimizer";

export type RankedCandidate = {
  player: PoolPlayer;
  cost: number; // salary charged in this slot (CPT = 1.5x)
  score: number;
};

function slotCost(p: PoolPlayer, slot: string): number {
  return slot === "CPT" ? Math.round(p.salary * 1.5) : p.salary;
}

// Average minutes trend: returns "rising" / "falling" / null based on the most
// recent game vs the recent average (last5 is newest-first).
export function minutesTrend(p: PoolPlayer): "rising" | "falling" | null {
  const mins = (p.last5 ?? [])
    .map((g) => g.min)
    .filter((m): m is number => typeof m === "number" && m > 0);
  if (mins.length < 3) return null;
  const avg = mins.reduce((s, m) => s + m, 0) / mins.length;
  const last = mins[0];
  if (last >= avg + 6) return "rising";
  if (last <= avg - 6) return "falling";
  return null;
}

/**
 * Rank every eligible replacement for `target`'s slot, best first.
 * Excludes players already in the lineup and anyone who doesn't fit the
 * remaining salary cap.
 */
export function rankReplacements(opts: {
  pool: PoolPlayer[];
  lineupIds: Set<string>;
  target: { id: string; slot: string; salary: number };
  budget: number; // cap minus the rest of the lineup
}): RankedCandidate[] {
  const { pool, lineupIds, target, budget } = opts;

  return pool
    .filter(
      (p) =>
        p.id !== target.id &&
        !lineupIds.has(p.id) &&
        p.salary > 0 &&
        p.avgDK > 0 &&
        canPlay(p.position, target.slot) &&
        slotCost(p, target.slot) <= budget
    )
    .map((p) => ({
      player: p,
      cost: slotCost(p, target.slot),
      score: selectionScore(p),
    }))
    .sort((a, b) => b.score - a.score);
}

/**
 * Human-readable rationale comparing the incoming pick to the player it
 * replaces — phrased like an analyst, built from the underlying numbers.
 */
export function explainPick(
  incoming: PoolPlayer,
  outgoing: PoolPlayer,
  costDelta: number
): string {
  const reasons: string[] = [];

  const formDelta = incoming.avgDK - outgoing.avgDK;
  if (formDelta >= 1) {
    reasons.push(
      `projects ${formDelta.toFixed(1)} more DK pts on recent form`
    );
  } else if (formDelta > -2) {
    reasons.push(`similar recent production`);
  }

  if (outgoing.tentative && !incoming.tentative) {
    reasons.push(
      `far steadier usage (${outgoing.name.split(" ").slice(-1)[0]} is ${outgoing.tentativeReason ?? "tentative"})`
    );
  }

  if (minutesTrend(incoming) === "rising") {
    reasons.push("minutes are trending up, pointing to a bigger role");
  }

  if (incoming.efficiency > outgoing.efficiency + 0.3) {
    reasons.push(
      `better value at ${incoming.efficiency.toFixed(2)} pts per $1K`
    );
  }

  if (costDelta < 0) {
    reasons.push(`frees up $${Math.abs(costDelta).toLocaleString()} of cap`);
  } else if (costDelta > 0) {
    reasons.push(`costs $${costDelta.toLocaleString()} more`);
  }

  if (!reasons.length) {
    return `${incoming.name} is the next-best fit for this slot.`;
  }

  // Capitalize first reason, join up to three
  const picked = reasons.slice(0, 3);
  picked[0] = picked[0].charAt(0).toUpperCase() + picked[0].slice(1);
  return picked.join(", ") + ".";
}
