// src/utils/nbaDirectory.ts
type NbaDirectoryPlayer = {
  firstName: string;
  lastName: string;
  personId: string; // numeric string
  teamId?: string;
  jersey?: string;
  pos?: string;
  isActive?: boolean;
};

let directoryCache: Map<string, string> | null = null;

function normalizeName(first: string, last: string) {
  return `${first} ${last}`.toLowerCase().replace(/[^a-z\s]/g, "").replace(/\s+/g, " ").trim();
}

// Pull the official NBA directory for the current season
export async function loadNbaDirectory(): Promise<Map<string, string>> {
  if (directoryCache) return directoryCache;

  // This JSON lists every player with personId (works client-side; CORS is OK)
  // If 2025 doesn't load in the future, fallback to "players.json" without year.
  const urls = [
    "https://data.nba.com/data/10s/prod/v1/2025/players.json",
    "https://data.nba.com/data/10s/prod/v1/players.json",
  ];

  let data: any | null = null;
  for (const u of urls) {
    try {
      const res = await fetch(u, { cache: "no-store" });
      if (res.ok) {
        data = await res.json();
        break;
      }
    } catch (_) {}
  }
  if (!data?.league?.standard) {
    directoryCache = new Map();
    return directoryCache;
  }

  const map = new Map<string, string>();
  (data.league.standard as NbaDirectoryPlayer[]).forEach((p) => {
    const key = normalizeName(p.firstName, p.lastName);
    if (key && p.personId) map.set(key, p.personId);
  });

  directoryCache = map;
  return directoryCache;
}

export async function getNbaPersonId(first: string, last: string): Promise<string | null> {
  const map = await loadNbaDirectory();
  const key = normalizeName(first, last);
  return map.get(key) ?? null;
}
