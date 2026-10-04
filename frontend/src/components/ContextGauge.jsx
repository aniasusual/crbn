import React, { useState, useRef, useEffect } from 'react';
import './ContextGauge.css';

export default function ContextGauge({ telemetry, placement = 'top' }) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef(null);

  // Close on outside click
  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isOpen]);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  const totalTokens = telemetry?.total_tokens ?? 0;
  const contextWindow = telemetry?.context_window || 1048576;
  const usagePct =
    telemetry?.usage_pct !== undefined
      ? telemetry.usage_pct
      : Math.round((totalTokens / contextWindow) * 100);
  const status =
    telemetry?.status ||
    (usagePct >= 80 ? 'critical' : usagePct >= 70 ? 'warning' : 'normal');

  const formatTokens = (val) => {
    if (val >= 1000000) {
      return `${(val / 1000000).toFixed(1)}M`;
    }
    if (val >= 1000) {
      return `${(val / 1000).toFixed(1)}k`;
    }
    return String(val);
  };

  const remainingTokens = Math.max(0, contextWindow - totalTokens);

  return (
    <div className={`context-gauge context-gauge--placement-${placement}`} ref={containerRef}>
      <button
        type="button"
        className={`context-gauge__btn ${isOpen ? 'context-gauge__btn--active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Context Window Utilization"
        aria-expanded={isOpen}
      >
        <span className={`context-gauge__dot context-gauge__dot--${status}`} />
        <span className="context-gauge__label">
          {formatTokens(totalTokens)} / {formatTokens(contextWindow)}
        </span>
        <span className="context-gauge__pct">{usagePct}%</span>
        <svg
          className={`context-gauge__btn-arrow ${isOpen ? 'context-gauge__btn-arrow--open' : ''}`}
          width="9"
          height="9"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
        >
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      </button>

      {isOpen && (
        <div className="context-gauge__popover">
          <div className="context-gauge__arrow" />
          <div className="context-gauge__popover-header">
            <span className="context-gauge__popover-title">Context Window</span>
            <span className={`context-gauge__popover-status context-gauge__popover-status--${status}`}>
              {status}
            </span>
          </div>

          <div className="context-gauge__track">
            <div
              className={`context-gauge__fill context-gauge__fill--${status}`}
              style={{ width: `${Math.min(100, Math.max(2, usagePct))}%` }}
            />
          </div>

          <div className="context-gauge__table">
            <div className="context-gauge__row">
              <span className="context-gauge__row-key">Used</span>
              <span className="context-gauge__row-val">
                {totalTokens.toLocaleString()} tokens ({usagePct}%)
              </span>
            </div>

            <div className="context-gauge__row">
              <span className="context-gauge__row-key">Available</span>
              <span className="context-gauge__row-val">
                {remainingTokens.toLocaleString()} tokens
              </span>
            </div>

            <div className="context-gauge__row">
              <span className="context-gauge__row-key">Capacity</span>
              <span className="context-gauge__row-val">
                {contextWindow.toLocaleString()} tokens
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
