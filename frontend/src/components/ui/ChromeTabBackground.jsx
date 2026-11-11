import React from 'react';
import './ChromeTabBackground.css';

/**
 * ChromeTabBackground
 * Renders pure borderless outward corner flares (wings)
 * connecting the active tab smoothly to the bottom baseline.
 */
export default function ChromeTabBackground({ className = '' }) {
  return (
    <>
      <svg
        className={`chrome-tab-flare chrome-tab-flare--left ${className}`}
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden="true"
        shapeRendering="geometricPrecision"
      >
        <path
          className="chrome-tab-flare__path"
          d="M 0 10 A 10 10 0 0 0 10 0 L 10 10 Z"
        />
      </svg>
      <svg
        className={`chrome-tab-flare chrome-tab-flare--right ${className}`}
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        aria-hidden="true"
        shapeRendering="geometricPrecision"
      >
        <path
          className="chrome-tab-flare__path"
          d="M 0 0 A 10 10 0 0 0 10 10 L 0 10 Z"
        />
      </svg>
    </>
  );
}
