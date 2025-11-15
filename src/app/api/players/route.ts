// src/app/api/players/route.ts
import { NextResponse } from "next/server";
import { getHeadshotUrl } from "@/lib/nbaHeadshots";
import raw from "@/data/players-2025-11-14-last5.json";

const DEFAULT_HEADSHOT =
  "https://a.espncdn.com/i/headshots/nophoto.png";

type Last5Game = {
  date: string;
  opp: string;
  dk: number;
};

type PlayerJson = {
  id: string;
  name: string;
  position: string;
  team: string;
  salary: number;
  gameInfo: string;
  avgDK: number;
  efficiency: number;
  image?: string | null;
  last5?: Last5Game[];
};

type Payload = {
  count: number;
  data: PlayerJson[];
};

export async function GET() {
  const payload = raw as Payload;

  const players = (payload.data || []).map((p) => {
    const cleanName = (p.name || "").trim();

    const headshot =
      getHeadshotUrl(cleanName) ||
      p.image ||
      DEFAULT_HEADSHOT;

    return {
      ...p,
      name: cleanName,
      image: headshot,
      last5: p.last5 ?? [],
    };
  });

  return NextResponse.json({
    count: players.length,
    data: players,
  });
}
