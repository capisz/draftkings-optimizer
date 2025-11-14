// src/components/Header.tsx
'use client';

import React from 'react';

export function Header() {
  return (
    <header className="w-full bg-zinc-900 border-b border-zinc-700 py-4 mb-6 shadow-md">
      <div className="container mx-auto px-6 flex flex-col sm:flex-row items-center justify-between">
        <h1 className="text-2xl font-bold text-white tracking-wide">
          DraftKings NBA Recommendations
        </h1>
        <p className="text-sm text-zinc-400 mt-2 sm:mt-0">
          Efficiency-based Top 5 Player Generator
        </p>
      </div>
    </header>
  );
}
