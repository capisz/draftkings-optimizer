// src/app/api/generate-lineup/route.ts
import { NextResponse } from "next/server";
import { getPlayerPool } from "@/lib/draftkings";
import { buildLineup } from "@/lib/optimizer";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { players, slate } = await getPlayerPool();

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
