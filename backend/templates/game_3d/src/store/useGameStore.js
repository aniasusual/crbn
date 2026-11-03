import { create } from 'zustand';

export const useGameStore = create((set, get) => ({
  score: 0,
  highScore: 0,
  bricksRemaining: 220,
  totalBricks: 220,
  isAutoPilot: true,
  isBallAttached: true,
  combo: 0,
  addScore: (points = 100) => {
    set((state) => {
      const newScore = state.score + points;
      return {
        score: newScore,
        highScore: Math.max(state.highScore, newScore),
        combo: state.combo + 1
      };
    });
  },

  resetCombo: () => set({ combo: 0 }),

  setBricksRemaining: (count) => set({ bricksRemaining: count }),
  setTotalBricks: (count) => set({ totalBricks: count, bricksRemaining: count }),

  brickDestroyed: () => {
    set((state) => {
      const nextRemaining = Math.max(0, state.bricksRemaining - 1);
      const points = 100 + state.combo * 20;
      const newScore = state.score + points;
      return {
        bricksRemaining: nextRemaining,
        score: newScore,
        highScore: Math.max(state.highScore, newScore),
        combo: state.combo + 1
      };
    });
  },

  setAutoPilot: (isAuto) => set({ isAutoPilot: isAuto }),
  setBallAttached: (isAttached) => set({ isBallAttached: isAttached }),

  resetGame: () => {
    set((state) => ({
      score: 0,
      combo: 0,
      bricksRemaining: state.totalBricks,
      isAutoPilot: true
    }));
  }
}));
