import React, { useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import logoBricksData from './logoBricksData.json';
import { useGameStore } from '../../store/useGameStore';

// Subtle, elegant audio click
function playChime(freq = 480) {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 1.3, ctx.currentTime + 0.05);
    gain.gain.setValueAtTime(0.025, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.08);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.08);
  } catch {}
}

function GameField({ onReset }) {
  const brickDestroyed = useGameStore((s) => s.brickDestroyed);
  const resetCombo = useGameStore((s) => s.resetCombo);
  const setTotalBricks = useGameStore((s) => s.setTotalBricks);
  const setAutoPilot = useGameStore((s) => s.setAutoPilot);
  const isBallAttached = useGameStore((s) => s.isBallAttached);
  const setBallAttached = useGameStore((s) => s.setBallAttached);

  // Ball stuck-on-rod state
  const isBallAttachedRef = useRef(true);
  // Brick state tracking
  const [activeIds, setActiveIds] = useState(() => new Set(logoBricksData.map((b) => b.id)));
  const activeIdsRef = useRef(activeIds);
  activeIdsRef.current = activeIds;

  useEffect(() => {
    setTotalBricks(logoBricksData.length);
  }, [setTotalBricks]);

  // Physical boundaries
  const bounds = useMemo(() => ({
    minX: -3.5,
    maxX: 3.5,
    maxY: 3.4,
    minY: -4.0,
  }), []);

  // Brick dimensions
  const brickSize = useMemo(() => ({ w: 0.165, h: 0.165, d: 0.12 }), []);

  // Paddle state
  const paddleRef = useRef({
    x: 0,
    targetX: 0,
    y: -3.3,
    w: 1.8,
    h: 0.12,
    d: 0.2,
  });

  // Ball state (initially rested on the rod)
  const ballRef = useRef({
    x: 0,
    y: -3.3 + 0.06 + 0.14 + 0.02,
    vx: 0,
    vy: 0,
    radius: 0.14,
    speed: 6.4,
  });
  const lastUserInteraction = useRef(0);
  const pointerX = useRef(0);

  // Mesh refs
  const paddleMesh = useRef();
  const ballMesh = useRef();
  // Launch ball from the rod
  const launchBall = () => {
    if (!isBallAttachedRef.current) return;
    isBallAttachedRef.current = false;
    setBallAttached(false);

    const ball = ballRef.current;
    const spread = (Math.random() - 0.5) * 2.8;
    ball.vx = spread;
    ball.vy = Math.sqrt(Math.max(16, ball.speed * ball.speed - spread * spread));
    playChime(540);
  };

  // Pointer & keyboard listener
  useEffect(() => {
    const handlePointerDown = () => {
      lastUserInteraction.current = performance.now();
      setAutoPilot(false);
      launchBall();
    };

    const handlePointerMove = (e) => {
      lastUserInteraction.current = performance.now();
      setAutoPilot(false);
      const ratio = (e.clientX / window.innerWidth) * 2 - 1;
      pointerX.current = ratio * 3.3;
    };

    const handleKeyDown = (e) => {
      lastUserInteraction.current = performance.now();
      setAutoPilot(false);
      if (e.key === ' ' || e.code === 'Space') {
        launchBall();
      } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
        pointerX.current = Math.max(bounds.minX, pointerX.current - 0.5);
      } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
        pointerX.current = Math.min(bounds.maxX, pointerX.current + 0.5);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [setAutoPilot, bounds]);

  // Simulation Loop with multi-substepping for zero-tunneling precision
  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05);
    const now = performance.now();
    const ball = ballRef.current;
    const paddle = paddleRef.current;

    // Paddle Auto-pilot vs Manual
    const isIdle = now - lastUserInteraction.current > 1800;
    if (isIdle) {
      setAutoPilot(true);
      paddle.targetX = THREE.MathUtils.lerp(paddle.targetX, ball.x, dt * 7.5);
    } else {
      paddle.targetX = pointerX.current;
    }

    paddle.targetX = THREE.MathUtils.clamp(
      paddle.targetX,
      bounds.minX + paddle.w / 2,
      bounds.maxX - paddle.w / 2
    );
    paddle.x = THREE.MathUtils.lerp(paddle.x, paddle.targetX, dt * 20);

    if (paddleMesh.current) {
      paddleMesh.current.position.x = paddle.x;
      paddleMesh.current.position.y = paddle.y;
    }

    // If ball is stuck on rod, track paddle position and wait for release
    if (isBallAttachedRef.current) {
      ball.x = paddle.x;
      ball.y = paddle.y + paddle.h / 2 + ball.radius + 0.02;
      ball.vx = 0;
      ball.vy = 0;

      if (ballMesh.current) {
        ballMesh.current.position.set(ball.x, ball.y, 0);
      }

      // Auto-launch after 4s idle on first load so preview demonstrates action
      if (isIdle && now - lastUserInteraction.current > 4000) {
        launchBall();
      }
      return;
    }

    // 4 physics sub-steps per frame
    const steps = 4;
    const subDt = dt / steps;

    for (let step = 0; step < steps; step++) {
      ball.x += ball.vx * subDt;
      ball.y += ball.vy * subDt;

      // Left & Right wall bounces
      if (ball.x - ball.radius <= bounds.minX) {
        ball.x = bounds.minX + ball.radius;
        ball.vx = Math.abs(ball.vx);
        playChime(340);
      } else if (ball.x + ball.radius >= bounds.maxX) {
        ball.x = bounds.maxX - ball.radius;
        ball.vx = -Math.abs(ball.vx);
        playChime(340);
      }

      // Top wall bounce
      if (ball.y + ball.radius >= bounds.maxY) {
        ball.y = bounds.maxY - ball.radius;
        ball.vy = -Math.abs(ball.vy);
        playChime(380);
      }

      // Bottom fall (fail) -> appear stuck again on rod
      if (ball.y < bounds.minY) {
        isBallAttachedRef.current = true;
        setBallAttached(true);
        ball.x = paddle.x;
        ball.y = paddle.y + paddle.h / 2 + ball.radius + 0.02;
        ball.vx = 0;
        ball.vy = 0;
        resetCombo();
        playChime(220);
        break;
      }

      // Paddle collision
      if (
        ball.vy < 0 &&
        ball.y - ball.radius <= paddle.y + paddle.h / 2 &&
        ball.y + ball.radius >= paddle.y - paddle.h / 2 &&
        ball.x >= paddle.x - paddle.w / 2 - ball.radius * 0.8 &&
        ball.x <= paddle.x + paddle.w / 2 + ball.radius * 0.8
      ) {
        ball.y = paddle.y + paddle.h / 2 + ball.radius;
        const offset = (ball.x - paddle.x) / (paddle.w / 2);
        const angle = offset * (Math.PI / 3.2); // max ~55 deg bounce
        ball.vx = Math.sin(angle) * ball.speed;
        ball.vy = Math.cos(angle) * ball.speed;
        playChime(420);
        break;
      }

      // Brick collisions
      const currentSet = activeIdsRef.current;
      const halfW = brickSize.w / 2 + ball.radius;
      const halfH = brickSize.h / 2 + ball.radius;

      for (let i = 0; i < logoBricksData.length; i++) {
        const b = logoBricksData[i];
        if (!currentSet.has(b.id)) continue;

        if (
          ball.x >= b.x - halfW &&
          ball.x <= b.x + halfW &&
          ball.y >= b.y - halfH &&
          ball.y <= b.y + halfH
        ) {
          // Remove brick
          currentSet.delete(b.id);
          setActiveIds(new Set(currentSet));
          brickDestroyed();

          // Reflect ball velocity
          const overlapX = halfW - Math.abs(ball.x - b.x);
          const overlapY = halfH - Math.abs(ball.y - b.y);

          if (overlapX < overlapY) {
            ball.vx = (ball.x > b.x ? 1 : -1) * Math.abs(ball.vx);
          } else {
            ball.vy = (ball.y > b.y ? 1 : -1) * Math.abs(ball.vy);
          }

          playChime(500 + Math.random() * 120);

          // If all bricks cleared, trigger respawn after 1.2s
          if (currentSet.size === 0) {
            setTimeout(() => {
              const freshSet = new Set(logoBricksData.map((item) => item.id));
              setActiveIds(freshSet);
              activeIdsRef.current = freshSet;
            }, 1200);
          }
          break;
        }
      }
    }

    if (ballMesh.current) {
      ballMesh.current.position.set(ball.x, ball.y, 0);
    }
  });

  return (
    <>
      <ambientLight intensity={0.8} />
      <directionalLight position={[0, 6, 8]} intensity={1.2} />

      {/* Logo Bricks */}
      {logoBricksData.map((brick) => {
        if (!activeIds.has(brick.id)) return null;
        return (
          <mesh key={brick.id} position={[brick.x, brick.y, 0]}>
            <boxGeometry args={[brickSize.w, brickSize.h, brickSize.d]} />
            <meshStandardMaterial
              color="#b2451f"
              roughness={0.3}
              metalness={0.2}
            />
          </mesh>
        );
      })}

      {/* Paddle */}
      <mesh ref={paddleMesh} position={[0, -3.3, 0]}>
        <boxGeometry args={[paddleRef.current.w, paddleRef.current.h, paddleRef.current.d]} />
        <meshStandardMaterial
          color="#d4d4d8"
          roughness={0.2}
          metalness={0.8}
        />
      </mesh>

      {/* Ball */}
      <mesh ref={ballMesh} position={[0, -2.8, 0]}>
        <sphereGeometry args={[0.14, 20, 20]} />
        <meshStandardMaterial
          color="#ffffff"
          roughness={0.1}
          metalness={0.9}
        />
      </mesh>
    </>
  );
}

export function LogoBrickBreaker() {
  return (
    <div className="absolute inset-0 w-full h-full select-none">
      <Canvas
        camera={{ position: [0, 0, 9.8], fov: 44 }}
        gl={{ antialias: true, alpha: true }}
      >
        <GameField />
      </Canvas>
    </div>
  );
}
