# scripts/generate_player_ids.py
import json
from pathlib import Path

from nba_api.stats.static import players as nba_players  # pip install nba_api

# Path to your DK JSON inside the Next.js app
DK_JSON_PATH = Path("src/data/players-2025-11-14.json")
OUT_JSON_PATH = Path("src/lib/playerIdMap.json")  # will overwrite this file


def main():
    if not DK_JSON_PATH.exists():
        raise SystemExit(f"DK JSON not found at {DK_JSON_PATH}")

    with DK_JSON_PATH.open() as f:
        dk_data = json.load(f)

    dk_names = sorted({p["name"] for p in dk_data["data"]})
    print(f"Found {len(dk_names)} unique DK names")

    all_players = nba_players.get_players()
    print(f"nba_api returned {len(all_players)} players")

    # Build lookup: full_name lowercase -> id
    index = {p["full_name"].lower(): p["id"] for p in all_players}

    result = {}
    missing = []

    for name in dk_names:
        key = name.lower()

        # Exact match
        if key in index:
            result[key] = index[key]
            continue

        # Fuzzy full-name search if exact fails
        matches = nba_players.find_players_by_full_name(name)
        if matches:
            result[key] = matches[0]["id"]
        else:
            missing.append(name)

    OUT_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_JSON_PATH.open("w") as f:
        json.dump(result, f, indent=2)
    print(f"✅ Wrote {len(result)} mappings to {OUT_JSON_PATH}")

    if missing:
        print("\n⚠️ Missing these names (couldn’t find in nba_api):")
        for m in missing:
            print("  -", m)


if __name__ == "__main__":
    main()
