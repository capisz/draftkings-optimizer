// src/hooks/usePlayerData.ts
import { useEffect, useState } from "react";
import { EfficientPlayer } from "@/hooks/useEfficientPlayers";
import { fetchPlayerInfo, getPlayerInfo, PlayerInfo } from "@/utils/playerData";
import { fetchRecentGames, GameStat } from "@/utils/recentStats";

export function usePlayerData(player: EfficientPlayer) {
  const [playerInfo, setPlayerInfo] = useState<PlayerInfo | undefined>();
  const [recentGames, setRecentGames] = useState<GameStat[] | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      await fetchPlayerInfo();
      const info = getPlayerInfo(player.ID.toString());
      if (mounted) setPlayerInfo(info);
    })();
    return () => { mounted = false; };
  }, [player.ID]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const games = await fetchRecentGames(player.ID);
        if (mounted) setRecentGames(games);
      } catch {
        if (mounted) setRecentGames([]);
      }
    })();
    return () => { mounted = false; };
  }, [player.ID]);

  const imageUrl = playerInfo?.image ?? "/placeholder.svg?height=70&width=70";
  return { playerData: player, playerInfo, imageUrl, recentGames };
}
