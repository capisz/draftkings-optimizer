// src/utils/recentStats.ts
export interface GameStat {
  game_id: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  turnover: number;
  dkPoints?: number;
  date?: string;
}

export async function fetchRecentGames(playerId: number): Promise<GameStat[]> {
  try {
    // ✅ Use our own proxy route instead of the public API
    const url = `/api/stats?player_id=${playerId}&per_page=5`;
    const res = await fetch(url, { cache: "no-store" });

    if (!res.ok) {
      throw new Error(`stats proxy failed: ${res.statusText}`);
    }

    const data = await res.json();
    const games = data?.data ?? [];

    // Compute DK fantasy points
    return games.map((g: any) => ({
      game_id: g.game?.id,
      pts: g.pts ?? 0,
      reb: g.reb ?? 0,
      ast: g.ast ?? 0,
      stl: g.stl ?? 0,
      blk: g.blk ?? 0,
      turnover: g.turnover ?? 0,
      date: g.game?.date ?? "",
      dkPoints: (g.pts ?? 0) + 1.25 * (g.reb ?? 0) + 1.5 * (g.ast ?? 0)
        + 2 * (g.stl ?? 0) + 2 * (g.blk ?? 0) - 0.5 * (g.turnover ?? 0),
    }));
  } catch (err) {
    console.warn(`⚠️ Stats fetch failed for player ${playerId}:`, err);
    return [];
  }
}
