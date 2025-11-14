import { parse } from 'csv-parse/sync';

export interface PlayerData {
  Position: string;
  Name: string;
  ID: number;
  Salary: number;
  TeamAbbrev: string;
  AvgPointsPerGame: number;
}

export async function fetchAndParseCSV(url: string): Promise<PlayerData[]> {
  try {
    const response = await fetch(url);
    const csvData = await response.text();
    const parsedData = parse(csvData, {
      columns: true,
      skip_empty_lines: true,
    });

    return parsedData.map((row: any) => ({
      Position: row.Position,
      Name: row.Name,
      ID: parseInt(row.ID),
      Salary: parseInt(row.Salary),
      TeamAbbrev: row.TeamAbbrev,
      AvgPointsPerGame: parseFloat(row.AvgPointsPerGame) || 0,
    }));
  } catch (error) {
    console.error('Error fetching CSV data:', error);
    throw new Error('Failed to fetch player data');
  }
}

