import { useEffect, useRef } from 'react';
import './PaintArtBackground.css';

/**
 * PaintArtBackground
 * Real-time digital painting engine simulating physical paintbrushes painting
 * acrylic/oil paint strokes across the canvas in rich artist pigments (terracotta,
 * ultramarine, ochre, amethyst, jade, titanium white) with bristle texture and
 * interactive user painting.
 */

// Rich artist mineral pigment palette
const ARTIST_PIGMENTS = [
  { name: 'terracotta', r: 202, g: 76, b: 36 },  // Brand terracotta
  { name: 'ultramarine', r: 48, g: 96, b: 228 }, // Lapis lazuli
  { name: 'ochre', r: 238, g: 162, b: 46 },      // Cadmium amber
  { name: 'amethyst', r: 142, g: 74, b: 220 },   // Royal violet
  { name: 'teal', r: 34, g: 172, b: 152 },       // Mineral jade
  { name: 'coral', r: 236, g: 94, b: 116 },      // Rose madder
  { name: 'titanium', r: 252, g: 250, b: 246 },  // Bone impasto
];

export default function PaintArtBackground() {
  const canvasRef = useRef(null);
  const animFrameRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let width = window.innerWidth;
    let height = window.innerHeight;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    // Persistent offscreen paint buffer
    let paintBuffer = document.createElement('canvas');
    let pCtx = paintBuffer.getContext('2d', { willReadFrequently: false });

    const setupDimensions = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.scale(dpr, dpr);

      // Preserve existing paint buffer contents during resize
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = paintBuffer.width || 1;
      tempCanvas.height = paintBuffer.height || 1;
      const tempCtx = tempCanvas.getContext('2d');
      if (tempCtx && paintBuffer.width > 0) {
        tempCtx.drawImage(paintBuffer, 0, 0);
      }

      paintBuffer.width = Math.floor(width * dpr);
      paintBuffer.height = Math.floor(height * dpr);
      pCtx = paintBuffer.getContext('2d');
      pCtx.scale(dpr, dpr);

      // Initial canvas fill with warm studio charcoal
      pCtx.fillStyle = '#16161a';
      pCtx.fillRect(0, 0, width, height);

      if (tempCtx && tempCanvas.width > 1) {
        pCtx.drawImage(tempCanvas, 0, 0, width, height);
      }
    };

    setupDimensions();
    window.addEventListener('resize', setupDimensions);

    // Pre-seed some beautiful initial dry paint strokes across the canvas
    const seedInitialStrokes = () => {
      for (let s = 0; s < 5; s++) {
        const pigment = ARTIST_PIGMENTS[s % ARTIST_PIGMENTS.length];
        const sx = width * (0.1 + Math.random() * 0.8);
        const sy = height * (0.1 + Math.random() * 0.8);
        let curX = sx;
        let curY = sy;
        let angle = Math.random() * Math.PI * 2;
        const strokeWidth = 45 + Math.random() * 40;
        const steps = 60 + Math.floor(Math.random() * 80);

        for (let i = 0; i < steps; i++) {
          angle += (Math.random() - 0.5) * 0.18;
          curX += Math.cos(angle) * 7;
          curY += Math.sin(angle) * 7;
          drawPaintDab(pCtx, curX, curY, strokeWidth, angle, pigment, 0.45);
        }
      }
    };

    // Stamping physical paint dab with multi-filament bristle striations
    const drawPaintDab = (targetCtx, x, y, brushSize, angle, pigment, opacity = 0.6) => {
      const bristles = 16;
      const halfSize = brushSize / 2;
      const cosAngle = Math.cos(angle + Math.PI / 2);
      const sinAngle = Math.sin(angle + Math.PI / 2);

      for (let b = 0; b < bristles; b++) {
        const bristleNorm = (b / (bristles - 1)) * 2 - 1; // -1 to 1
        const offset = bristleNorm * halfSize;

        // Bristle tip position perpendicular to stroke direction
        const bx = x + cosAngle * offset;
        const by = y + sinAngle * offset;

        // Bristle thickness and loading (denser in center, lighter at edges)
        const density = Math.exp(-Math.abs(bristleNorm) * 1.8);
        const radius = (brushSize * 0.12) * (0.6 + 0.6 * density);

        // Pigment jitter for realistic paint pigment variation
        const jitter = (Math.random() - 0.5) * 14;
        const r = Math.min(255, Math.max(0, pigment.r + jitter));
        const g = Math.min(255, Math.max(0, pigment.g + jitter));
        const bCol = Math.min(255, Math.max(0, pigment.b + jitter));

        targetCtx.beginPath();
        targetCtx.arc(bx, by, radius, 0, Math.PI * 2);
        targetCtx.fillStyle = `rgba(${r}, ${g}, ${bCol}, ${opacity * density})`;
        targetCtx.fill();
      }
    };

    seedInitialStrokes();

    // 4 Autonomous Virtual Paintbrushes
    class VirtualBrush {
      constructor(id) {
        this.id = id;
        this.reset();
      }

      reset() {
        this.x = width * (0.05 + Math.random() * 0.9);
        this.y = height * (0.05 + Math.random() * 0.9);
        this.angle = Math.random() * Math.PI * 2;
        this.targetAngle = this.angle;
        this.speed = 4.2 + Math.random() * 2.8;
        this.width = 42 + Math.random() * 45; // Broad 42px - 87px paint brush
        this.pigment = ARTIST_PIGMENTS[Math.floor(Math.random() * ARTIST_PIGMENTS.length)];
        this.stepsRemaining = 80 + Math.floor(Math.random() * 140);
        this.pauseTicks = Math.floor(Math.random() * 25);
        this.angularVelocity = (Math.random() - 0.5) * 0.08;
      }

      step() {
        if (this.pauseTicks > 0) {
          this.pauseTicks--;
          return;
        }

        // Steer brush smoothly
        this.angle += this.angularVelocity;
        if (Math.random() < 0.08) {
          this.angularVelocity = (Math.random() - 0.5) * 0.09;
        }

        // Keep brushes wandering on canvas with soft boundary steering
        const margin = 80;
        if (this.x < margin) this.angle += 0.12;
        if (this.x > width - margin) this.angle += 0.12;
        if (this.y < margin) this.angle += 0.12;
        if (this.y > height - margin) this.angle += 0.12;

        this.x += Math.cos(this.angle) * this.speed;
        this.y += Math.sin(this.angle) * this.speed;

        // Apply physical paint dab onto persistent paint buffer
        drawPaintDab(pCtx, this.x, this.y, this.width, this.angle, this.pigment, 0.48);

        this.stepsRemaining--;
        if (this.stepsRemaining <= 0) {
          this.reset();
        }
      }

      drawTip(renderCtx) {
        if (this.pauseTicks > 0) return;
        // Draw delicate floating brush tip / ferrule indicator
        const tipRadius = Math.max(3, this.width * 0.12);
        renderCtx.save();
        renderCtx.beginPath();
        renderCtx.arc(this.x, this.y, tipRadius, 0, Math.PI * 2);
        renderCtx.fillStyle = `rgba(${this.pigment.r}, ${this.pigment.g}, ${this.pigment.b}, 0.85)`;
        renderCtx.shadowColor = `rgba(${this.pigment.r}, ${this.pigment.g}, ${this.pigment.b}, 0.6)`;
        renderCtx.shadowBlur = 10;
        renderCtx.fill();
        renderCtx.restore();
      }
    }

    const brushes = [
      new VirtualBrush(0),
      new VirtualBrush(1),
      new VirtualBrush(2),
      new VirtualBrush(3),
    ];

    // Interactive User Brush
    const userBrush = {
      x: -1000,
      y: -1000,
      prevX: -1000,
      prevY: -1000,
      active: false,
      colorIndex: 0,
      width: 55,
    };

    const handleMouseMove = (e) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;

      if (userBrush.active && userBrush.prevX > 0) {
        const dx = x - userBrush.prevX;
        const dy = y - userBrush.prevY;
        const dist = Math.hypot(dx, dy);
        const angle = Math.atan2(dy, dx);
        const pigment = ARTIST_PIGMENTS[userBrush.colorIndex % ARTIST_PIGMENTS.length];

        // Interpolate along movement vector for buttery continuous paint
        const steps = Math.max(1, Math.floor(dist / 5));
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          const ix = userBrush.prevX + dx * t;
          const iy = userBrush.prevY + dy * t;
          drawPaintDab(pCtx, ix, iy, userBrush.width, angle, pigment, 0.65);
        }
      } else {
        userBrush.active = true;
      }

      userBrush.prevX = x;
      userBrush.prevY = y;
      userBrush.x = x;
      userBrush.y = y;
    };

    const handleMouseDown = () => {
      // Cycle pigment color on click/drag
      userBrush.colorIndex = (userBrush.colorIndex + 1) % ARTIST_PIGMENTS.length;
      userBrush.width = 65; // Thicker impasto dab on click
    };

    const handleMouseUp = () => {
      userBrush.width = 50;
    };

    const handleMouseLeave = () => {
      userBrush.active = false;
      userBrush.prevX = -1000;
      userBrush.prevY = -1000;
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    window.addEventListener('mouseleave', handleMouseLeave);

    let frameCount = 0;

    const render = () => {
      frameCount++;

      // Advance autonomous virtual brushes
      for (const brush of brushes) {
        brush.step();
      }

      // Ultra-slow, imperceptible aging/drying wash to prevent saturation over long sessions
      if (frameCount % 4 === 0) {
        pCtx.fillStyle = 'rgba(22, 22, 26, 0.003)';
        pCtx.fillRect(0, 0, width, height);
      }

      // Render offscreen paint buffer onto visible canvas
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(paintBuffer, 0, 0, width, height);

      // Draw active brush tips
      for (const brush of brushes) {
        brush.drawTip(ctx);
      }

      // Draw subtle user brush tip indicator when active
      if (userBrush.active && userBrush.x > 0) {
        const pigment = ARTIST_PIGMENTS[userBrush.colorIndex % ARTIST_PIGMENTS.length];
        ctx.save();
        ctx.beginPath();
        ctx.arc(userBrush.x, userBrush.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${pigment.r}, ${pigment.g}, ${pigment.b}, 0.9)`;
        ctx.shadowColor = `rgba(${pigment.r}, ${pigment.g}, ${pigment.b}, 0.5)`;
        ctx.shadowBlur = 8;
        ctx.fill();
        ctx.restore();
      }

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      window.removeEventListener('resize', setupDimensions);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
      window.removeEventListener('mouseleave', handleMouseLeave);
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, []);

  return (
    <div className="paint-art-bg" aria-hidden="true">
      <canvas ref={canvasRef} className="paint-art-bg__canvas" />
      {/* Textured Linen Canvas Noise Filter */}
      <svg className="paint-art-bg__filter-svg">
        <filter id="canvas-texture">
          <feTurbulence type="fractalNoise" baseFrequency="0.04" numOctaves="4" result="noise" />
          <feColorMatrix
            type="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.04 0"
          />
        </filter>
      </svg>
      <div className="paint-art-bg__texture-overlay" />
      <div className="paint-art-bg__vignette" />
    </div>
  );
}
