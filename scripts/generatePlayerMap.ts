import fs from "fs";
import path from "path";

async function main() {
  console.log("Fetching NBA player data (GitHub mirror)...");

  const res = await fetch(
    "https://raw.githubusercontent.com/bttmly/nba/master/data/players.json"
  );

  if (!res.ok) {
    console.error("❌ BAD RESPONSE:", res.status, res.statusText);
    return;
  }

  const players = await res.json();

  console.log(`Found ${players.length} players`);

  const out: Record<string, number> = {};

  for (const p of players) {
    const normalized = (p.firstName + p.lastName)
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    out[normalized] = Number(p.playerId);
  }

  const targetPath = path.join(
    process.cwd(),
    "src/lib/playerIdMap.json"
  );

  fs.writeFileSync(targetPath, JSON.stringify(out, null, 2));

  console.log(`✔ DONE — wrote ${Object.keys(out).length} players`);
}

main();
