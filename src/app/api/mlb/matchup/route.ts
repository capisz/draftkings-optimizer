// src/app/api/mlb/matchup/route.ts
// MLB "AI" — for a selected hitter slot it ranks eligible replacements by how
// favorable their batter-vs-pitcher history is against the opposing probable
// pitcher (career splits + sample size from the MLB Stats API). For pitcher
// slots it falls back to the projection/value model. Repeated presses rotate
// to the next-best option via the `index` param.

import { NextResponse } from "next/server";
import { getPlayerPool, type PoolPlayer } from "@/lib/draftkings";
import {
  SALARY_CAP,
  asLineupPlayer,
  canPlay,
  selectionScore,
  totalsOf,
  type LineupPlayer,
} from "@/lib/optimizer";
import { getBvP, type BvP } from "@/lib/mlbStats";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Body = {
  lineup: LineupPlayer[];
  selectedKey: string; // `${slot}:${id}`
  index?: number; // rotation cursor
};

const MIN_SAMPLE = 6; // PAs needed before BvP meaningfully moves the ranking

function favorability(bvp: BvP | null): { bonus: number; strong: boolean } {
  if (!bvp || bvp.pa < MIN_SAMPLE) return { bonus: 0, strong: false };
  // confidence grows with sample, capped at 30 PA
  const conf = Math.min(bvp.pa, 30) / 30;
  // OPS centered at .700 (roughly league average), scaled into DK-point space
  const edge = (bvp.ops - 0.7) * 12;
  return { bonus: edge * conf, strong: bvp.ops >= 0.85 && bvp.pa >= 10 };
}

function bvpReason(p: PoolPlayer, bvp: BvP | null): string {
  const opp = p.opposingPitcher?.name ?? "the opposing pitcher";
  if (!bvp || bvp.pa < MIN_SAMPLE) {
    return `Limited history vs ${opp}${
      bvp && bvp.pa ? ` (only ${bvp.pa} PA)` : ""
    } — ranked on recent value and price.`;
  }
  const slash = `${bvp.hits}-for-${bvp.ab} (.${String(Math.round(bvp.avg * 1000)).padStart(3, "0")})`;
  const extras = [
    bvp.hr ? `${bvp.hr} HR` : "",
    `${bvp.ops.toFixed(3)} OPS`,
  ]
    .filter(Boolean)
    .join(", ");
  const verdict =
    bvp.ops >= 0.9
      ? "a strong matchup edge"
      : bvp.ops >= 0.75
        ? "a solid track record"
        : "a usable history";
  return `${slash} with ${extras} over ${bvp.pa} career PA vs ${opp} — ${verdict}.`;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const lineup = Array.isArray(body.lineup) ? body.lineup : [];
  const target = lineup.find((p) => `${p.slot}:${p.id}` === body.selectedKey);
  if (!target) {
    return NextResponse.json(
      { error: "Highlighted slot doesn't match the lineup" },
      { status: 400 }
    );
  }

  try {
    const { players } = await getPlayerPool("MLB");
    if (!players.length) {
      return NextResponse.json(
        { error: "No live MLB slate available right now." },
        { status: 503 }
      );
    }

    const lineupIds = new Set(lineup.filter((p) => p.id).map((p) => p.id));
    const othersSalary = lineup
      .filter((p) => p !== target)
      .reduce((s, p) => s + p.salary, 0);
    const budget = SALARY_CAP - othersSalary;

    const slotCost = (p: PoolPlayer) =>
      target.slot === "CPT" ? Math.round(p.salary * 1.5) : p.salary;

    // eligible replacements that fit the remaining cap
    let candidates = players
      .filter(
        (p) =>
          p.id !== target.id &&
          !lineupIds.has(p.id) &&
          p.salary > 0 &&
          p.avgDK > 0 &&
          canPlay(p.position, target.slot) &&
          slotCost(p) <= budget
      )
      .sort((a, b) => selectionScore(b) - selectionScore(a))
      .slice(0, 16); // bound the number of BvP lookups

    if (!candidates.length) {
      return NextResponse.json(
        {
          error:
            "No eligible replacement fits this slot under the remaining cap.",
        },
        { status: 422 }
      );
    }

    const isPitcher = /^(P|SP|RP)$/i.test(target.slot) || target.slot === "P";

    let ranked: { player: PoolPlayer; bvp: BvP | null; score: number }[];

    if (isPitcher) {
      // pitchers: no BvP — rank on projection/value
      ranked = candidates
        .map((p) => ({ player: p, bvp: null, score: selectionScore(p) }))
        .sort((a, b) => b.score - a.score);
    } else {
      // hitters: pull BvP vs the opposing probable pitcher and blend it in
      const withBvp = await Promise.all(
        candidates.map(async (p) => {
          const bvp =
            p.mlbId && p.opposingPitcher?.id
              ? await getBvP(p.mlbId, p.opposingPitcher.id)
              : null;
          const fav = favorability(bvp);
          return {
            player: p,
            bvp,
            score: selectionScore(p) + fav.bonus,
            strong: fav.strong,
          };
        })
      );
      // favorable matchups (good sample) float to the top
      ranked = withBvp.sort((a, b) => {
        if (a.strong !== b.strong) return a.strong ? -1 : 1;
        return b.score - a.score;
      });
    }

    const idx = Math.max(0, (body.index ?? 0)) % ranked.length;
    const choice = ranked[idx];
    const incoming = asLineupPlayer(choice.player, target.slot);
    const newLineup = lineup.map((p) => (p === target ? incoming : p));
    const totals = totalsOf(newLineup);

    if (totals.totalSalary > SALARY_CAP) {
      return NextResponse.json(
        { error: "That swap would exceed the salary cap." },
        { status: 422 }
      );
    }

    const summary = isPitcher
      ? `Ranked ${ranked.length} eligible ${target.slot} options on projection and value. Showing option #${idx + 1} — press AI again for the next.`
      : `Compared ${ranked.length} eligible hitters by their batter-vs-pitcher history against their probable pitchers (career splits + sample size). Showing option #${idx + 1} — press AI again for the next.`;

    return NextResponse.json({
      summary,
      suggestions: [
        {
          slot: target.slot,
          out: target,
          in: incoming,
          reasoning: isPitcher
            ? `Best available ${target.slot} by recent value at $${incoming.salary.toLocaleString()}.`
            : bvpReason(choice.player, choice.bvp),
          kept: incoming.id === target.id,
        },
      ],
      newLineup,
      newTotals: {
        totalSalary: totals.totalSalary,
        totalAvgDK: totals.totalAvgDK,
        totalScore: totals.totalScore,
        salaryCap: SALARY_CAP,
      },
    });
  } catch (err: any) {
    console.error("API /api/mlb/matchup error:", err);
    return NextResponse.json(
      { error: "Matchup analysis failed", details: err?.message },
      { status: 500 }
    );
  }
}
