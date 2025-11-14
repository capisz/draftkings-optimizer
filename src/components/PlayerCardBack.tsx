// src/components/PlayerCardBack.tsx
import { GameStat } from "@/utils/recentStats";
import { EfficientPlayer } from "@/hooks/useEfficientPlayers";

interface Props {
  player: EfficientPlayer;
  color?: string;
  recentGames?: GameStat[] | null;
}

export function PlayerCardBack({ color, recentGames }: Props) {
  const have = (recentGames?.length ?? 0) > 0;
  const bgColor = color || "#191b20"; // match front card grey

  return (
    <div
      className="flex flex-col h-full w-full rounded-lg p-3"
      style={{ backgroundColor: bgColor }}
    >
      {/* Compact list area, no header */}
      <div className="flex-1 flex flex-col justify-center gap-1 overflow-hidden">
        {have ? (
          recentGames!.map((g, idx) => (
            <div
              key={idx}
              className="flex items-center justify-between text-[11px]"
            >
              <span className="text-white/75 truncate max-w-[55%]">
                {g.opponent}
              </span>
              <span className="font-semibold text-lime-400">
                {g.dkPoints} pts
              </span>
            </div>
          ))
        ) : (
          <div className="text-[11px] text-white/75 text-center mt-2">
            No recent game data available.
          </div>
        )}
      </div>

      {/* Small flip hint in theme colors */}
      <div className="mt-2 w-full text-center">
        <p className="text-[10px] text-lime-400 tracking-wide">
          Click card to flip back
        </p>
      </div>
    </div>
  );
}
