import { useQuery } from 'react-query';
import { fetchAndParseCSV, PlayerData } from '../utils/csvParser';
import { fetchSalaryChanges, SalaryChange } from '../utils/salaryChanges';

const CSV_URL = 'https://hebbkx1anhila5yf.public.blob.vercel-storage.com/DKSalaries-SFBMn4gfMJiaGK2GR1qrZShYgmEuJt.csv';

interface PlayerRecommendation extends PlayerData {
  score: number;
  salaryChange: number;
}

// Fallback data in case of network errors
const fallbackPlayerData: PlayerData[] = [
  { Position: 'PG', Name: 'John Doe', ID: 1, RosterPosition: 'PG/SG', Salary: 8000, GameInfo: 'NYK@BOS 12/02/2024 07:30PM ET', TeamAbbrev: 'NYK', AvgPointsPerGame: 25 },
  { Position: 'SG', Name: 'Jane Smith', ID: 2, RosterPosition: 'SG/SF', Salary: 7500, GameInfo: 'LAL@GSW 12/02/2024 10:00PM ET', TeamAbbrev: 'LAL', AvgPointsPerGame: 22 },
  { Position: 'SF', Name: 'Mike Johnson', ID: 3, RosterPosition: 'SF/PF', Salary: 7000, GameInfo: 'MIA@CHI 12/02/2024 08:00PM ET', TeamAbbrev: 'MIA', AvgPointsPerGame: 20 },
  { Position: 'PF', Name: 'Sarah Brown', ID: 4, RosterPosition: 'PF/C', Salary: 6500, GameInfo: 'HOU@DAL 12/02/2024 08:30PM ET', TeamAbbrev: 'HOU', AvgPointsPerGame: 18 },
  { Position: 'C', Name: 'Tom Wilson', ID: 5, RosterPosition: 'C', Salary: 6000, GameInfo: 'PHI@TOR 12/02/2024 07:00PM ET', TeamAbbrev: 'PHI', AvgPointsPerGame: 15 },
];

const fallbackSalaryChanges: SalaryChange[] = [
  { name: 'John Doe', change: 500 },
  { name: 'Jane Smith', change: -300 },
  { name: 'Mike Johnson', change: 200 },
  { name: 'Sarah Brown', change: 0 },
  { name: 'Tom Wilson', change: -100 },
];

export function usePlayerRecommendations() {
  const { data: playerData, isLoading: isLoadingPlayerData, error: playerDataError } = useQuery('playerData', () => fetchAndParseCSV(CSV_URL), {
    retry: 2,
    onError: (error) => console.error('Error fetching player data:', error),
  });

  const { data: salaryChanges, isLoading: isLoadingSalaryChanges, error: salaryChangesError } = useQuery('salaryChanges', fetchSalaryChanges, {
    retry: 2,
    onError: (error) => console.error('Error fetching salary changes:', error),
  });

  const getTopPlayers = (): PlayerRecommendation[] => {
    const effectivePlayerData = playerData || fallbackPlayerData;
    const effectiveSalaryChanges = salaryChanges || fallbackSalaryChanges;

    const salaryChangeMap = new Map<string, number>();
    effectiveSalaryChanges.forEach((change: SalaryChange) => salaryChangeMap.set(change.name, change.change));

    const scoredPlayers = effectivePlayerData.map((player: PlayerData) => {
      const salaryChange = salaryChangeMap.get(player.Name) || 0;
      const score = (player.Salary - salaryChange) / (player.AvgPointsPerGame || 1) * (player.AvgPointsPerGame || 1);
      return { ...player, score, salaryChange };
    });

    return scoredPlayers
      .sort((a, b) => b.score - a.score)
      .slice(0, 5);
  };

  return {
    getTopPlayers,
    isLoading: isLoadingPlayerData || isLoadingSalaryChanges,
    error: playerDataError || salaryChangesError,
  };
}

