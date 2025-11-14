import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const NBA_URL =
  "https://data.nba.com/data/v2015/json/mobile_teams/nba/2024/players/00_player_list.json";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  Accept: "application/json",
  Referer: "https://www.nba.com/"
};

export async function GET() {
  try {
    const res = await fetch(NBA_URL, { headers: HEADERS });

    if (!res.ok) {
      return NextResponse.json(
        { error: "NBA fetch failed", status: res.status },
        { status: 500 }
      );
    }

    const json = await res.json();

    // IMPORTANT: this endpoint returns a nested structure
    // json.pl looks like: { pl: [ { fn, ln, pid }, ... ] }
    // but sometimes they use json.players
    const players = json?.pl || json?.players;

    if (!players) {
      return NextResponse.json(
        { error: "Unexpected NBA structure", data: json },
        { status: 500 }
      );
    }

    return NextResponse.json({ players });
  } catch (err: any) {
    return NextResponse.json(
      { error: "NBA error", details: err.message },
      { status: 500 }
    );
  }
}
