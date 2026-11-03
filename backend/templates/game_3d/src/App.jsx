// TEMPORARY PREVIEW PLACEHOLDER: The agent will replace this starter brick-breaker game with the user's requested 3D game.
import React from 'react';
import { LogoBrickBreaker } from './components/game/LogoBrickBreaker';
import { HUD } from './components/ui/HUD';

export default function App() {
  return (
    <div className="relative w-full h-full bg-[#09090b] text-zinc-100 overflow-hidden font-sans select-none">
      <LogoBrickBreaker />
      <HUD />
    </div>
  );
}
