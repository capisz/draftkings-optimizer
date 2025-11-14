// src/lib/nbaHeadshots.ts

import playerIdMap from "./playerIdMap.json";

type PlayerIdMap = Record<string, number | string>;

const DEFAULT_HEADSHOT =
  "https://upload.wikimedia.org/wikipedia/commons/5/59/User-avatar.svg";

function buildNbaHeadshotUrl(id: number | string): string {
  // Official NBA.com headshot URL pattern
  return `https://ak-static.cms.nba.com/wp-content/uploads/headshots/nba/latest/260x190/${id}.png`;
}

export function getHeadshotUrl(fullName: string | null | undefined): string {
  if (!fullName) return DEFAULT_HEADSHOT;

  const key = fullName.trim().toLowerCase();
  const map = playerIdMap as PlayerIdMap;
  const id = map[key];

  if (!id) {
    // If we somehow didn't get an ID, fall back to generic avatar
    if (process.env.NODE_ENV !== "production") {
      // quiet in prod, noisy in dev
      console.warn("[nbaHeadshots] Missing ID for:", key);
    }
    return DEFAULT_HEADSHOT;
  }

  return buildNbaHeadshotUrl(id);
}
