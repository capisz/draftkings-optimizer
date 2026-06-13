// src/app/page.tsx
"use client";

import { useState, useEffect } from "react";
import LoadingOverlay from "@/components/LoadingOverlay";
import {
  useEfficientPlayers,
  EfficientPlayer,
  SlateInfo,
} from "@/hooks/useEfficientPlayers";
import { PlayerCard } from "@/components/PlayerCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Image from "next/image";

type LineupPlayer = EfficientPlayer & {
  slot: string;
  baseSalary?: number;
  baseAvgDK?: number;
};

interface LineupTotals {
  totalSalary: number;
  totalAvgDK: number;
  totalScore: number;
  salaryCap: number;
}

interface LineupResponse extends LineupTotals {
  lineup: LineupPlayer[];
  totalEfficiency: number;
  slate?: SlateInfo;
}

interface AiSuggestion {
  slot: string;
  out: LineupPlayer;
  in: LineupPlayer;
  reasoning: string;
  kept: boolean;
}

interface AiSwapResponse {
  suggestions: AiSuggestion[];
  summary: string;
  newLineup: LineupPlayer[];
  newTotals: LineupTotals;
  error?: string;
}

const PAGE_SIZE = 25;

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

const lineupKey = (p: LineupPlayer) => `${p.slot}:${p.id}`;

