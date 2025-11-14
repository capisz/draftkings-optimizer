import React, { useState } from 'react';
import { Button } from "@/components/ui/button"
import { EfficientPlayer } from '../hooks/useEfficientPlayers';

interface RandomGeneratorProps {
  players: EfficientPlayer[];
  onLoadMore: () => void;
}

export function RandomGenerator({ players, onLoadMore }: RandomGeneratorProps) {
  const [selectedPlayers, setSelectedPlayers] = useState<EfficientPlayer[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [buttonPressCount, setButtonPressCount] = useState(0);
  const [showLoadMorePrompt, setShowLoadMorePrompt] = useState(false);

  const getEfficiencyColor = (efficiency: number) => {
    if (efficiency > 6) return 'text-[#D2042D]';
    if (efficiency >= 5.51) return 'text-[#e34d00]';
    if (efficiency >= 5) return 'text-[#ee7600]';
    if (efficiency >= 4.5) return 'text-[#DAA520]';
    if (efficiency >= 4) return 'text-[#ffd10f]';
    return 'text-white';
  };

  const generateRandomPlayers = () => {
    setIsGenerating(true);
    setButtonPressCount(prevCount => prevCount + 1);

    setTimeout(() => {
      const positions = ['PG', 'SG', 'SF', 'PF', 'C'];
      const newSelectedPlayers = positions.map(position => {
        const availablePlayers = players.filter(player => player.Position.includes(position));
        if (availablePlayers.length > 0) {
          const sortedPlayers = availablePlayers.sort((a, b) => b.efficiency - a.efficiency);
          return sortedPlayers[0];
        }
        return null;
      }).filter((player): player is EfficientPlayer => player !== null);

      setSelectedPlayers(newSelectedPlayers);
      setIsGenerating(false);
    }, 300);
  };

  const handleLoadMore = async () => {
    await onLoadMore();
    setButtonPressCount(0);
    setShowLoadMorePrompt(true);
    setTimeout(() => {
      setShowLoadMorePrompt(false);
    }, 2000);
  };

  const totalPrice = selectedPlayers.reduce((sum, player) => sum + (player?.Salary || 0), 0);
  const averageEfficiency = selectedPlayers.filter(Boolean).length > 0
    ? selectedPlayers.reduce((sum, player) => sum + (player?.efficiency || 0), 0) / selectedPlayers.filter(Boolean).length
    : 0;

  return (
    <div className="mb-6 text-center relative">
      <Button
        onClick={generateRandomPlayers}
        className="rounded-lg bg-[#6A8D1A] hover:bg-[#7A9D2A] text-white mb-4 transition-all duration-200 ease-in-out hover:scale-105 mx-auto block shadow-lg text-xl px-8 py-5 flex items-center justify-center relative overflow-hidden"
        disabled={isGenerating}
      >
        <span className="relative z-10">{isGenerating ? "Generating..." : "Team Generator"}</span>
        <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black opacity-30"></div>
      </Button>
      {selectedPlayers.length > 0 && (
     <div className="bg-zinc-800 rounded-lg p-4 shadow-lg max-w-md mx-auto relative overflow-hidden">
       <div className="absolute inset-0 bg-gradient-to-br from-transparent via-transparent to-black opacity-30 pointer-events-none"></div>
       <div className="relative z-20">
         <ul className="space-y-2">
           {selectedPlayers.map((player, index) => (
             <li 
               key={player.ID}
               className="text-white flex justify-between items-center"
             >
               <span>{player.Name} ({player.Position})</span>
               <span>
                 ${player.Salary.toLocaleString()} (Eff: 
                 <span className={getEfficiencyColor(player.efficiency)}>
                   {player.efficiency.toFixed(3)}
                 </span>
                 )
               </span>
             </li>
           ))}
         </ul>
         <div className="mt-4 pt-2 border-t border-zinc-700">
           <p className="text-white font-semibold flex justify-between items-center">
             <span>Total Price:</span>
             <span>
               ${totalPrice.toLocaleString()} (Avg Eff: 
               <span className={getEfficiencyColor(averageEfficiency)}>
                 {averageEfficiency.toFixed(3)}
               </span>
               )
             </span>
           </p>
         </div>
       </div>
     </div>
   )}
      {buttonPressCount >= 5 && (
            <div className="mt-4">
              <Button
                onClick={handleLoadMore}
                className="bg-zinc-700 hover:bg-zinc-600 text-white px-4 py-2 rounded transition-all duration-200 ease-in-out hover:scale-105"
              >
                Load More Players
              </Button>
            </div>
          )}
      {showLoadMorePrompt && (
        <div className="absolute top-0 left-1/2 transform -translate-x-1/2 bg-green-500 text-white px-4 py-2 rounded-md shadow-lg transition-opacity duration-1000 opacity-0 animate-fade-in-out">
          More players loaded
        </div>
      )}
    </div>
  );
}

