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
  // optional roster slot badge (used in the team conveyor)
  slot?: string;
  // replace mode: clicking the card selects it instead of flipping
  onSelect?: () => void;
  selectLabel?: string;
}

export function ValueChip({ delta }: { delta: number | null | undefined }) {
  if (delta === null || delta === undefined) return null;

  const hot = delta >= 3;
  const cold = delta <= -3;
  const label = `${delta > 0 ? "▲ +" : delta < 0 ? "▼ −" : "•"}${Math.abs(delta).toFixed(1)} vs price`;

  return (
    <span
      title="Last-5-game DK average minus season FPPG (DraftKings' pricing basis)"
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tabular-nums ${
        hot
          ? "bg-lime-900/60 text-lime-300"
          : cold
            ? "bg-red-900/50 text-red-300"
            : "bg-zinc-800 text-zinc-400"
      }`}
    >
      {label}
    </span>
  );
}

export function PlayerCard({
  player,
  slot,
  onSelect,
  selectLabel,
}: PlayerCardProps) {
  const [showBack, setShowBack] = useState(false);

  const handleToggle = () => {
    if (onSelect) {
      onSelect();
      return;
    }
    setShowBack((prev) => !prev);
  };

  // Map API last5 -> GameStat shape expected by PlayerCardBack
  const recentGames: GameStat[] | null =
    player.last5 && player.last5.length > 0
      ? player.last5.map((g) => ({
          opponent: `${g.opp}${g.min ? ` · ${Math.round(g.min)}m` : ""}`,
          dkPoints: g.dk,
        }))
      : null;

  const src = player.image || FALLBACK_AVATAR;
  const status =
    player.status && player.status !== "None" ? player.status : null;

  return (
    <div
      className={`group dk-card isolate h-80 rounded-3xl bg-[#191b20] p-4 pt-5 flex flex-col justify-between cursor-pointer border shadow-lg shadow-black/40 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-lime-900/30 relative overflow-hidden ${
        onSelect
          ? "border-sky-500/60 hover:border-sky-400 ring-1 ring-sky-500/30"
          : "border-zinc-800/80 hover:border-lime-500/60"
      }`}
      onClick={handleToggle}
    >
      {/* green accent header bar — flows / comes alive on hover */}
      <div className="dk-card-accent pointer-events-none absolute inset-x-0 top-0 h-1.5" />
      {/* soft green sheen that fades in on hover */}
      <div className="dk-card-sheen pointer-events-none absolute inset-0 -z-10" />

      {onSelect && (
        <span className="absolute top-2 right-3 px-2 py-0.5 rounded-full bg-sky-600 text-white text-[9px] font-bold uppercase tracking-wide">
          {selectLabel ?? "Tap to add"}
        </span>
      )}
      {/* HEADER */}
      <div className="flex items-center gap-4 mb-3">
        <div className="relative shrink-0">
          <div className="h-16 w-16 rounded-full border-2 border-lime-400 bg-neutral-900 flex items-center justify-center overflow-hidden">
            <img
              src={src}
              alt={player.name}
              className="h-full w-full object-cover"
            />
          </div>
          {slot && (
            <span className="absolute -bottom-1 -right-1 px-1.5 py-0.5 rounded-md bg-lime-500 text-black text-[9px] font-bold">
              {slot}
            </span>
          )}
        </div>
        <div className="flex flex-col min-w-0">
          <span className="font-semibold text-white leading-tight truncate">
            {player.name}
          </span>
          <span className="text-sm text-neutral-400">
            {player.team} · {player.position}
            {status && (
              <span className="ml-2 px-1.5 py-0.5 rounded bg-amber-900/60 text-amber-300 text-[9px] font-semibold uppercase align-middle">
                {status}
              </span>
            )}
          </span>
          <span className="text-xs text-neutral-500 truncate">
            {player.gameInfo}
          </span>
        </div>
      </div>

      {/* VALUE + RELIABILITY SIGNALS */}
      <div className="mb-1 flex flex-wrap gap-1.5">
        <ValueChip delta={player.valueDelta} />
        {player.tentative && (
          <span
            title={player.tentativeReason ?? "Unreliable recent usage"}
            className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-900/50 text-amber-300"
          >
            ⚠ Tentative
            {player.tentativeReason ? ` — ${player.tentativeReason}` : ""}
          </span>
        )}
      </div>

      {/* BODY: SUMMARY vs LAST-5 */}
      {!showBack ? (
        // FRONT / SUMMARY VIEW
        <>
          <div className="flex justify-between text-sm text-neutral-200 mt-1 flex-1">
            <div className="space-y-2">
              <div>
                <span className="text-xs text-neutral-400">Salary</span>
                <div className="font-semibold text-lime-400 tabular-nums">
                  ${player.salary.toLocaleString()}
                </div>
              </div>
              <div>
                <span className="text-xs text-neutral-400">Season FPPG</span>
                <div className="font-semibold tabular-nums">
                  {(player.fppg ?? player.avgDK).toFixed(1)}
                </div>
              </div>
            </div>

            <div className="space-y-2 text-right">
              <div>
                <span className="text-xs text-neutral-400">
                  {player.last5?.length >= 2 ? "Last-5 Form" : "Avg DKFP"}
                </span>
                <div className="font-semibold text-sky-400 tabular-nums">
                  {player.avgDK.toFixed(1)}
                </div>
              </div>
              <div>
                <span className="text-xs text-neutral-400">Value / $1K</span>
                <div className="font-semibold tabular-nums">
                  {player.efficiency.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 text-[10px] text-neutral-600 text-center">
            Click to flip for last 5 games
          </div>
        </>
      ) : (
        // BACK VIEW
        <PlayerCardBack player={player} recentGames={recentGames} />
      )}
    </div>
  );
}
