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
  const contextWindow = telemetry?.context_window || 131072;
  const usagePct = telemetry?.usage_pct !== undefined ? telemetry.usage_pct : Math.round((totalTokens / contextWindow) * 100);
  const squashPct = telemetry?.squash_threshold_pct ?? 70;
  const compactPct = telemetry?.compact_threshold_pct ?? 80;
  const status = telemetry?.status || (usagePct >= compactPct ? 'critical' : usagePct >= squashPct ? 'warning' : 'normal');

  const formatTokens = (val) => {
    if (val >= 1000) {
      return `${(val / 1000).toFixed(1)}k`;
    }
    return String(val);
  };

  const ramFiles = telemetry?.virtual_ram_files || 0;
  const ramTokens = telemetry?.virtual_ram_tokens || 0;
  const staticTokens = telemetry?.static_tokens || 0;
  const ephemeralTokens = telemetry?.ephemeral_tokens || 0;
  const schemaTokens = telemetry?.schema_tokens || 0;
  const providerPromptTokens = telemetry?.provider_prompt_tokens || 0;
  const remainingHeadroom = Math.max(0, contextWindow - totalTokens);
  const squashed = Boolean(telemetry?.squashed);
  const evicted = Boolean(telemetry?.evicted);
  const rolledUp = Boolean(telemetry?.rolled_up);
  return (
    <div className={`context-gauge context-gauge--placement-${placement}`} ref={containerRef}>
      <button
        type="button"
        className={`context-gauge__btn ${isOpen ? 'context-gauge__btn--active' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title="Context Window Utilization (CP-106)"
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
            <span className="context-gauge__popover-title">
              Context Window
            </span>
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
              <span className="context-gauge__row-key">
                Total Usage
              </span>
              <span className="context-gauge__row-val">
                {totalTokens.toLocaleString()} / {contextWindow.toLocaleString()} ({usagePct}%)
              </span>
            </div>

            <div className="context-gauge__row">
              <span className="context-gauge__row-key">
                Headroom
              </span>
              <span className="context-gauge__row-val">
                {remainingHeadroom.toLocaleString()} tokens
              </span>
            </div>

            <div className="context-gauge__row">
              <span className="context-gauge__row-key">
                Static Layer
              </span>
              <span className="context-gauge__row-val">
                {staticTokens.toLocaleString()} tokens
              </span>
            </div>

            <div className="context-gauge__row">
              <span className="context-gauge__row-key">
                Virtual RAM
              </span>
              <span className="context-gauge__row-val">
                {ramTokens.toLocaleString()} tokens ({ramFiles} {ramFiles === 1 ? 'file' : 'files'})
              </span>
            </div>

            {telemetry?.virtual_ram_files_list && telemetry.virtual_ram_files_list.length > 0 && (
              <div className="context-gauge__ram-files">
                {telemetry.virtual_ram_files_list.map((filePath) => (
                  <span key={filePath} className="context-gauge__ram-file-chip" title={filePath}>
                    {filePath.split('/').pop()}
                  </span>
                ))}
              </div>
            )}

            <div className="context-gauge__row">
              <span className="context-gauge__row-key">
                Ephemeral Turns
              </span>
              <span className="context-gauge__row-val">
                {ephemeralTokens.toLocaleString()} tokens
              </span>
            </div>

            {schemaTokens > 0 && (
              <div className="context-gauge__row">
                <span className="context-gauge__row-key">
                  Tool Schemas
                </span>
                <span className="context-gauge__row-val">
                  {schemaTokens.toLocaleString()} tokens
                </span>
              </div>
            )}

            {providerPromptTokens > 0 && (
              <div className="context-gauge__row">
                <span className="context-gauge__row-key">
                  Ollama Prompt
                </span>
                <span className="context-gauge__row-val">
                  {providerPromptTokens.toLocaleString()} tokens
                </span>
              </div>
            )}

            <div className="context-gauge__divider" />

            <div className="context-gauge__row">
              <span className="context-gauge__row-key">
                Squash Threshold
              </span>
              <span className="context-gauge__row-val">
                {squashPct}% ({((contextWindow * squashPct / 100) / 1000).toFixed(1)}k)
              </span>
            </div>

            <div className="context-gauge__row">
              <span className="context-gauge__row-key">
                Compact Threshold
              </span>
              <span className="context-gauge__row-val">
                {compactPct}% ({((contextWindow * compactPct / 100) / 1000).toFixed(1)}k)
              </span>
            </div>

            {status !== 'normal' && (squashed || evicted || rolledUp) && (
              <div className="context-gauge__alert">
                {evicted
                  ? 'Macro-compaction active: earlier turns summarized at atomic boundary.'
                  : squashed
                  ? 'In-loop tool squashing active to preserve context headroom.'
                  : 'Milestone roll-up collapsed resolved intermediate failure loops.'}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
