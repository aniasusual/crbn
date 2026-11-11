import React, { useEffect, useState } from 'react';
import './QueuedMessagesCard.css';

const ChevronIcon = ({ expanded }) => (
  <svg
    className={`queue-card__chevron ${expanded ? 'queue-card__chevron--up' : ''}`}
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CloseIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export default function QueuedMessagesCard({
  items = [],
  liveSteered = 0,
  onRemove,
  hasOverlay = false,
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedDuringOverlay, setExpandedDuringOverlay] = useState(false);

  useEffect(() => {
    if (!hasOverlay) {
      setExpandedDuringOverlay(false);
    }
  }, [hasOverlay]);

  if (!Array.isArray(items) || items.length === 0) return null;

  const effectiveExpanded = hasOverlay ? expandedDuringOverlay : isExpanded;
  const firstPreview = (items[0]?.text || '').replace(/\s+/g, ' ').trim();

  const handleToggle = () => {
    if (hasOverlay) {
      setExpandedDuringOverlay((prev) => !prev);
    } else {
      setIsExpanded((prev) => !prev);
    }
  };

  return (
    <section
      className={`queue-card ${effectiveExpanded ? 'queue-card--expanded' : 'queue-card--collapsed'}`}
      aria-label="Queued messages"
    >
      <div className="queue-card__header">
        <button
          type="button"
          className="queue-card__header-toggle"
          onClick={handleToggle}
          aria-expanded={effectiveExpanded}
          title={effectiveExpanded ? 'Collapse queued messages' : 'Expand queued messages'}
        >
          <span className="queue-card__header-left">
            <span className="queue-card__title">Queued</span>
            {!effectiveExpanded && firstPreview && (
              <span className="queue-card__preview" title={items[0]?.text}>
                {firstPreview}
              </span>
            )}
          </span>
          <span className="queue-card__header-right">
            <span className="queue-card__count">{items.length}</span>
            <ChevronIcon expanded={effectiveExpanded} />
          </span>
        </button>
      </div>

      {effectiveExpanded && (
        <div className="queue-card__body">
          {items.map((item, idx) => {
            const isSteer = item.type === 'steering';
            const isLiveSteered = isSteer && idx < liveSteered;

            return (
              <div key={`${item.type}-${idx}-${item.text.slice(0, 24)}`} className="queue-card__item">
                <span className="queue-card__index">{idx + 1}.</span>
                <span className="queue-card__item-text">{item.text}</span>
                <span className="queue-card__item-actions">
                  <span className={`queue-card__badge ${isSteer ? 'queue-card__badge--steer' : ''}`}>
                    {isSteer ? (isLiveSteered ? 'Sent' : 'Steer') : 'Next Turn'}
                  </span>
                  {onRemove && !isLiveSteered && (
                    <button
                      type="button"
                      className="queue-card__remove-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemove(item.text, item.type);
                      }}
                      title="Remove from queue"
                      aria-label="Remove from queue"
                    >
                      <CloseIcon />
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
