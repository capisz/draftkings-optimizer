// src/app/page.tsx
"use client";

import { useState, useEffect, useRef } from "react";
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
import { rankReplacements, explainPick } from "@/lib/recommender";

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
  // MLB pitcher slot accepts starters/relievers
  if (slot === "P")
    return parts.includes("P") || parts.includes("SP") || parts.includes("RP");
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

// Roster slots for a slate (sport + contest type)
function slotsFor(sport: "NBA" | "MLB", gameType?: string): string[] {
  if (gameType === "showdown")
    return ["CPT", "UTIL", "UTIL", "UTIL", "UTIL", "UTIL"];
  return sport === "MLB"
    ? ["P", "P", "C", "1B", "2B", "3B", "SS", "OF", "OF", "OF"]
    : ["PG", "SG", "SF", "PF", "C", "G", "F", "UTIL"];
}

// An empty manual lineup (placeholder rows with empty ids) for the given slots
function emptyLineup(slots: string[]): LineupPlayer[] {
  return slots.map((slot) => ({
    id: "",
    dkId: "",
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
}

// DraftKings CSV import string: slot header row + a `Name (dkId)` row
function dkImportCsv(team: LineupPlayer[]): string {
  const filled = team.filter((p) => p.id);
  const header = filled.map((p) => p.slot).join(",");
  const row = filled
    .map((p) => `${p.name} (${p.dkId ?? p.id})`)
    .join(",");
  return `${header}\n${row}`;
}

function EmptyLineupSlotCard({
  slot,
  selected,
  onSelect,
}: {
  slot: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`group dk-card isolate h-80 w-full rounded-3xl bg-[#191b20] p-4 pt-5 flex flex-col justify-between text-left border shadow-lg shadow-black/40 transition-all duration-200 hover:-translate-y-1 hover:shadow-xl hover:shadow-lime-900/30 relative overflow-hidden ${
        selected
          ? "border-sky-400 ring-2 ring-sky-500/50"
          : "border-dashed border-zinc-700/90 hover:border-lime-500/70"
      }`}
      aria-label={`Add player to ${slot} slot`}
    >
      <div className="dk-card-accent pointer-events-none absolute inset-x-0 top-0 h-1.5" />
      <div className="dk-card-sheen pointer-events-none absolute inset-0 -z-10" />

      <div className="flex items-center justify-between">
        <span className="rounded-full border border-lime-500/40 bg-lime-500/10 px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-lime-300">
          Empty Slot
        </span>
        <span className="rounded-md bg-lime-500 px-1.5 py-0.5 text-[9px] font-bold text-black">
          {slot}
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-2xl border border-dashed border-lime-500/40 bg-black/20 text-4xl font-black tracking-tight text-lime-300">
          {slot}
        </div>
        <div className="text-sm font-semibold text-white">
          {selected ? "Choose a player below" : `Add ${slot}`}
        </div>
        <div className="mt-1 max-w-[12rem] text-xs leading-5 text-zinc-400">
          {selected
            ? "The player pool is filtered for this roster spot."
            : "Tap to fill this position from the player pool."}
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800 bg-zinc-950/50 px-3 py-3 text-xs text-zinc-500">
        Salary and projection will appear here after a player is selected.
      </div>
    </button>
  );
}

export default function Home() {
  const [sport, setSport] = useState<"NBA" | "MLB">("NBA");
  const { efficientPlayers, slate, isLoading, error } =
    useEfficientPlayers(sport);

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
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<AiSwapResponse | null>(null);

  // manual replace mode: which lineup spot is being replaced
  const [replaceTarget, setReplaceTarget] = useState<LineupPlayer | null>(null);

  // build mode: "manual" (default) or "generate" — drives the segmented toggle
  const [buildMode, setBuildMode] = useState<"manual" | "generate">("manual");
  // clipboard confirmation for the DraftKings import button
  const [copied, setCopied] = useState(false);

  // restore saved sport on mount
  useEffect(() => {
    const saved =
      typeof window !== "undefined"
        ? (localStorage.getItem("sport") as "NBA" | "MLB" | null)
        : null;
    if (saved === "MLB") setSport("MLB");
  }, []);

  const switchSport = (next: "NBA" | "MLB") => {
    if (next === sport) return;
    setSport(next);
    try {
      localStorage.setItem("sport", next);
    } catch {}
    // reset everything tied to the previous slate
    setTeam([]);
    setTeamMeta(null);
    setSelectedKeys([]);
    setAiResult(null);
    setAiError(null);
    setReplaceTarget(null);
    setPosition(null);
    setSearchTerm("");
    setPageCount(1);
    setBuildMode("manual"); // back to the default mode for the new slate
  };

  const copyDkImport = async () => {
    const text = dkImportCsv(team);
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // fallback for browsers/contexts without the async clipboard API
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        ok = document.execCommand("copy");
        document.body.removeChild(ta);
      } catch {
        ok = false;
      }
    }
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    }
  };

  // Rotation cursor per slot, so pressing AI again on the same row cycles to
  // the next-best alternative instead of repeating the same pick.
  const aiRotationRef = useRef<{ key: string; index: number }>({
    key: "",
    index: 0,
  });

  // ----- TEAM CONVEYOR: auto-scroll + click-drag -----
  const conveyorRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef({
    down: false,
    startX: 0,
    startScroll: 0,
    moved: false,
  });
  const autoPausedRef = useRef(false);

  useEffect(() => {
    const el = conveyorRef.current;
    if (!el) return;
    let raf = 0;
    const step = () => {
      if (!autoPausedRef.current && el.scrollWidth > el.clientWidth) {
        el.scrollLeft += 0.5;
        const half = el.scrollWidth / 2;
        if (el.scrollLeft >= half) el.scrollLeft -= half; // seamless loop
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [team]);

  // Default to Build Manually: once the slate has loaded, stand up an empty
  // lineup to fill (until the user opts into Generate Team).
  useEffect(() => {
    if (
      !isLoading &&
      !error &&
      buildMode === "manual" &&
      team.length === 0 &&
      efficientPlayers.length > 0
    ) {
      setTeam(emptyLineup(slotsFor(sport, slate?.gameType)));
      setTeamMeta({
        totalSalary: 0,
        totalAvgDK: 0,
        totalScore: 0,
        salaryCap: 50000,
      });
    }
  }, [
    isLoading,
    error,
    buildMode,
    team.length,
    efficientPlayers.length,
    sport,
    slate?.gameType,
  ]);

  const conveyorDown = (e: React.PointerEvent) => {
    const el = conveyorRef.current;
    if (!el) return;
    dragRef.current = {
      down: true,
      startX: e.clientX,
      startScroll: el.scrollLeft,
      moved: false,
    };
    autoPausedRef.current = true;
  };
  const conveyorMove = (e: React.PointerEvent) => {
    const st = dragRef.current;
    const el = conveyorRef.current;
    if (!st.down || !el) return;
    const dx = e.clientX - st.startX;
    if (Math.abs(dx) > 4) st.moved = true;
    el.scrollLeft = st.startScroll - dx;
  };
  const conveyorUp = () => {
    dragRef.current.down = false;
    autoPausedRef.current = false;
  };
  // swallow the click that follows a drag so cards don't flip after dragging
  const conveyorClickCapture = (e: React.MouseEvent) => {
    if (dragRef.current.moved) {
      e.stopPropagation();
      e.preventDefault();
      dragRef.current.moved = false;
    }
  };

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
    .filter((p) => (!position ? true : canPlaySlot(p.position, position)))
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
      setBuildMode("generate");
      setTeamLoading(true);
      setTeamMeta(null);
      setTeam([]);
      setTeamError(null);
      setSelectedKeys([]);
      setAiResult(null);
      setAiError(null);

      const res = await fetch(`/api/generate-lineup?sport=${sport}`, {
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


  const applyAiLineup = () => {
    if (!aiResult) return;
    setTeam(aiResult.newLineup);
    setTeamMeta(aiResult.newTotals);
    setSelectedKeys([]);
    setAiResult(null);
  };

  const realSwaps = aiResult?.suggestions.filter((s) => !s.kept) ?? [];

  // Roster slots for the current slate
  const slots = slotsFor(sport, slate?.gameType);

  // Position filter chips for the player pool
  const positionChips =
    sport === "MLB"
      ? ["P", "C", "1B", "2B", "3B", "SS", "OF"]
      : ["PG", "SG", "SF", "PF", "C"];

  // ----- MANUAL BUILD -----
  const startManualBuild = () => {
    setBuildMode("manual");
    setTeam(emptyLineup(slots));
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

  // ----- MLB AI: batter-vs-pitcher matchup recommendation (server) -----
  const aiMatchupReplace = async (p: LineupPlayer) => {
    setSelectedKeys([lineupKey(p)]);
    setReplaceTarget(null);
    setAiError(null);
    setAiResult(null);
    setAiLoading(true);

    const key = lineupKey(p);
    const rot = aiRotationRef.current;
    const index = rot.key === key ? rot.index + 1 : 0;
    aiRotationRef.current = { key, index };

    try {
      const res = await fetch("/api/mlb/matchup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lineup: team, selectedKey: key, index }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error || "Matchup analysis failed");
      setAiResult(json as AiSwapResponse);
    } catch (e: any) {
      setAiError(e.message ?? "Matchup analysis failed");
    } finally {
      setAiLoading(false);
    }
  };

  // ----- AI PICKS A REPLACEMENT FOR ONE SLOT (local model, no API key) -----
  const aiReplaceSlot = (p: LineupPlayer) => {
    if (!p.id) {
      // empty manual slot — fall back to the grid picker
      setReplaceTarget(p);
      return;
    }

    // MLB uses the batter-vs-pitcher matchup service
    if (sport === "MLB") {
      aiMatchupReplace(p);
      return;
    }

    setSelectedKeys([lineupKey(p)]);
    setReplaceTarget(null);
    setAiError(null);
    setAiResult(null);
    setAiLoading(true);

    // small delay so the recommendation reads as deliberate analysis
    setTimeout(() => {
      try {
        const cap = teamMeta?.salaryCap ?? 50000;
        const othersSalary = team
          .filter((t) => t !== p)
          .reduce((s, t) => s + t.salary, 0);
        const budget = cap - othersSalary;
        const lineupIds = new Set(team.filter((t) => t.id).map((t) => t.id));

        const ranked = rankReplacements({
          pool: efficientPlayers,
          lineupIds,
          target: { id: p.id, slot: p.slot, salary: p.salary },
          budget,
        });

        if (!ranked.length) {
          setAiError(
            "No eligible upgrade fits this slot under the remaining cap. Free up salary by swapping a pricier slot first."
          );
          setAiLoading(false);
          return;
        }

        // advance the rotation cursor for repeated presses on the same slot
        const key = lineupKey(p);
        const rot = aiRotationRef.current;
        const index = rot.key === key ? (rot.index + 1) % ranked.length : 0;
        aiRotationRef.current = { key, index };

        const choice = ranked[index];
        const incoming = toSlotPlayer(choice.player, p.slot);
        const kept = incoming.id === p.id;
        const isUpgrade = incoming.avgDK > p.avgDK + 0.5;

        const newLineup = team.map((t) => (t === p ? incoming : t));
        const totals = lineupTotals(newLineup, cap);

        const lead =
          index === 0
            ? isUpgrade
              ? "Top upgrade below"
              : "Your current pick already grades out well — here's the best available alternative"
            : `Alternative #${index + 1}`;

        setAiResult({
          summary:
            `The model ranked ${ranked.length} eligible ${p.slot} option${ranked.length > 1 ? "s" : ""} on recent form, value, minutes trend and reliability. ` +
            `${lead} — press AI again for the next option.`,
          suggestions: [
            {
              slot: p.slot,
              out: p,
              in: incoming,
              reasoning: explainPick(choice.player, p, choice.cost - p.salary),
              kept,
            },
          ],
          newLineup,
          newTotals: totals,
        });
      } catch (e: any) {
        setAiError(e.message ?? "Recommendation failed");
      } finally {
        setAiLoading(false);
      }
    }, 450);
  };

  const hasEmptySlots = team.some((p) => !p.id);

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
        /* fade both edges of the matchup ticker so the right doesn't run flush
           against the crown the way the left is inset from the box padding */
        .dk-matchup-marquee {
          -webkit-mask-image: linear-gradient(
            to right,
            transparent 0,
            #000 28px,
            #000 calc(100% - 28px),
            transparent 100%
          );
          mask-image: linear-gradient(
            to right,
            transparent 0,
            #000 28px,
            #000 calc(100% - 28px),
            transparent 100%
          );
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

        /* Team conveyor: a real horizontal scroller (drag + auto-scroll).
           Vertical padding leaves room for the card hover-lift and shadow. */
        .dk-conveyor-scroller {
          display: flex;
          gap: 1rem;
          overflow-x: auto;
          overflow-y: hidden;
          padding: 14px 4px 24px;
          cursor: grab;
          user-select: none;
          scrollbar-width: thin;
          scrollbar-color: #65a30d transparent;
        }
        .dk-conveyor-scroller:active {
          cursor: grabbing;
        }
        .dk-conveyor-scroller::-webkit-scrollbar {
          height: 6px;
        }
        .dk-conveyor-scroller::-webkit-scrollbar-thumb {
          background: #3f6212;
          border-radius: 9999px;
        }
        .dk-conveyor-scroller::-webkit-scrollbar-track {
          background: transparent;
        }
      `}</style>

      <div className="min-h-screen text-white bg-gradient-to-b from-zinc-800 via-zinc-900 to-black pb-8 relative">
        {/* FULL-SCREEN LOADING OVERLAY */}
        {teamLoading && <LoadingOverlay progress={progress} />}

        {/* APP HEADER */}
        <header className="dk-app-header sticky top-0 z-40 backdrop-blur-md bg-zinc-950/70 border-b border-zinc-800/80 mb-6">
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
                <span className="text-zinc-400">.ai</span>
              </h1>
            </div>
            <div className="flex items-center gap-3">
              {/* SPORT TOGGLE */}
              <div className="inline-flex rounded-full border border-zinc-700 bg-zinc-800 p-0.5 text-xs font-semibold shrink-0">
                {(["NBA", "MLB"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => switchSport(s)}
                    className={`px-3 py-1 rounded-full transition-colors ${
                      sport === s
                        ? "bg-lime-500 text-black"
                        : "text-zinc-300 hover:text-white"
                    }`}
                  >
                    {s === "NBA" ? "🏀 NBA" : "⚾ MLB"}
                  </button>
                ))}
              </div>
              {slate && (
                <span
                  className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold uppercase tracking-wide whitespace-nowrap shrink-0 ${
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

                  <div className="dk-matchup-marquee relative mt-1 overflow-hidden">
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

        {/* TEAM GENERATOR – segmented pill, like the header sport toggle */}
        <div className="flex flex-col items-center mb-6 px-4 space-y-3">
          <div className="inline-flex items-center gap-1 rounded-full border border-zinc-700 bg-zinc-800 p-1 shadow-md">
            <Button
              onClick={startManualBuild}
              disabled={teamLoading}
              className={`inline-flex items-center justify-center rounded-full px-5 py-2 text-sm font-semibold transition-all duration-150 active:scale-95 ${
                buildMode === "manual"
                  ? "bg-lime-600 text-black hover:bg-lime-500"
                  : "bg-transparent text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              Build Manually
            </Button>

            <Button
              onClick={generateTeam}
              disabled={teamLoading}
              className={`inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-semibold transition-all duration-150 active:scale-95 disabled:opacity-60 ${
                buildMode === "generate"
                  ? "bg-lime-600 text-black hover:bg-lime-500"
                  : "bg-transparent text-zinc-300 hover:bg-zinc-700"
              }`}
            >
              {teamLoading ? "Optimizing…" : "Generate Team"}
            </Button>
          </div>

          {teamError && <div className="text-red-400 text-sm">{teamError}</div>}
        </div>

        {/* TEAM WORKSPACE — lineup list + carousel together in one panel */}
        {team.length > 0 && (
        <div className="mx-auto max-w-6xl mb-6 px-4">
        <div className="bg-zinc-900 rounded-xl p-6 shadow-xl flex flex-col lg:flex-row gap-6 items-start">
        {/* TEAM CONVEYOR — auto-scrolls lineup cards, pauses on hover */}
        {team.length > 0 && (
          <div className="w-full lg:flex-1 lg:min-w-0 order-2 lg:order-1">
            <div className="text-xs font-semibold text-lime-400 uppercase tracking-wide mb-1">
              Your Lineup
            </div>
            <div className="text-[11px] text-zinc-500 mb-3">
              {hasEmptySlots
                ? "auto-scrolling · click & drag to browse · tap an empty slot to add"
                : "auto-scrolling · click & drag to browse · tap a card for last 5 games"}
            </div>
            <div
              ref={conveyorRef}
              className="dk-conveyor-scroller"
              onPointerDown={conveyorDown}
              onPointerMove={conveyorMove}
              onPointerUp={conveyorUp}
              onPointerLeave={conveyorUp}
              onMouseEnter={() => (autoPausedRef.current = true)}
              onMouseLeave={() => {
                if (!dragRef.current.down) autoPausedRef.current = false;
              }}
              onClickCapture={conveyorClickCapture}
            >
              {/* duplicate the cards so the auto-scroll loop is seamless */}
              {[...team, ...team].map((p, i) => (
                <div
                  key={`conveyor-${p.slot}-${p.id || "empty"}-${i}`}
                  className="w-60 shrink-0"
                >
                  {p.id ? (
                    <PlayerCard player={p} slot={p.slot} />
                  ) : (
                    <EmptyLineupSlotCard
                      slot={p.slot}
                      selected={replaceTarget === p}
                      onSelect={() => {
                        setSelectedKeys([]);
                        setAiResult(null);
                        setAiError(null);
                        setReplaceTarget(replaceTarget === p ? null : p);
                      }}
                    />
                  )}
                </div>
              ))}
            </div>

            {/* IMPORT TO DRAFTKINGS */}
            {!hasEmptySlots && (
              <div className="mt-3 flex items-center gap-3">
                <Button
                  onClick={copyDkImport}
                  className="inline-flex items-center gap-2 rounded-full bg-zinc-800 border border-lime-600/50 px-4 py-2 text-xs font-semibold text-lime-300 hover:bg-zinc-700 transition-colors"
                >
                  {copied ? "✓ Copied!" : "Copy for DraftKings"}
                </Button>
                <span className="text-[10px] text-zinc-500">
                  CSV (slots + Name/ID) — paste into a DraftKings lineup upload
                </span>
              </div>
            )}
          </div>
        )}

        {/* TEAM DISPLAY (lineup list) */}
          <div className="w-full lg:w-[26rem] lg:shrink-0 text-center order-1 lg:order-2">
            <div className="text-xs text-zinc-400 mb-1">
              {team.map((p) => p.slot).join(", ")} — Salary cap: $
              {salaryCap.toLocaleString()}
            </div>
            <div className="text-[11px] text-lime-300/80 mb-3">
              Use Swap to pick a replacement yourself, or AI to let the analyst
              choose.
            </div>

            <div className="space-y-1 text-sm">
              {team.map((p, idx) => {
                const key = `${p.slot}:${p.id || `empty${idx}`}`;
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
                        : `${
                            idx % 2 === 0
                              ? "dk-lineup-row-alt"
                              : "dk-lineup-row-base"
                          } border-transparent border-b-zinc-700 text-gray-200`
                    }`}
                  >
                    <span className="text-left flex items-center gap-2 flex-1 min-w-0">
                      <span className="truncate">
                        <span className="font-semibold text-lime-300 mr-2">
                          {p.slot}
                        </span>
                        <span className="font-semibold text-white">
                          {p.name}
                        </span>{" "}
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
                        AI
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

            {/* AI STATUS / ERROR */}
            {aiLoading && (
              <div className="mt-4 text-xs text-sky-300">
                Asking the AI analyst…
              </div>
            )}
            {aiError && (
              <div className="mt-4 text-red-400 text-xs">{aiError}</div>
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
        </div>
        )}

        {/* BLUR GRID WHEN LOADING */}
        <div
          className={`transition-all duration-300 ${
            teamLoading ? "blur-sm opacity-40" : "blur-0 opacity-100"
          }`}
        >
          {/* PLAYER POOL TOOLBAR — filters for the grid below */}
          <div className="px-6 mb-4">
            <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 pb-4">
              <span className="text-xs font-semibold text-lime-400 uppercase tracking-wide mr-1">
                Player Pool
              </span>
              {positionChips.map((pos) => (
                <button
                  key={pos}
                  onClick={() => setPosition(position === pos ? null : pos)}
                  className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                    position === pos
                      ? "bg-lime-500 border-lime-300 text-black font-semibold hover:bg-lime-400"
                      : "bg-zinc-800 border-zinc-700 text-zinc-200 hover:border-lime-600/50 hover:bg-zinc-700"
                  }`}
                >
                  {pos}
                </button>
              ))}
              {position && (
                <button
                  onClick={() => setPosition(null)}
                  className="text-[11px] text-zinc-400 hover:text-zinc-200 underline underline-offset-2"
                >
                  clear
                </button>
              )}

              <div className="w-full sm:w-56 sm:ml-2">
                <Input
                  placeholder="Search players..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-zinc-800 text-white border border-zinc-700 rounded-full px-4 h-9 focus:border-lime-500 focus:ring-lime-500"
                />
              </div>
            </div>
          </div>

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
