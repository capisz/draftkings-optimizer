// src/utils/playerData.ts

// If you don't have path alias "@", change this import to "../data/players-2025-11-14.json"
import playersData from "@/data/players-2025-11-14.json";

export interface PlayerInfo {
  id: string;
  name: string;
  position: string;
  team: string;
  salary: number;
  gameInfo: string;
  avgDK: number;
  efficiency: number;
  image: string;
  last5: any[]; // you can make this a stricter type later
}

export interface PlayerResponse {
  count: number;
  data: PlayerInfo[];
}

let playerCache: PlayerResponse | null = null;

/**
 * Returns the DraftKings players for today's slate from the
 * JSON we generated from the CSV.
 */
export async function fetchPlayerInfo(): Promise<PlayerInfo[]> {
  if (playerCache) return playerCache.data;

  // playersData is the JSON object: { count, data: [...] }
  playerCache = playersData as PlayerResponse;

  // Sort by efficiency descending (optional)
  playerCache.data.sort((a, b) => b.efficiency - a.efficiency);

  return playerCache.data;
}
