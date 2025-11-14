import { parse } from 'csv-parse/sync';

export interface PlayerData {
  Position: string;
  Name: string;
  ID: number;
  playerid: string;
  Salary: number;
  TeamAbbrev: string;
  AvgPointsPerGame: number;
}

export async function fetchAndParseCSV(): Promise<PlayerData[]> {
  try {
    const response = await fetch('/data/player-data.csv');
    const csvData = await response.text();
    const parsedData = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
    });

    return parsedData.map((row: any) => ({
      Position: row.Position,
      Name: row.Name,
      ID: parseInt(row.ID),
      playerid: row.playerid,
      Salary: parseInt(row.Salary),
      TeamAbbrev: row.TeamAbbrev,
      AvgPointsPerGame: parseFloat(row.AvgPointsPerGame) || 0,
    }));
  } catch (error) {
    console.error('Error fetching or parsing CSV data:', error);
    throw new Error('Failed to fetch player data');
  }
}

