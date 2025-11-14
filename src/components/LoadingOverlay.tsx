"use client";

interface LoadingProps {
  progress: number; // 0 → 100
}

export default function LoadingOverlay({ progress }: LoadingProps) {
  return (
    <div className="fixed inset-0 bg-black/75 flex flex-col items-center justify-center z-[9999] backdrop-blur-sm">
      {/* Spinning crown */}
      <img
        src="/dk-crown.png"
        alt="DK Crown"
        className="w-20 h-20 mb-4 loading-spin drop-shadow-xl"
      />

      <div className="text-white text-xl font-semibold mb-4">
        Generating optimized lineup…
      </div>

      {/* Progress bar container */}
      <div className="w-72 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl overflow-hidden">
        <div className="h-2 bg-zinc-800 relative">
          {/* actual progress bar */}
          <div
            className="absolute left-0 top-0 h-full bg-lime-500 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* % text below bar */}
      <div className="text-sm text-zinc-400 mt-2">
        {Math.floor(progress)}%
      </div>
    </div>
  );
}
