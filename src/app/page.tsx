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

// DraftKings slot eligibility (mirrors the server-side optimizer)
function canPlaySlot(posStr: string, slot: string): boolean {
  const parts = (posStr || "")
    .split(/[\/,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (slot === "UTIL" || slot === "CPT") return parts.length > 0;
  if (slot === "G") return parts.includes("PG") || parts.includes("SG");
  if (slot === "F") return parts.includes("SF") || parts.includes("PF");
  return parts.includes(slot);
}

// Cost/points of a player in a given slot (CPT runs at 1.5x)
function toSlotPlayer(p: EfficientPlayer, slot: string): LineupPlayer {
  const isCpt = slot === "CPT";
  return {
    ...p,
    slot,
    baseSalary: p.salary,
    baseAvgDK: p.avgDK,
    salary: isCpt ? Math.round(p.salary * 1.5) : p.salary,
    avgDK: isCpt ? Number((p.avgDK * 1.5).toFixed(2)) : p.avgDK,
  };
}

function slotCost(p: EfficientPlayer, slot: string): number {
  return slot === "CPT" ? Math.round(p.salary * 1.5) : p.salary;
}

function lineupTotals(lineup: LineupPlayer[], salaryCap: number): LineupTotals {
  return {
    totalSalary: lineup.reduce((s, p) => s + p.salary, 0),
    totalAvgDK: lineup.reduce((s, p) => s + p.avgDK, 0),
    totalScore: lineup.reduce(
      (s, p) => s + p.avgDK * 0.7 + p.efficiency * 0.3,
      0
    ),
    salaryCap,
  };
}

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

  // manual replace mode: which lineup spot is being replaced
  const [replaceTarget, setReplaceTarget] = useState<LineupPlayer | null>(null);

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

  // Budget available for the slot being replaced (rest of lineup is locked)
  const currentSalary = team.reduce((s, p) => s + p.salary, 0);
  const replaceBudget = replaceTarget
    ? (teamMeta?.salaryCap ?? 50000) - (currentSalary - replaceTarget.salary)
    : null;

  // FILTERED LIST
  const filtered = efficientPlayers
    .filter((p) => p.name.toLowerCase().includes(searchTerm.toLowerCase()))
    .filter((p) =>
      !position ? true : p.position.split(/[\/,]/).includes(position)
    )
    // replace mode: only slot-eligible, cap-fitting players not already rostered
    .filter((p) => {
      if (!replaceTarget) return true;
      if (team.some((t) => t.id === p.id && t.id !== replaceTarget.id))
        return false;
      if (p.id === replaceTarget.id) return false;
      if (!canPlaySlot(p.position, replaceTarget.slot)) return false;
      return slotCost(p, replaceTarget.slot) <= (replaceBudget ?? 0);
    });

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

  // Roster slots for the current slate
  const slots =
    slate?.gameType === "showdown"
      ? ["CPT", "UTIL", "UTIL", "UTIL", "UTIL", "UTIL"]
      : ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"];

  // ----- MANUAL BUILD -----
  const startManualBuild = () => {
    const empty: LineupPlayer[] = slots.map((slot) => ({
      // placeholder rows carry an empty id; filled when a player is chosen
      id: "",
      slot,
      name: "",
      position: "",
      team: "",
      salary: 0,
      fppg: 0,
      avgDK: 0,
      efficiency: 0,
      valueDelta: null,
      tentative: false,
      tentativeReason: null,
      image: null,
      gameInfo: "",
      status: "",
      last5: [],
      baseSalary: 0,
      baseAvgDK: 0,
    }));
    setTeam(empty);
    setTeamMeta({
      totalSalary: 0,
      totalAvgDK: 0,
      totalScore: 0,
      salaryCap: 50000,
    });
    setSelectedKeys([]);
    setAiResult(null);
    setAiError(null);
    setReplaceTarget(null);
  };

  // ----- REPLACE / ADD A PLAYER FROM THE GRID -----
  const commitPlayerToSlot = (incoming: EfficientPlayer, target: LineupPlayer) => {
    const cap = teamMeta?.salaryCap ?? 50000;
    const placed = toSlotPlayer(incoming, target.slot);
    const isEmpty = !target.id;

    // budget check (rest of lineup is locked)
    const others = team.filter((p) => p !== target);
    const othersSalary = others.reduce((s, p) => s + p.salary, 0);
    if (othersSalary + placed.salary > cap) return false;

    const next = team.map((p) => (p === target ? placed : p));
    setTeam(next);
    setTeamMeta(lineupTotals(next, cap));
    return true;
  };

  // user clicked a grid card while in replace mode
  const handleGridSelect = (incoming: EfficientPlayer) => {
    if (!replaceTarget) return;
    const ok = commitPlayerToSlot(incoming, replaceTarget);
    if (ok) {
      setReplaceTarget(null);
      setAiResult(null);
    }
  };

  // ----- AI PICKS A REPLACEMENT FOR ONE SLOT -----
  const aiReplaceSlot = async (p: LineupPlayer) => {
    setSelectedKeys([lineupKey(p)]);
    setReplaceTarget(null);
    setAiNote("");
    // give React a tick to commit selection, then run
    setAiLoading(true);
    setAiError(null);
    setAiResult(null);
    try {
      const res = await fetch("/api/ai-swap", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineup: team, selectedKeys: [lineupKey(p)] }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "AI suggestion failed");
      setAiResult(json as AiSwapResponse);
    } catch (e: any) {
      setAiError(e.message ?? "Unknown error");
    } finally {
      setAiLoading(false);
    }
  };

  const filledTeam = team.filter((p) => p.id);

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

        /* Auto-scrolling team conveyor (left -> right, cyclic) */
        @keyframes dk-conveyor-scroll {
          0% {
            transform: translateX(-50%);
          }
          100% {
            transform: translateX(0);
          }
        }
        .dk-conveyor-viewport {
          overflow: hidden;
          /* room so hover lift isn't clipped at the top */
          padding-top: 10px;
        }
        .dk-conveyor-track {
          display: flex;
          gap: 1rem;
          width: max-content;
          animation: dk-conveyor-scroll 40s linear infinite;
          will-change: transform;
        }
        .dk-conveyor-viewport:hover .dk-conveyor-track {
          animation-play-state: paused;
        }
        @media (prefers-reduced-motion: reduce) {
          .dk-conveyor-track {
            animation: none;
          }
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
        <div className="flex flex-col items-center mb-6 px-4 space-y-3">
          <div className="flex items-center gap-3">
            <Button
              onClick={generateTeam}
              disabled={teamLoading}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-lime-600 px-6 py-2 text-sm font-semibold text-black shadow-md transition-all duration-150 hover:bg-lime-500 hover:-translate-y-0.5 active:translate-y-0 active:scale-95 disabled:opacity-60 disabled:hover:translate-y-0 disabled:hover:scale-100"
            >
              {teamLoading ? "Optimizing lineup…" : "Generate Team"}
            </Button>

            <Button
              onClick={startManualBuild}
              disabled={teamLoading}
              className="inline-flex items-center justify-center rounded-full bg-zinc-800 border border-lime-600/40 px-5 py-2 text-sm font-semibold text-lime-300 shadow-md transition-all duration-150 hover:bg-zinc-700 hover:-translate-y-0.5 active:translate-y-0 active:scale-95"
            >
              Build Manually
            </Button>
          </div>

          {teamError && <div className="text-red-400 text-sm">{teamError}</div>}
        </div>

        {/* TEAM WORKSPACE — carousel + lineup list side by side on desktop */}
        {team.length > 0 && (
        <div className="mx-auto max-w-6xl mb-6 px-4 flex flex-col lg:flex-row gap-6 items-start">
        {/* TEAM CONVEYOR — auto-scrolls the optimizer's picks, pauses on hover */}
        {filledTeam.length > 0 && (
          <div className="w-full lg:flex-1 lg:min-w-0 order-2 lg:order-1">
            <h2 className="text-xs font-semibold text-lime-400 uppercase tracking-wide mb-2">
              Your Lineup
              <span className="ml-2 text-zinc-500 normal-case font-normal">
                auto-scrolling · hover to pause · tap a card for last 5 games
              </span>
            </h2>
            <div className="dk-conveyor-viewport">
              <div className="dk-conveyor-track">
                {/* duplicate the cards so the loop is seamless */}
                {[...filledTeam, ...filledTeam].map((p, i) => (
                  <div
                    key={`conveyor-${lineupKey(p)}-${i}`}
                    className="w-60 shrink-0"
                  >
                    <PlayerCard player={p} slot={p.slot} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* TEAM DISPLAY (lineup list) */}
          <div className="bg-zinc-900 rounded-xl p-6 w-full lg:w-[26rem] lg:shrink-0 text-center shadow-xl order-1 lg:order-2">
            <div className="text-xs text-zinc-400 mb-1">
              {team.map((p) => p.slot).join(", ")} — Salary cap: $
              {salaryCap.toLocaleString()}
            </div>
            <div className="text-[11px] text-lime-300/80 mb-3">
              Highlight rows for a bulk AI pass, or use Swap / AI on any single
              row to replace one player.
            </div>

            <div className="space-y-1 text-sm">
              {team.map((p, idx) => {
                const key = `${p.slot}:${p.id || `empty${idx}`}`;
                const isSelected = selectedKeys.includes(lineupKey(p));
                const isReplaceTarget = replaceTarget === p;
                const empty = !p.id;

                if (empty) {
                  return (
                    <div
                      key={key}
                      onClick={() =>
                        setReplaceTarget(isReplaceTarget ? null : p)
                      }
                      className={`flex justify-between items-center py-2 px-2 rounded-md cursor-pointer transition-colors border border-dashed ${
                        isReplaceTarget
                          ? "bg-sky-900/30 border-sky-500 text-white"
                          : "border-zinc-700 text-zinc-400 hover:bg-zinc-800/60"
                      }`}
                    >
                      <span className="text-left flex items-center gap-2">
                        <span className="font-semibold text-lime-300 mr-2">
                          {p.slot}
                        </span>
                        {isReplaceTarget
                          ? "Pick a player below…"
                          : "Empty — tap to add a player"}
                      </span>
                      <span className="text-sky-400 text-xs font-semibold">
                        + Add
                      </span>
                    </div>
                  );
                }

                return (
                  <div
                    key={key}
                    className={`flex justify-between items-center py-1 px-2 rounded-md transition-colors border ${
                      isReplaceTarget
                        ? "bg-sky-900/30 border-sky-500 text-white"
                        : isSelected
                          ? "bg-lime-900/40 border-lime-500 text-white"
                          : "bg-transparent border-transparent border-b-zinc-700 text-gray-200 hover:bg-zinc-800/60"
                    }`}
                  >
                    <span
                      onClick={() => toggleSelected(p)}
                      className="text-left flex items-center gap-2 cursor-pointer flex-1 min-w-0"
                    >
                      <span
                        className={`h-3.5 w-3.5 rounded-sm border flex items-center justify-center text-[9px] shrink-0 ${
                          isSelected
                            ? "bg-lime-500 border-lime-400 text-black"
                            : "border-zinc-600"
                        }`}
                      >
                        {isSelected ? "✓" : ""}
                      </span>
                      <span className="truncate">
                        <span className="font-semibold text-lime-300 mr-2">
                          {p.slot}
                        </span>
                        {p.name}{" "}
                        <span className="text-xs text-zinc-400">
                          ({p.position}, {p.team})
                        </span>
                        {p.tentative && (
                          <span className="ml-1 text-amber-400" title={p.tentativeReason ?? "Tentative"}>
                            ⚠
                          </span>
                        )}
                      </span>
                    </span>

                    <span className="flex items-center gap-2 shrink-0">
                      <span className="text-right text-xs tabular-nums">
                        <span className="text-lime-400 mr-2">
                          ${p.salary.toLocaleString()}
                        </span>
                        <span className="text-sky-400">
                          {p.avgDK.toFixed(1)} DK
                        </span>
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedKeys([]);
                          setAiResult(null);
                          setReplaceTarget(isReplaceTarget ? null : p);
                        }}
                        className={`px-2 py-0.5 rounded text-[10px] font-semibold border transition-colors ${
                          isReplaceTarget
                            ? "bg-sky-600 border-sky-400 text-white"
                            : "border-zinc-600 text-zinc-300 hover:border-sky-500 hover:text-sky-300"
                        }`}
                      >
                        Swap
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          aiReplaceSlot(p);
                        }}
                        disabled={aiLoading}
                        className="px-2 py-0.5 rounded text-[10px] font-semibold border border-zinc-600 text-zinc-300 hover:border-lime-500 hover:text-lime-300 transition-colors disabled:opacity-50"
                      >
                        ✨ AI
                      </button>
                    </span>
                  </div>
                );
              })}
            </div>

            {/* REPLACE-MODE BANNER */}
            {replaceTarget && (
              <div className="mt-3 bg-sky-900/30 border border-sky-600/50 rounded-lg p-3 text-left text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sky-200">
                    Choose a <span className="font-semibold">{replaceTarget.slot}</span>
                    {replaceTarget.id ? ` to replace ${replaceTarget.name}` : ""} from
                    the cards below — budget{" "}
                    <span className="font-semibold tabular-nums">
                      ${(replaceBudget ?? 0).toLocaleString()}
                    </span>
                    {slate?.gameType === "showdown" &&
                      replaceTarget.slot === "CPT" &&
                      " (CPT costs 1.5× salary)"}
                  </span>
                  <button
                    onClick={() => setReplaceTarget(null)}
                    className="px-2 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600 text-white shrink-0"
                  >
                    Cancel
                  </button>
                </div>
                {filtered.length === 0 && (
                  <div className="text-amber-300 mt-2">
                    No eligible players fit this slot under the remaining cap.
                    Free up salary by swapping a pricier slot first.
                  </div>
                )}
              </div>
            )}

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
          {/* REPLACE-MODE HEADER ABOVE GRID */}
          {replaceTarget && (
            <div className="mx-auto max-w-2xl mb-3 px-6 text-center text-xs text-sky-300">
              Tap a card to put them in the{" "}
              <span className="font-semibold">{replaceTarget.slot}</span> slot
              {replaceTarget.id ? ` (replacing ${replaceTarget.name})` : ""}.
            </div>
          )}

          {/* PLAYER GRID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 px-6">
            {paged.map((p, i) => (
              <PlayerCard
                key={p.id}
                player={p}
                isVisible={i < visibleCards}
                onSelect={
                  replaceTarget ? () => handleGridSelect(p) : undefined
                }
                selectLabel={
                  replaceTarget
                    ? `→ ${replaceTarget.slot}${
                        slate?.gameType === "showdown" &&
                        replaceTarget.slot === "CPT"
                          ? ` $${slotCost(p, "CPT").toLocaleString()}`
                          : ""
                      }`
                    : undefined
                }
              />
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
