"use client";

import React, { useState } from "react";

interface GenerateTeamButtonProps {
  onGenerate: () => Promise<void>; // your team generation logic
}

export function GenerateTeamButton({ onGenerate }: GenerateTeamButtonProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);

  const handleClick = async () => {
    if (isGenerating) return; // prevent double-click spam

    setIsGenerating(true);
    setProgress(0);

    try {
      const generatePromise = onGenerate();

      // single interval that smoothly increments progress
      const interval = setInterval(() => {
        setProgress((prev) => {
          if (prev >= 90) return prev; // hang around 90% until done
          return prev + 4;
        });
      }, 120);

      await generatePromise;

      clearInterval(interval);
      setProgress(100);
    } catch (err) {
      console.error(err);
      setProgress(0);
    } finally {
      setTimeout(() => {
        setIsGenerating(false);
        setProgress(0);
      }, 500);
    }
  };

  return (
    <div className="w-full">
      <button
        onClick={handleClick}
        disabled={isGenerating}
        className="w-full py-3 rounded-xl bg-lime-400 text-black font-semibold hover:bg-lime-300 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
      >
        {isGenerating ? "Generating team..." : "Generate Optimal Team"}
      </button>

      {isGenerating && (
        <div className="mt-3 w-full h-2 bg-neutral-800 rounded-full overflow-hidden">
          <div
            className="h-2 bg-lime-400 rounded-full transition-[width] duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  );
}
