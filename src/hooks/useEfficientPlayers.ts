// src/hooks/useEfficientPlayers.ts
"use client";

import { useEffect, useState } from "react";
import type { PlayerOut, Last5Game } from "@/app/api/players/route";

export interface EfficientPlayer extends PlayerOut {
  last5: Last5Game[];
}

interface ApiResponse {
  count: number;
  data: PlayerOut[];
}

export function useEfficientPlayers() {
  const [efficientPlayers, setEfficientPlayers] = useState<EfficientPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/players");
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const json = (await res.json()) as ApiResponse;
        if (cancelled) return;

        const mapped: EfficientPlayer[] = json.data.map((p) => ({
          ...p,
          // ensure last5 is always an array
          last5: p.last5 ?? [],
        }));

        setEfficientPlayers(mapped);
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message ?? "Failed to load players");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, []);

  return { efficientPlayers, loading, error };
}
