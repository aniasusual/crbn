// TEMPORARY PREVIEW PLACEHOLDER: The agent will replace this with your application.
import React from 'react';
import { MatrixRain } from '@/components/ui/matrix-rain';
import { DitheredLogo } from '@/components/ui/dithered-logo';
import logoImg from './assets/imagelogo.png';

export default function App() {
  return (
    <div className="degrees-canvas">
      {/* Matrix Rain Background */}
      <div className="degrees-matrix-bg" aria-hidden="true">
        <MatrixRain
          fixedColor="#ec4899"
          speed={80}
          fontSize={20}
        />
      </div>

      {/* Atmospheric Depth Vignette */}
      <div className="degrees-bg-overlay" aria-hidden="true" />

      {/* Centerpiece Content */}
      <main className="degrees-hero">
        {/* Interactive Dithered Logo Canvas */}
        
        <div className="h-[300px] w-full flex items-center justify-center">
          <DitheredLogo
            imageSrc={logoImg}
            className="h-full w-full"
            gridSize={200}
            scale={0.36}
            dotScale={1}
            cornerRadius={0.2}
            gamma={1.0}
            blur={3.75}
            diffusionStrength={0.5}
            innerColor="#ffffff"
            outerColor="#ea580c"
          />
        </div>

        {/* Clean, Crisp Standing By Copy */}
        <div className="degrees-hero-content">
          <h1 className="degrees-hero-title">Standing by</h1>
          <p className="degrees-hero-desc">Your preview will appear here.</p>
        </div>
      </main>
    </div>
  );
}
