// src/app/page.tsx
"use client";

import { useState, useEffect } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import {
  useEfficientPlayers,
  EfficientPlayer,
} from "@/hooks/useEfficientPlayers";
import { PlayerCard } from "@/components/PlayerCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Image from "next/image";

type LineupPlayer = EfficientPlayer & { slot: string };

interface LineupResponse {
  lineup: LineupPlayer[];
  totalSalary: number;
  totalAvgDK: number;
  totalEfficiency: number;
  totalScore: number;
  salaryCap: number;
}

// Robust parse for strings like "LAL@NOP 11/14/2025 08:00PM ET"
function parseGameInfoToDate(gi: string): Date | null {
  const parts = gi.split(" ");
  if (parts.length < 3) return null;

  const dateStr = parts[1]; // "11/14/2025"
  const timeStr = parts[2]; // "08:00PM"

  const [monthStr, dayStr, yearStr] = dateStr.split("/");
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);
  if (!month || !day || !year) return null;

  const m = timeStr.match(/^(\d{1,2}):(\d{2})(AM|PM)$/i);
  if (!m) return null;

  const [, hourStr, minuteStr, ampmRaw] = m;
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const ampm = ampmRaw.toUpperCase();

  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;

  const d = new Date(year, month - 1, day, hour, minute);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export default function Home() {
  const {
    efficientPlayers,
    allPlayers,
    isLoading,
    error,
    hasMore,
    loadMore,
  } = useEfficientPlayers(25);

  const [visibleCards, setVisibleCards] = useState(0);
  const [searchTerm, setSearchTerm] = useState("");
  const [position, setPosition] = useState<string | null>(null);

  const [team, setTeam] = useState<LineupPlayer[]>([]);
  const [teamMeta, setTeamMeta] = useState<{
    totalSalary: number;
    totalAvgDK: number;
    totalScore: number;
    salaryCap: number;
  } | null>(null);

  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  // progress bar state
  const [progress, setProgress] = useState(0);

  // countdown until first tip-off
  const [countdown, setCountdown] = useState<string | null>(null);

  // animate progress bar while generating team
  useEffect(() => {
    if (!teamLoading) {
      setProgress(0);
      return;
    }

    let pct = 0;
    const id = setInterval(() => {
      pct += Math.random() * 15;
      if (pct >= 95) pct = 95;
      setProgress(pct);
    }, 200);

    return () => clearInterval(id);
  }, [teamLoading]);

  // FILTERED LIST
  const filtered = efficientPlayers
    .filter((p) =>
      p.name.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .filter((p) =>
      !position ? true : p.position.split(/[\/,]/).includes(position)
    );

  // staggered reveal animation – only animate *new* cards, don't hide old ones
  useEffect(() => {
    setVisibleCards((prev) => {
      if (prev > filtered.length) return filtered.length;
      return prev;
    });

    const id = setInterval(() => {
      setVisibleCards((v) => {
        if (v >= filtered.length) {
          clearInterval(id);
          return v;
        }
        return v + 1;
      });
    }, 40);

    return () => clearInterval(id);
  }, [filtered.length, filtered]);

  // Build a unique list of matchups from gameInfo
  const gameSource =
    (Array.isArray(allPlayers) && allPlayers.length > 0
      ? allPlayers
      : efficientPlayers) || [];

  const matchups = Array.from(
    new Set(
      gameSource
        .map((p) => p.gameInfo || "")
        .filter((gi) => gi && gi.trim().length > 0)
    )
  ).map((gi) => {
    const parts = gi.split(" ");
    const teamsPart = parts[0] ?? "";
    const datePart = parts[1] ?? "";
    const timeToken = parts[2] ?? "";

    const [away, home] = teamsPart.split("@");
    const labelTeams =
      away && home ? `${away} @ ${home}` : teamsPart || "Matchup";

    const timeLabel = timeToken.replace("ET", "").trim();
    const tipoff = parseGameInfoToDate(gi);

    return {
      key: gi,
      labelTeams,
      date: datePart,
      time: timeLabel,
      raw: gi,
      tipoff,
    };
  });

  // Countdown effect: time until earliest tip-off
  useEffect(() => {
    if (!matchups.length) {
      setCountdown(null);
      return;
    }

    const validTips = matchups
      .map((m) => m.tipoff)
      .filter((d): d is Date => !!d);

    if (!validTips.length) {
      setCountdown(null);
      return;
    }

    const firstTip = new Date(
      Math.min(...validTips.map((d) => d.getTime()))
    );

    const update = () => {
      const now = new Date();
      const diff = firstTip.getTime() - now.getTime();

      if (diff <= 0) {
        setCountdown("Tip-off started");
        return;
      }

      const totalSeconds = Math.floor(diff / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const pad = (n: number) => n.toString().padStart(2, "0");

      setCountdown(`${pad(hours)}:${pad(minutes)}:${pad(seconds)}`);
    };

    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [matchups.length]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-white">
        Loading players…
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black text-red-400">
        {error.message}
      </div>
    );
  }

  const salaryCap = teamMeta?.salaryCap ?? 50000;

  // TEAM GENERATION API CALL
  const generateTeam = async () => {
    try {
      setTeamLoading(true);
      setTeamMeta(null);
      setTeam([]);
      setTeamError(null);

      const res = await fetch("/api/generate-lineup", {
        cache: "no-store",
      });

      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || "Failed to generate lineup");
      }

      setProgress(100);

      const json: LineupResponse = await res.json();
      setTeam(json.lineup);
      setTeamMeta({
        totalSalary: json.totalSalary,
        totalAvgDK: json.totalAvgDK,
        totalScore: json.totalScore,
        salaryCap: json.salaryCap,
      });
    } catch (e: any) {
      setTeamError(e.message ?? "Unknown error");
    } finally {
      setTimeout(() => setTeamLoading(false), 400);
    }
  };

  return (
    <>
      <style jsx global>{`
        @keyframes dk-marquee {
          0% {
            transform: translateX(0);
          }
          100% {
            transform: translateX(-50%);
          }
        }
        .dk-marquee-track {
          display: inline-flex;
          align-items: center;
          white-space: nowrap;
          animation: dk-marquee 30s linear infinite;
          will-change: transform;
        }
      `}</style>

      <div className="min-h-screen text-white bg-gradient-to-b from-zinc-800 via-zinc-900 to-black py-8 relative">
        {/* FULL-SCREEN LOADING OVERLAY */}
        {teamLoading && <LoadingOverlay progress={progress} />}

        {/* TODAY'S MATCHUPS HEADER – main header */}
        {matchups.length > 0 && (
          <div className="mx-auto max-w-4xl mb-4 px-4">
            <div className="bg-zinc-900/80 rounded-xl p-4 shadow-md">
              <div className="flex items-start justify-between gap-4">
                {/* Left: title, countdown, conveyor chips */}
                <div className="flex-1">
                  <h2 className="text-xs font-semibold text-lime-400 mb-1 uppercase tracking-wide">
                    Today&apos;s Matchups
                  </h2>

                  {countdown && (
                    <div className="text-[11px] text-zinc-300 mb-2">
                      First tip in{" "}
                      <span className="font-semibold text-lime-400">
                        {countdown}
                      </span>
                    </div>
                  )}

                  <div className="relative mt-1 overflow-hidden">
                    <div className="dk-marquee-track">
                      {[...matchups, ...matchups].map((m, idx) => (
                        <div
                          key={`${m.key}-${idx}`}
                          className="px-3 py-1.5 rounded-full bg-zinc-800 text-[11px] text-zinc-200 flex items-center gap-2 mr-2"
                        >
                          <span className="font-semibold">
                            {m.labelTeams}
                          </span>
                          {m.time && (
                            <span className="text-[10px] text-zinc-400">
                              {m.time}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Right: DK crown (badge) */}
                <div className="flex items-center">
                  <div className="h-12 w-12 rounded-full bg-zinc-800/70 flex items-center justify-center overflow-hidden">
                    <Image
                      src="/dk-crown.png"
                      alt="DraftKings Crown"
                      width={40}
                      height={40}
                      className="opacity-90"
                    />
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TEAM GENERATOR – now under header */}
        <div className="flex flex-col items-center mb-6 px-4 space-y-4">
          <Button
            onClick={generateTeam}
            disabled={teamLoading}
            className="inline-flex items-center justify-center gap-2 rounded-full bg-lime-600 px-6 py-2 text-sm font-semibold text-black shadow-md transition-all duration-150 hover:bg-lime-500 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:scale-100"
          >
            {teamLoading ? "Optimizing lineup…" : "Generate Team"}
          </Button>

          {teamError && (
            <div className="text-red-400 text-sm">{teamError}</div>
          )}
        </div>

        {/* TEAM DISPLAY */}
        {team.length > 0 && (
          <div className="bg-zinc-900 rounded-xl p-6 mx-auto max-w-2xl text-center mb-6 shadow-xl">
            <div className="text-xs text-zinc-400 mb-2">
              PG, SG, SF, PF, C, G, F, UTIL — Salary cap: $
              {salaryCap.toLocaleString()}
            </div>

            <div className="space-y-1 text-sm">
              {team.map((p) => (
                <div
                  key={`${p.slot}-${p.id}`}
                  className="flex justify-between items-center text-gray-200 border-b border-zinc-700 py-1"
                >
                  <span className="text-left">
                    <span className="font-semibold text-lime-300 mr-2">
                      {p.slot}
                    </span>
                    {p.name}{" "}
                    <span className="text-xs text-zinc-400">
                      ({p.position}, {p.team})
                    </span>
                  </span>

                  <span className="text-right text-xs">
                    <span className="text-lime-400 mr-2">
                      ${p.salary.toLocaleString()}
                    </span>
                    <span className="text-sky-400">
                      {p.avgDK.toFixed(1)} DK
                    </span>
                  </span>
                </div>
              ))}
            </div>

            {/* TEAM META */}
            {teamMeta && (
              <div className="mt-4 text-sm text-zinc-200">
                <div>
                  <span className="font-semibold">Total Salary:</span>{" "}
                  ${teamMeta.totalSalary.toLocaleString()}
                </div>

                <div>
                  <span className="font-semibold">
                    Projected DK Points:
                  </span>{" "}
                  {teamMeta.totalAvgDK.toFixed(1)}
                </div>

                <div className="text-xs text-zinc-400 mt-1">
                  Weighted score (0.7 × DK + 0.3 × value):{" "}
                  {teamMeta.totalScore.toFixed(2)}
                </div>
              </div>
            )}

            <Button
              onClick={() => {
                setTeam([]);
                setTeamMeta(null);
              }}
              className="mt-4 bg-zinc-700 hover:bg-zinc-600"
            >
              Clear
            </Button>
          </div>
        )}

        {/* POSITION FILTER + SEARCH */}
        <div className="flex flex-col items-center mb-6 px-4">
          <div className="bg-lime-700 rounded-lg px-4 py-3 text-center shadow-md w-full max-w-md">
            <h2 className="text-lg font-semibold mb-2">
              Filter Players
            </h2>

            <div className="flex flex-wrap justify-center gap-2 mb-3">
              {["PG", "SG", "SF", "PF", "C"].map((pos) => (
                <Button
                  key={pos}
                  onClick={() =>
                    setPosition(position === pos ? null : pos)
                  }
                  className={`px-4 py-2 text-white border ${
                    position === pos
                      ? "bg-lime-500 border-lime-300"
                      : "bg-zinc-800 border-zinc-600"
                  }`}
                >
                  {pos}
                </Button>
              ))}
            </div>

            {/* SEARCH */}
            <div className="mt-2 w-full max-w-md mx-auto">
              <Input
                placeholder="Search players..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="bg-zinc-700 text-white border border-zinc-600 focus:border-lime-500 focus:ring-lime-500"
              />
            </div>
          </div>
        </div>

        {/* BLUR GRID WHEN LOADING */}
        <div
          className={`transition-all duration-300 ${
            teamLoading ? "blur-sm opacity-40" : "blur-0 opacity-100"
          }`}
        >
          {/* PLAYER GRID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 px-6">
            {filtered.map((p, i) => (
              <PlayerCard
                key={p.id}
                player={p}
                isVisible={i < visibleCards}
              />
            ))}
          </div>

          {/* LOAD MORE */}
          {hasMore && (
            <div className="flex justify-center mt-8">
              <Button
                onClick={loadMore}
                className="bg-zinc-800 border border-lime-500 hover:bg-zinc-700"
              >
                Load More
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
