// src/utils/playerData.ts

import playersData from "@/data/players-2025-11-14.json";

export interface Player {
  id: string;
  name: string;
  position: string;
  team: string;
  salary: number;
  gameInfo: string;
  avgDK: number;
  efficiency: number;
  image: string;
  last5: number[];
}

export interface PlayerResponse {
  count: number;
  data: Player[];
}

export async function getPlayers(): Promise<PlayerResponse> {
  // If you ever want to transform/merge data, do it here
  return playersData as PlayerResponse;
}
