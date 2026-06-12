// src/hooks/useEfficientPlayers.ts
"use client";

import { useEffect, useState } from "react";
import type { PlayerOut, Last5Game } from "@/app/api/players/route";

export interface EfficientPlayer extends PlayerOut {
  last5: Last5Game[];
}

export interface SlateInfo {
  source: "live" | "demo";
  draftGroupId: number | null;
  gameType: "classic" | "showdown";
  gameTypeName: string;
  startDate: string | null;
  label: string;
}

interface ApiResponse {
  count: number;
  data: PlayerOut[];
  slate?: SlateInfo;
}

export function useEfficientPlayers() {
  const [efficientPlayers, setEfficientPlayers] = useState<EfficientPlayer[]>([]);
  const [slate, setSlate] = useState<SlateInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setIsLoading(true);
        setError(null);

        const res = await fetch("/api/players");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;

        const mapped: EfficientPlayer[] = json.data.map((p) => ({
          ...p,
          last5: p.last5 ?? [],
        }));

        setEfficientPlayers(mapped);
        setSlate(json.slate ?? null);
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message ?? "Failed to load players");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return { efficientPlayers, slate, isLoading, error };
}
