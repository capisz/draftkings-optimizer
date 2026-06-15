// src/app/api/players/route.ts
import { NextResponse } from "next/server";
import { getPlayerPool, type Sport } from "@/lib/draftkings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type { PoolPlayer as PlayerOut, Last5Game } from "@/lib/draftkings";

const DEFAULT_HEADSHOT =
  "https://upload.wikimedia.org/wikipedia/commons/5/59/User-avatar.svg";

function parseSport(req: Request): Sport {
  const s = new URL(req.url).searchParams.get("sport");
  return s === "MLB" ? "MLB" : "NBA";
}

export async function GET(req: Request) {
  const { players, slate } = await getPlayerPool(parseSport(req));

  const data = players.map((p) => ({
    ...p,
    image: p.image || DEFAULT_HEADSHOT,
  }));

  return NextResponse.json({
    count: data.length,
    data,
    slate,
  });
}