export default function Home() {
  const { efficientPlayers, slate, isLoading, error } = useEfficientPlayers();

  const [visibleCards, setVisibleCards] = useState(0);
  const [pageCount, setPageCount] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [position, setPosition] = useState<string | null>(null);

  const [team, setTeam] = useState<LineupPlayer[]>([]);
  const [teamMeta, setTeamMeta] = useState<LineupTotals | null>(null);

  const [teamLoading, setTeamLoading] = useState(false);
  const [teamError, setTeamError] = useState<string | null>(null);

  // AI agent state
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [aiNote, setAiNote] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AiSwapResponse | null>(null);

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
    .filter((p) => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter((p) =>
      !position ? true : p.position.split(/[\/,]/).includes(position)
    );

  const paged = filtered.slice(0, pageCount * PAGE_SIZE);
  const hasMore = filtered.length > paged.length;

  // staggered reveal animation – only animate *new* cards, don't hide old ones
  useEffect(() => {
    setVisibleCards((prev) => {
      if (prev > paged.length) return paged.length;
      return prev;
    });

    const id = setInterval(() => {
      setVisibleCards((v) => {
        if (v >= paged.length) {
          clearInterval(id);
          return v;
        }
        return v + 1;
      });
    }, 40);

    return () => clearInterval(id);
  }, [paged.length]);

  // Build a unique list of matchups from gameInfo
  const matchups = Array.from(
    new Set(
      efficientPlayers
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

    const firstTip = new Date(Math.min(...validTips.map((d) => d.getTime())));

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
        {error}
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
      setSelectedKeys([]);
      setAiResult(null);
      setAiError(null);

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

  const toggleSelected = (p: LineupPlayer) => {
    const key = lineupKey(p);
    setSelectedKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
    setAiResult(null);
    setAiError(null);
  };

  // AI SWAP API CALL
  const askAi = async () => {
    try {
      setAiLoading(true);
      setAiError(null);
      setAiResult(null);

      const res = await fetch("/api/ai-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lineup: team,
          selectedKeys,
          note: aiNote || undefined,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json?.error || "AI suggestion failed");
      }

      setAiResult(json as AiSwapResponse);
    } catch (e: any) {
      setAiError(e.message ?? "Unknown error");
    } finally {
      setAiLoading(false);
    }
  };

  const applyAiLineup = () => {
    if (!aiResult) return;
    setTeam(aiResult.newLineup);
    setTeamMeta(aiResult.newTotals);
    setSelectedKeys([]);
    setAiResult(null);
    setAiNote("");
  };

  const realSwaps = aiResult?.suggestions.filter((s) => !s.kept) ?? [];

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
        .dk-conveyor {
          scrollbar-width: thin;
          scrollbar-color: #65a30d transparent;
        }
        .dk-conveyor::-webkit-scrollbar {
          height: 6px;
        }
        .dk-conveyor::-webkit-scrollbar-thumb {
          background: #3f6212;
          border-radius: 9999px;
        }
        .dk-conveyor::-webkit-scrollbar-track {
          background: transparent;
        }
      `}</style>

      <div className="min-h-screen text-white bg-gradient-to-b from-zinc-800 via-zinc-900 to-black pb-8 relative">
        {/* FULL-SCREEN LOADING OVERLAY */}
        {teamLoading && <LoadingOverlay progress={progress} />}

        {/* APP HEADER */}
        <header className="sticky top-0 z-40 backdrop-blur-md bg-zinc-950/70 border-b border-zinc-800/80 mb-6">
          <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Image
                src="/dk-crown.png"
                alt="DraftKings Crown"
                width={28}
                height={28}
                className="opacity-90"
              />
              <h1 className="text-lg font-bold tracking-tight">
                Lineup<span className="text-lime-400">Optimizer</span>
              </h1>
            </div>
            {slate && (
              <span
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap shrink-0 ${
                  slate.source === "live"
                    ? "bg-lime-900/60 text-lime-300"
                    : "bg-amber-900/60 text-amber-300"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    slate.source === "live"
                      ? "bg-lime-400 animate-pulse"
                      : "bg-amber-400"
                  }`}
                />
                {slate.source === "live" ? "Live" : "Demo"} ·{" "}
                {slate.gameType === "showdown" ? "Showdown" : "Classic"}
              </span>
            )}
          </div>
        </header>

        {/* TODAY'S MATCHUPS HEADER – main header */}
        {matchups.length > 0 && (
          <div className="mx-auto max-w-4xl mb-4 px-4">
            <div className="bg-zinc-900/80 rounded-xl p-4 shadow-md overflow-hidden">
              <div className="flex items-start justify-between gap-4">
                {/* Left: title, countdown, conveyor chips */}
                <div className="flex-1">
                  <h2 className="text-xs font-semibold text-lime-400 mb-1 uppercase tracking-wide">
                    Today&apos;s Matchups
                  </h2>

                  {/* SLATE SOURCE */}
                  {slate && (
                    <div className="text-[10px] text-zinc-500 mb-2">
                      {slate.label}
                    </div>
                  )}

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
                          <span className="font-semibold">{m.labelTeams}</span>
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

          {teamError && <div className="text-red-400 text-sm">{teamError}</div>}
        </div>

        {/* TEAM CONVEYOR — scroll through the optimizer's picks */}
        {team.length > 0 && (
          <div className="mx-auto max-w-4xl mb-6 px-4">
            <h2 className="text-xs font-semibold text-lime-400 uppercase tracking-wide mb-2">
              Your Lineup
              <span className="ml-2 text-zinc-500 normal-case font-normal">
                swipe to view each pick · tap a card for last 5 games
              </span>
            </h2>
            <div className="dk-conveyor flex gap-4 overflow-x-auto snap-x snap-mandatory pb-3 -mx-1 px-1">
              {team.map((p) => (
                <div
                  key={`conveyor-${lineupKey(p)}`}
                  className="w-60 shrink-0 snap-start"
                >
                  <PlayerCard player={p} slot={p.slot} />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TEAM DISPLAY */}
        {team.length > 0 && (
          <div className="bg-zinc-900 rounded-xl p-6 mx-auto max-w-2xl text-center mb-6 shadow-xl">
            <div className="text-xs text-zinc-400 mb-1">
              {team.map((p) => p.slot).join(", ")} — Salary cap: $
              {salaryCap.toLocaleString()}
            </div>
            <div className="text-[11px] text-lime-300/80 mb-3">
              Tap players to highlight them, then ask the AI analyst for
              upgrades.
            </div>

            <div className="space-y-1 text-sm">
              {team.map((p) => {
                const key = lineupKey(p);
                const isSelected = selectedKeys.includes(key);
                return (
                  <div
                    key={key}
                    onClick={() => toggleSelected(p)}
                    className={`flex justify-between items-center py-1 px-2 rounded-md cursor-pointer transition-colors border ${
                      isSelected
                        ? "bg-lime-900/40 border-lime-500 text-white"
                        : "bg-transparent border-transparent border-b-zinc-700 text-gray-200 hover:bg-zinc-800/60"
                    }`}
                  >
                    <span className="text-left flex items-center gap-2">
                      <span
                        className={`h-3.5 w-3.5 rounded-sm border flex items-center justify-center text-[9px] ${
                          isSelected
                            ? "bg-lime-500 border-lime-400 text-black"
                            : "border-zinc-600"
                        }`}
                      >
                        {isSelected ? "✓" : ""}
                      </span>
                      <span>
                        <span className="font-semibold text-lime-300 mr-2">
                          {p.slot}
                        </span>
                        {p.name}{" "}
                        <span className="text-xs text-zinc-400">
                          ({p.position}, {p.team})
                        </span>
                      </span>
                    </span>

                    <span className="text-right text-xs tabular-nums">
                      <span className="text-lime-400 mr-2">
                        ${p.salary.toLocaleString()}
                      </span>
                      <span className="text-sky-400">
                        {p.avgDK.toFixed(1)} DK
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* TEAM META */}
            {teamMeta && (
              <div className="mt-4 text-sm text-zinc-200">
                <div>
                  <span className="font-semibold">Total Salary:</span> $
                  {teamMeta.totalSalary.toLocaleString()}
                </div>

                <div>
                  <span className="font-semibold">Projected DK Points:</span>{" "}
                  {teamMeta.totalAvgDK.toFixed(1)}
                </div>

                <div className="text-xs text-zinc-400 mt-1">
                  Weighted score (0.7 × last-5 form + 0.3 × value):{" "}
                  {teamMeta.totalScore.toFixed(2)}
                </div>
              </div>
            )}

            {/* AI ANALYST CONTROLS */}
            {selectedKeys.length > 0 && (
              <div className="mt-4 bg-zinc-800/70 rounded-lg p-4 text-left">
                <div className="text-xs font-semibold text-lime-300 uppercase tracking-wide mb-2">
                  AI Analyst — {selectedKeys.length} slot
                  {selectedKeys.length > 1 ? "s" : ""} highlighted
                </div>

                <Input
                  placeholder="Optional note for the AI (e.g. 'more upside', 'fade Knicks')…"
                  value={aiNote}
                  onChange={(e) => setAiNote(e.target.value)}
                  className="bg-zinc-700 text-white border border-zinc-600 focus:border-lime-500 focus:ring-lime-500 mb-3"
                />

                <Button
                  onClick={askAi}
                  disabled={aiLoading}
                  className="w-full bg-sky-600 hover:bg-sky-500 text-white font-semibold"
                >
                  {aiLoading
                    ? "Asking the AI analyst…"
                    : "✨ Suggest better picks"}
                </Button>

                {aiError && (
                  <div className="text-red-400 text-xs mt-2">{aiError}</div>
                )}
              </div>
            )}

            {/* AI SUGGESTIONS */}
            {aiResult && (
              <div className="mt-4 bg-zinc-800/70 rounded-lg p-4 text-left">
                <div className="text-xs font-semibold text-sky-300 uppercase tracking-wide mb-2">
                  AI Suggestions
                </div>

                <p className="text-xs text-zinc-300 mb-3">{aiResult.summary}</p>

                <div className="space-y-3">
                  {aiResult.suggestions.map((s, i) => (
                    <div
                      key={`${s.slot}-${i}`}
                      className="bg-zinc-900/70 rounded-md p-3"
                    >
                      <div className="flex items-center justify-between text-sm">
                        <span>
                          <span className="font-semibold text-lime-300 mr-2">
                            {s.slot}
                          </span>
                          {s.kept ? (
                            <span className="text-zinc-300">
                              Keep {s.out.name}
                            </span>
                          ) : (
                            <span>
                              <span className="text-zinc-400 line-through mr-1">
                                {s.out.name}
                              </span>
                              <span className="text-zinc-500 mx-1">→</span>
                              <span className="text-white font-semibold">
                                {s.in.name}
                              </span>
                            </span>
                          )}
                        </span>
                        {!s.kept && (
                          <span className="text-xs text-right">
                            <span
                              className={
                                s.in.salary - s.out.salary > 0
                                  ? "text-red-400"
                                  : "text-lime-400"
                              }
                            >
                              {s.in.salary - s.out.salary >= 0 ? "+" : "−"}$
                              {Math.abs(
                                s.in.salary - s.out.salary
                              ).toLocaleString()}
                            </span>{" "}
                            <span className="text-sky-400">
                              {(s.in.avgDK - s.out.avgDK >= 0 ? "+" : "") +
                                (s.in.avgDK - s.out.avgDK).toFixed(1)}{" "}
                              DK
                            </span>
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-zinc-400 mt-1">
                        {s.reasoning}
                      </p>
                    </div>
                  ))}
                </div>

                {realSwaps.length > 0 ? (
                  <div className="mt-3 flex items-center justify-between">
                    <div className="text-[11px] text-zinc-400">
                      New total: $
                      {aiResult.newTotals.totalSalary.toLocaleString()} ·{" "}
                      {aiResult.newTotals.totalAvgDK.toFixed(1)} DK pts
                    </div>
                    <Button
                      onClick={applyAiLineup}
                      className="bg-lime-600 hover:bg-lime-500 text-black font-semibold"
                    >
                      Apply {realSwaps.length} swap
                      {realSwaps.length > 1 ? "s" : ""}
                    </Button>
                  </div>
                ) : (
                  <div className="mt-3 text-[11px] text-zinc-400">
                    The AI thinks your highlighted picks are already the best
                    options.
                  </div>
                )}
              </div>
            )}

            <Button
              onClick={() => {
                setTeam([]);
                setTeamMeta(null);
                setSelectedKeys([]);
                setAiResult(null);
                setAiError(null);
              }}
              className="mt-4 bg-zinc-700 hover:bg-zinc-600"
            >
              Clear
            </Button>
          </div>
        )}

        {/* POSITION FILTER + SEARCH */}
        <div className="flex flex-col items-center mb-6 px-4">
          <div className="bg-zinc-900/80 border border-lime-600/30 rounded-xl px-4 py-3 text-center shadow-md w-full max-w-md">
            <h2 className="text-xs font-semibold text-lime-400 uppercase tracking-wide mb-3">
              Filter Players
            </h2>

            <div className="flex flex-wrap justify-center gap-2 mb-3">
              {["PG", "SG", "SF", "PF", "C"].map((pos) => (
                <Button
                  key={pos}
                  onClick={() => setPosition(position === pos ? null : pos)}
                  className={`px-4 py-2 rounded-full text-sm border transition-colors ${
                    position === pos
                      ? "bg-lime-500 border-lime-300 text-black font-semibold hover:bg-lime-400"
                      : "bg-zinc-800 border-zinc-700 text-white hover:border-lime-600/50 hover:bg-zinc-700"
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
                className="bg-zinc-800 text-white border border-zinc-700 rounded-full px-4 focus:border-lime-500 focus:ring-lime-500"
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
            {paged.map((p, i) => (
              <PlayerCard key={p.id} player={p} isVisible={i < visibleCards} />
            ))}
          </div>

          {/* LOAD MORE */}
          {hasMore && (
            <div className="flex justify-center mt-8">
              <Button
                onClick={() => setPageCount((c) => c + 1)}
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
