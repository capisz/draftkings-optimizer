// src/app/api/ai-swap/route.ts
// AI lineup agent: the user highlights lineup slots they want upgraded and
// Claude picks better replacements from the current player pool, respecting
// position eligibility and the salary cap.

import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getPlayerPool, PoolPlayer } from "@/lib/draftkings";
import {
  SALARY_CAP,
  asLineupPlayer,
  canPlay,
  totalsOf,
  weightedScore,
  type LineupPlayer,
} from "@/lib/optimizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8";

type SwapRequest = {
  lineup: LineupPlayer[];
  // keys of the lineup entries the user highlighted, as `${slot}:${id}`
  selectedKeys: string[];
  note?: string;
};

type AiSuggestion = {
  slot: string;
  out_id: string;
  in_id: string;
  reasoning: string;
};

type AiResponse = {
  suggestions: AiSuggestion[];
  summary: string;
};

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          slot: { type: "string" },
          out_id: { type: "string" },
          in_id: { type: "string" },
          reasoning: { type: "string" },
        },
        required: ["slot", "out_id", "in_id", "reasoning"],
        additionalProperties: false,
      },
    },
    summary: { type: "string" },
  },
  required: ["suggestions", "summary"],
  additionalProperties: false,
} as const;

function describePlayer(p: PoolPlayer): string {
  const status = p.status && p.status !== "None" ? ` [${p.status}]` : "";
  const form =
    p.valueDelta !== null
      ? ` | form vs price ${p.valueDelta > 0 ? "+" : ""}${p.valueDelta.toFixed(1)}`
      : "";
  return `${p.id} | ${p.name} | ${p.position} | ${p.team} | $${p.salary} | ${p.avgDK.toFixed(1)} proj (L5) | ${p.fppg.toFixed(1)} FPPG | ${p.efficiency.toFixed(2)} val${form}${status}`;
}

