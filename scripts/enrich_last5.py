# scripts/enrich_last5.py

import json
import time
from pathlib import Path
from datetime import datetime

import pandas as pd
from nba_api.stats.static import players as nba_players
from nba_api.stats.endpoints import PlayerGameLog

# Adjust these if your paths are different
PLAYERS_JSON_PATH = Path("src/data/players-2025-11-14.json")
ID_MAP_PATH = Path("src/lib/playerIdMap.json")
OUT_JSON_PATH = Path("src/data/players-2025-11-14-last5.json")

# NBA season string (e.g. "2025-26")
SEASON = "2025-26"

def dk_points(row: pd.Series) -> float:
    """
    DraftKings NBA scoring:
    pts + 1.25*reb + 1.5*ast + 2*stl + 2*blk - 0.5*tov
    """
    return (
        (row.get("PTS", 0) or 0)
        + 1.25 * (row.get("REB", 0) or 0)
        + 1.5 * (row.get("AST", 0) or 0)
        + 2 * (row.get("STL", 0) or 0)
        + 2 * (row.get("BLK", 0) or 0)
        - 0.5 * (row.get("TOV", 0) or 0)
    )

def parse_game(row: pd.Series) -> dict:
    """
    Convert an NBA API game log row into the last5 structure:
    { date: "YYYY-MM-DD", opp: "vs LAL" | "@ LAL", dk: number }
    """
    # GAME_DATE is like "NOV 10, 2025"
    game_date = row["GAME_DATE"]
    try:
        dt = datetime.strptime(game_date, "%b %d, %Y")
        date_str = dt.strftime("%Y-%m-%d")
    except Exception:
        date_str = game_date

    matchup = row["MATCHUP"]  # e.g. "DAL vs LAL" or "DAL @ LAL"
    parts = matchup.split()
    # Format: "DAL vs LAL" or "DAL @ LAL"
    # parts[1] == "vs" or "@"
    opp = parts[-1] if len(parts) >= 3 else "UNK"
    home_indicator = parts[1] if len(parts) >= 2 else "vs"

    prefix = "vs" if home_indicator.lower() == "vs" else "@"

    return {
        "date": date_str,
        "opp": f"{prefix} {opp}",
        "dk": round(float(dk_points(row)), 2),
    }

def main():
    if not PLAYERS_JSON_PATH.exists():
        raise SystemExit(f"Players JSON not found at {PLAYERS_JSON_PATH}")
    if not ID_MAP_PATH.exists():
        raise SystemExit(f"ID map not found at {ID_MAP_PATH}")

    with PLAYERS_JSON_PATH.open() as f:
        players_data = json.load(f)

    with ID_MAP_PATH.open() as f:
        id_map = json.load(f)

    all_nba_players = nba_players.get_players()
    # Build a lookup: nbaId -> full_name (mostly for debugging)
    nba_by_id = {p["id"]: p["full_name"] for p in all_nba_players}

    updated_players = []
    missed = []

    for idx, p in enumerate(players_data["data"]):
        name = p["name"]
        key = name.lower()

        nba_id = id_map.get(key)
        if not nba_id:
            # No ID in map – keep last5 empty for now
            p["last5"] = []
            missed.append(name)
            updated_players.append(p)
            continue

        print(f"[{idx+1}/{len(players_data['data'])}] {name} (ID {nba_id})")

        try:
            gl = PlayerGameLog(player_id=nba_id, season=SEASON)
            df = gl.get_data_frames()[0]

            if df.empty:
                print(f"  -> no game log rows")
                p["last5"] = []
                updated_players.append(p)
                continue

            # Sort by date ascending, then take the last 5 (most recent)
            df_sorted = df.sort_values("GAME_DATE")
            last5_rows = df_sorted.tail(5)

            last5 = [parse_game(row) for _, row in last5_rows.iterrows()]
            p["last5"] = last5
            updated_players.append(p)

            # Gentle delay to avoid hammering the NBA API
            time.sleep(0.6)

        except Exception as e:
            print(f"  -> error for {name}: {e}")
            p["last5"] = []
            updated_players.append(p)

    # Write updated JSON
    out_obj = {
        "count": len(updated_players),
        "data": updated_players,
    }

    OUT_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUT_JSON_PATH.open("w") as f:
        json.dump(out_obj, f, indent=2)

    print(f"\n✅ Wrote enriched data with last5 to {OUT_JSON_PATH}")

    if missed:
        print("\nNames without an NBA ID in playerIdMap.json:")
        for n in sorted(set(missed)):
            print("  -", n)

if __name__ == "__main__":
    main()
