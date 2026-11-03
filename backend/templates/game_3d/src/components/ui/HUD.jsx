import React from 'react';
import { useGameStore } from '../../store/useGameStore';

export function HUD() {
  const bricksRemaining = useGameStore((s) => s.bricksRemaining);
  const totalBricks = useGameStore((s) => s.totalBricks);
  const isAutoPilot = useGameStore((s) => s.isAutoPilot);
  const isBallAttached = useGameStore((s) => s.isBallAttached);
  const score = useGameStore((s) => s.score);

  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-6 sm:p-8">
      {/* Minimal Top Header */}
      <header className="flex items-center justify-between w-full">
        <div className="font-mono text-[11px] tracking-wider text-zinc-500 uppercase">
          80degrees • 3d game
        </div>

        <div className="flex items-center gap-3 font-mono text-[11px] text-zinc-500">
          <span>{score} PTS</span>
          <span className="text-zinc-700">/</span>
          <span>{bricksRemaining} BRICKS</span>
        </div>
      </header>

      {/* Elegant Standing By Centerpiece */}
      <div className="pointer-events-none flex flex-col items-center justify-center text-center mt-24 sm:mt-28 select-none">
        <h1 className="font-mono text-base sm:text-lg font-medium tracking-tight text-zinc-100 m-0">
          Standing by
        </h1>
        <p className="font-sans text-xs sm:text-sm text-zinc-500 mt-1">
          Your preview will appear here
        </p>
      </div>

      {/* Quiet Bottom Footer */}
      <footer className="flex items-center justify-center w-full">
        <div className="flex items-center gap-2 text-[11px] font-sans">
          {isBallAttached ? (
            <span className="text-zinc-300 font-medium tracking-wide">
              Click to release ball
            </span>
          ) : (
            <span className="text-zinc-500">
              Move cursor or A / D keys
            </span>
          )}
          <span className="text-zinc-800">•</span>
          <span className={isAutoPilot ? 'text-zinc-600' : 'text-zinc-400'}>
            {isAutoPilot ? 'Auto-pilot' : 'Manual'}
          </span>
        </div>
      </footer>
    </div>
  );
}
