import React from 'react';
import './AttachmentRibbon.css';

export default function AttachmentRibbon({ attachments = [], onRemove }) {
  if (!attachments || attachments.length === 0) return null;

  const formatSize = (bytes) => {
    if (!bytes) return '';
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    if (bytes >= 1024) return `${Math.round(bytes / 1024)}KB`;
    return `${bytes}B`;
  };

  return (
    <div className="attachment-ribbon">
      {attachments.map((att) => (
        <div key={att.id} className="attachment-ribbon__item">
          {att.type === 'image' ? (
            <div className="attachment-ribbon__thumb-wrap">
              <img src={att.dataUrl} alt={att.name} className="attachment-ribbon__thumb" />
              <button
                type="button"
                className="attachment-ribbon__remove-btn"
                onClick={() => onRemove(att.id)}
                title={`Remove ${att.name}`}
                aria-label={`Remove ${att.name}`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          ) : att.type === 'video' ? (
            <div className="attachment-ribbon__thumb-wrap attachment-ribbon__thumb-wrap--video">
              {att.thumbnailUrl ? (
                <img src={att.thumbnailUrl} alt={att.name} className="attachment-ribbon__thumb" />
              ) : (
                <div className="attachment-ribbon__video-placeholder">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polygon points="23 7 16 12 23 17 23 7"></polygon>
                    <rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>
                  </svg>
                </div>
              )}
              <div className="attachment-ribbon__video-tag">
                <svg width="8" height="8" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="5 3 19 12 5 21 5 3"></polygon>
                </svg>
                <span>VID</span>
              </div>
              <button
                type="button"
                className="attachment-ribbon__remove-btn"
                onClick={() => onRemove(att.id)}
                title={`Remove ${att.name}`}
                aria-label={`Remove ${att.name}`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          ) : (
            <div className="attachment-ribbon__file-chip">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="attachment-ribbon__file-icon">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                <polyline points="14 2 14 8 20 8"></polyline>
              </svg>
              <span className="attachment-ribbon__file-name" title={att.name}>
                {att.name}
              </span>
              {att.size && (
                <span className="attachment-ribbon__file-size">{formatSize(att.size)}</span>
              )}
              <button
                type="button"
                className="attachment-ribbon__remove-chip-btn"
                onClick={() => onRemove(att.id)}
                title={`Remove ${att.name}`}
                aria-label={`Remove ${att.name}`}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