export async function POST(req: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      {
        error:
          "AI analyst is offline — set ANTHROPIC_API_KEY in .env.local to enable it.",
      },
      { status: 503 }
    );
  }

  let body: SwapRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const lineup = Array.isArray(body.lineup) ? body.lineup : [];
  const selectedKeys = Array.isArray(body.selectedKeys)
    ? body.selectedKeys
    : [];

  if (!lineup.length || !selectedKeys.length) {
    return NextResponse.json(
      { error: "Provide a lineup and at least one highlighted slot" },
      { status: 400 }
    );
  }

  const selected = lineup.filter((p) =>
    selectedKeys.includes(`${p.slot}:${p.id}`)
  );
  if (!selected.length) {
    return NextResponse.json(
      { error: "Highlighted slots don't match the lineup" },
      { status: 400 }
    );
  }

  try {
    const { players, slate } = await getPlayerPool();
    const byId = new Map(players.map((p) => [p.id, p]));

    const lineupIds = new Set(lineup.map((p) => p.id));
    const lockedSalary = lineup
      .filter((p) => !selected.some((s) => s.slot === p.slot && s.id === p.id))
      .reduce((s, p) => s + p.salary, 0);
    const budget = SALARY_CAP - lockedSalary;

    // Compact candidate pool: best 90 available players not already rostered
    const candidates = players
      .filter((p) => !lineupIds.has(p.id) && p.salary > 0 && p.avgDK > 0)
      .sort((a, b) => weightedScore(b) - weightedScore(a))
      .slice(0, 90);

    const cptNote =
      slate.gameType === "showdown"
        ? "This is a DraftKings Showdown lineup. The CPT slot scores 1.5x fantasy points but costs 1.5x salary — the salaries listed for candidates are BASE salaries, so a player placed in the CPT slot costs base salary x 1.5."
        : "This is a DraftKings NBA Classic lineup. Slot eligibility: PG/SG/SF/PF/C require that position; G accepts PG or SG; F accepts SF or PF; UTIL accepts anyone.";

    const prompt = [
      `You are a daily-fantasy NBA analyst. Improve the highlighted slots of this DraftKings lineup (${slate.gameTypeName}).`,
      "",
      "CURRENT LINEUP (slot | id | name | pos | team | salary in lineup | projected DK pts):",
      ...lineup.map(
        (p) =>
          `${p.slot} | ${p.id} | ${p.name} | ${p.position} | ${p.team} | $${p.salary} | ${p.avgDK.toFixed(1)}${
            selected.some((s) => s.slot === p.slot && s.id === p.id)
              ? "  <<< HIGHLIGHTED — replace if a better option exists"
              : ""
          }`
      ),
      "",
      `RULES: ${cptNote}`,
      `Salary cap is $${SALARY_CAP.toLocaleString()}. The non-highlighted players are locked and together cost $${lockedSalary.toLocaleString()}, so your replacements for the highlighted slots must cost at most $${budget.toLocaleString()} combined (CPT-adjusted where applicable). A player may appear only once in the lineup.`,
      body.note ? `USER NOTE: ${body.note}` : "",
      "",
      "CANDIDATE POOL (id | name | pos | team | base salary | FPPG | value | status):",
      ...candidates.map(describePlayer),
      "",
      "For each highlighted slot, suggest the best replacement from the candidate pool (or keep the current player by suggesting in_id equal to out_id if nothing beats them). Favor projection, but weigh value, injury status, and matchup. Keep reasoning to one or two sentences per swap.",
    ]
      .filter(Boolean)
      .join("\n");

    const client = new Anthropic();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      thinking: { type: "adaptive" },
      output_config: {
        format: { type: "json_schema", schema: RESPONSE_SCHEMA },
      },
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      throw new Error("No response from the model");
    }
    const ai = JSON.parse(text.text) as AiResponse;

    // Validate and enrich the suggestions before trusting them
    const validated: {
      slot: string;
      out: LineupPlayer;
      in: LineupPlayer;
      reasoning: string;
      kept: boolean;
    }[] = [];
    const usedIds = new Set(lineup.map((p) => p.id));

    for (const s of ai.suggestions) {
      const current = selected.find(
        (p) => p.slot === s.slot && p.id === s.out_id
      );
      if (!current) continue;

      if (s.in_id === s.out_id) {
        validated.push({
          slot: s.slot,
          out: current,
          in: current,
          reasoning: s.reasoning,
          kept: true,
        });
        continue;
      }

      const incoming = byId.get(s.in_id);
      if (!incoming) continue;
      if (usedIds.has(incoming.id)) continue;
      if (!canPlay(incoming.position, s.slot)) continue;

      usedIds.delete(current.id);
      usedIds.add(incoming.id);
      validated.push({
        slot: s.slot,
        out: current,
        in: asLineupPlayer(incoming, s.slot),
        reasoning: s.reasoning,
        kept: false,
      });
    }

    // Build the resulting lineup and reject the set if it busts the cap
    const newLineup = lineup.map((p) => {
      const swap = validated.find(
        (v) => v.slot === p.slot && v.out.id === p.id && !v.kept
      );
      return swap ? swap.in : p;
    });
    const totals = totalsOf(newLineup);

    if (totals.totalSalary > SALARY_CAP) {
      return NextResponse.json(
        {
          error:
            "The AI's suggestions went over the salary cap — try highlighting fewer slots or adding a note about budget.",
          summary: ai.summary,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      suggestions: validated,
      summary: ai.summary,
      newLineup,
      newTotals: {
        totalSalary: totals.totalSalary,
        totalAvgDK: totals.totalAvgDK,
        totalScore: totals.totalScore,
        salaryCap: SALARY_CAP,
      },
      slate,
    });
  } catch (err: any) {
    console.error("API /api/ai-swap error:", err);
    const status = err?.status === 401 ? 401 : 500;
    return NextResponse.json(
      {
        error:
          status === 401
            ? "Anthropic API key was rejected — check ANTHROPIC_API_KEY."
            : "AI suggestion failed",
        details: err?.message ?? "Unknown error",
      },
      { status }
    );
  }
}
