// src/app/api/players/route.ts
import { NextResponse } from "next/server";
import playersData from "@/data/players-2025-11-14-last5.json"; // 👈 note -last5
import { getHeadshotUrl } from "@/lib/nbaHeadshots";

export interface PlayerOut {
  id: string;
  name: string;
  position: string;
  team: string;
  salary: number;
  gameInfo: string;
  avgDK: number;
  efficiency: number;
  image: string;
  last5: { opp: string; dk: number }[];
}

export async function GET() {
  try {
    const players: PlayerOut[] = (playersData as any).data.map((p: any) => ({
      ...p,
      image: getHeadshotUrl(p.name),
      last5: p.last5 ?? [],
    }));

    players.sort((a, b) => b.efficiency - a.efficiency);

    return NextResponse.json({
      count: players.length,
      data: players,
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: "API failed", details: e.message },
      { status: 500 }
    );
  }
}
