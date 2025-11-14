// src/components/PlayerCard.tsx
"use client";

import React, { useState } from "react";
import type { EfficientPlayer } from "@/hooks/useEfficientPlayers";
import { PlayerCardBack } from "./PlayerCardBack";
import type { GameStat } from "@/utils/recentStats";

const FALLBACK_AVATAR =
  "https://upload.wikimedia.org/wikipedia/commons/5/59/User-avatar.svg";

interface PlayerCardProps {
  player: EfficientPlayer;
  // page.tsx can still pass isVisible, we just don't need it right now
  isVisible?: boolean;
}

export function PlayerCard({ player }: PlayerCardProps) {
  const [showBack, setShowBack] = useState(false);

  const handleToggle = () => setShowBack((prev) => !prev);

  // Map API last5 -> GameStat shape expected by PlayerCardBack
  const recentGames: GameStat[] | null =
    player.last5 && player.last5.length > 0
      ? player.last5.map((g) => ({
          opponent: g.opp,
          dkPoints: g.dk,
        }))
      : null;

  const src = player.image || FALLBACK_AVATAR;

  return (
    <div
      className="h-80 rounded-3xl bg-[#191b20] p-4 flex flex-col justify-between cursor-pointer transition-transform duration-200 hover:-translate-y-1"
      onClick={handleToggle}
    >
      {/* HEADER */}
      <div className="flex items-center gap-4 mb-4">
        <div className="h-16 w-16 rounded-full border-2 border-lime-400 bg-neutral-900 flex items-center justify-center overflow-hidden shrink-0">
          <img
            src={src}
            alt={player.name}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex flex-col">
          <span className="font-semibold text-white leading-tight">
            {player.name}
          </span>
          <span className="text-sm text-neutral-400">
            {player.team} · {player.position}
          </span>
          <span className="text-xs text-neutral-500">
            {player.gameInfo}
          </span>
        </div>
      </div>

      {/* BODY: SUMMARY vs LAST-5 */}
      {!showBack ? (
        // FRONT / SUMMARY VIEW
        <>
          <div className="flex justify-between text-sm text-neutral-200 mt-2 flex-1">
            <div className="space-y-2">
              <div>
                <span className="text-xs text-neutral-400">Salary</span>
                <div className="font-semibold text-lime-400">
                  ${player.salary.toLocaleString()}
                </div>
              </div>
              <div>
                <span className="text-xs text-neutral-400">Efficiency</span>
                <div className="font-semibold">
                  {player.efficiency.toFixed(2)}
                </div>
              </div>
            </div>

            <div className="space-y-2 text-right">
              <div>
                <span className="text-xs text-neutral-400">Avg DKFP</span>
                <div className="font-semibold text-sky-400">
                  {player.avgDK.toFixed(1)}
                </div>
              </div>
              <div className="text-xs text-neutral-500 mt-4">
                Click to flip for last 5 games
              </div>
            </div>
          </div>

          <div className="mt-4 text-[10px] text-neutral-600 text-center">
            Contest-only · Live salaries from DraftKings CSV
          </div>
        </>
      ) : (
        // BACK VIEW
       <PlayerCardBack
  color="#191b20"   // grey, matches app theme
  player={player}
  recentGames={recentGames}
      />
      )}
    </div>
  );
}
