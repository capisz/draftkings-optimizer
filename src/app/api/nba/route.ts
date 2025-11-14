import { NextResponse } from "next/server";

export async function GET() {
  console.log("🔵 /api/nba HIT");

  const url =
    "https://stats.nba.com/stats/leaguedashplayerstats?Season=2025-26&SeasonType=Regular%20Season";

  const NBA_HEADERS = {
    Host: "stats.nba.com",
    Connection: "keep-alive",
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "application/json, text/plain, */*",
    Referer: "https://www.nba.com/stats",
    "Accept-Language": "en-US,en;q=0.9",
    "x-nba-stats-token": "true",
  };

  try {
    console.log("🔵 FETCHING NBA…");

    const res = await fetch(url, { headers: NBA_HEADERS });

    console.log("🟡 STATUS:", res.status);

    const raw = await res.text();

    console.log("🟣 RAW RESPONSE PREVIEW:");
    console.log(raw.slice(0, 500)); // first 500 chars

    if (!res.ok) {
      console.log("🔴 NBA FETCH FAILED");
      return NextResponse.json(
        { error: "NBA fetch failed", status: res.status, body: raw.slice(0, 500) },
        { status: 500 }
      );
    }

    console.log("🟢 ATTEMPTING JSON PARSE…");
    const json = JSON.parse(raw);

    console.log("🟢 JSON SUCCESS");
    return NextResponse.json(json);
  } catch (err: any) {
    console.log("🔥 ROUTE CRASH:", err);
    return NextResponse.json(
      { error: "NBA Proxy Error", details: String(err) },
      { status: 500 }
    );
  }
}
