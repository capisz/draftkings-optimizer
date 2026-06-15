// src/app/api/generate-lineup/route.ts
import { NextResponse } from "next/server";
import { getPlayerPool, type Sport } from "@/lib/draftkings";
import { buildLineup } from "@/lib/optimizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const sport: Sport =
      new URL(req.url).searchParams.get("sport") === "MLB" ? "MLB" : "NBA";
    const { players, slate } = await getPlayerPool(sport);

    const result = buildLineup(players, slate);
    if (!result) {
      return NextResponse.json(
        { error: "Unable to build a valid lineup from the current slate" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ...result, slate });
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
