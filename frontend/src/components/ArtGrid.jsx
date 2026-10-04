import { useState, useEffect, useCallback, useRef } from 'react';
import './ArtGrid.css';

/**
 * Curated abstract art from Unsplash with varying heights for masonry effect.
 */
const ART_URLS = [
  'https://images.unsplash.com/photo-1541701494587-cb58502866ab?w=600&h=800&fit=crop',
  'https://images.unsplash.com/photo-1549490349-8643362247b5?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=600&h=900&fit=crop',
  'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=600&h=500&fit=crop',
  'https://images.unsplash.com/photo-1579546929518-9e396f3cc809?w=600&h=700&fit=crop',
  'https://images.unsplash.com/photo-1567095761054-7a02e69e5c43?w=600&h=450&fit=crop',
  'https://images.unsplash.com/photo-1558618666-fcd25c85f82e?w=600&h=850&fit=crop',
  'https://images.unsplash.com/photo-1604076913837-52ab5f0e2f20?w=600&h=600&fit=crop',
  'https://images.unsplash.com/photo-1543857778-c4a1a3e0b2eb?w=600&h=750&fit=crop',
  'https://images.unsplash.com/photo-1509114397022-ed747cca3f65?w=600&h=550&fit=crop',
  'https://images.unsplash.com/photo-1574169208507-84376144848b?w=600&h=950&fit=crop',
  'https://images.unsplash.com/photo-1550859492-d5da9d8e45f3?w=600&h=400&fit=crop',
  'https://images.unsplash.com/photo-1515405295579-ba7b45403062?w=600&h=800&fit=crop',
  'https://images.unsplash.com/photo-1533158326339-7f3cf2404354?w=600&h=500&fit=crop',
  'https://images.unsplash.com/photo-1501436513145-30f24e19fcc8?w=600&h=700&fit=crop',
  'https://images.unsplash.com/photo-1551913902-c92207136625?w=600&h=650&fit=crop',
  'https://images.unsplash.com/photo-1519681393784-d120267933ba?w=600&h=900&fit=crop',
  'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600&h=450&fit=crop',
];

// Massively increase grid size so we over-render to guarantee no missing blocks at the bottom
const GRID_SIZE = 48; 
const SWAP_INTERVAL_MS = 3000;

export default function ArtGrid() {
  // Track which URL each cell is currently showing
  const [cells, setCells] = useState(() => {
    // Generate enough cells to overfill the grid
    return Array.from({ length: GRID_SIZE }).map((_, i) => ({
      url: ART_URLS[i % ART_URLS.length],
      failed: false
    }));
  });

  // Track which cells are in the middle of a crossfade
  const [exitingCells, setExitingCells] = useState(() => new Map());

  // Keep a pool index for picking the next unused image
  const poolIndexRef = useRef(GRID_SIZE);

  const getNextUrl = useCallback(() => {
    const idx = poolIndexRef.current % ART_URLS.length;
    poolIndexRef.current += 1;
    return ART_URLS[idx];
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const cellIndex = Math.floor(Math.random() * GRID_SIZE);
      const oldCell = cells[cellIndex];
      const newUrl = getNextUrl();

      if (oldCell.url === newUrl) return;

      setExitingCells((prev) => {
        const next = new Map(prev);
        next.set(cellIndex, oldCell.url);
        return next;
      });

      setCells((prev) => {
        const next = [...prev];
        next[cellIndex] = {
          url: newUrl,
          failed: false
        };
        return next;
      });

      setTimeout(() => {
        setExitingCells((prev) => {
          const next = new Map(prev);
          next.delete(cellIndex);
          return next;
        });
      }, 1300);
    }, SWAP_INTERVAL_MS);

    return () => clearInterval(interval);
  }, [cells, getNextUrl]);

  const handleImageError = (index) => {
    setCells(prev => {
      const next = [...prev];
      next[index] = { ...next[index], failed: true };
      return next;
    });
  };

  return (
    <>
      <div className="art-grid">
        {cells.map((cell, i) => (
          <div 
            className="art-grid__cell" 
            key={i} 
            // Removed random colors: background defaults to transparent/black via CSS
          >
            <img 
              className={`art-grid__img ${cell.failed ? 'art-grid__img--failed' : ''}`} 
              src={cell.url} 
              alt="" 
              loading="lazy"
              onError={() => handleImageError(i)}
            />
            {exitingCells.has(i) && (
              <img
                className="art-grid__img art-grid__img--exiting"
                src={exitingCells.get(i)}
                alt=""
              />
            )}
          </div>
        ))}
      </div>
      <div className="art-grid__overlay" />
    </>
  );
}
