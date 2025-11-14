// src/components/PositionFilterBar.tsx
'use client';

interface PositionFilterBarProps {
  selectedPosition: string | null;
  onPositionSelect: (pos: string) => void;
}

const positions = ["PG", "SG", "SF", "PF", "C"];

export function PositionFilterBar({ selectedPosition, onPositionSelect }: PositionFilterBarProps) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {positions.map((pos) => (
        <button
          key={pos}
          onClick={() => onPositionSelect(pos)}
          className={`px-4 py-2 rounded-md font-semibold transition ${
            selectedPosition === pos
              ? 'bg-blue-600 text-white'
              : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
          }`}
        >
          {pos}
        </button>
      ))}
    </div>
  );
}
