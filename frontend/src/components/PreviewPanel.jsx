import { useState, useEffect } from 'react';
import './PreviewPanel.css';

// Minimalist Notion-style SVG Icons
const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 21h5v-5" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);


const GlobeIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const BrowserEmptyIcon = () => (
  <svg viewBox="0 0 24 24" width="40" height="40" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="18" rx="3" />
    <line x1="2" y1="8" x2="22" y2="8" />
    <circle cx="5" cy="5.5" r="1" fill="currentColor" />
    <circle cx="8" cy="5.5" r="1" fill="currentColor" />
    <circle cx="11" cy="5.5" r="1" fill="currentColor" />
  </svg>
);

export default function PreviewPanel({ previewData, _onStopPreview, lastChangeTimestamp }) {
  const [frameKey, setFrameKey] = useState(0);
  const [isServerReady, setIsServerReady] = useState(false);
  const [copied, setCopied] = useState(false);

  // 1. Dev Server Health Polling
  // Ensures iframe is only mounted after Vite is actively accepting HTTP requests
  useEffect(() => {
    if (!previewData?.url) {
      setIsServerReady(false);
      return;
    }

    let isMounted = true;
    let timeoutId = null;
    setIsServerReady(false);

    const checkHealth = async () => {
      try {
        const targetUrl = (previewData.url || '').replace('://localhost:', '://127.0.0.1:');
        await fetch(targetUrl, { mode: 'no-cors', cache: 'no-store' });
        if (isMounted) {
          setIsServerReady(true);
        }
      } catch {
        if (isMounted) {
          timeoutId = setTimeout(checkHealth, 350);
        }
      }
    };

    checkHealth();

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [previewData?.url]);

  // 2. Debounced Live Auto-Reload when AI agent writes/edits code or finishes turn
  useEffect(() => {
    if (!lastChangeTimestamp || !isServerReady) return;

    const timer = setTimeout(() => {
      setFrameKey(k => k + 1);
    }, 450);

    return () => clearTimeout(timer);
  }, [lastChangeTimestamp, isServerReady]);

  const handleOpenExternal = () => {
    if (!previewData?.url) return;
    // If running in Electron, use shell.openExternal to open system browser
    if (typeof window !== 'undefined' && window.require) {
      try {
        const { shell } = window.require('electron');
        if (shell && shell.openExternal) {
          shell.openExternal(previewData.url);
          return;
        }
      } catch (e) {
        console.warn('Could not load electron shell', e);
      }
    }
    window.open(previewData.url, '_blank', 'noopener,noreferrer');
  };

  const handleCopyUrl = () => {
    if (!previewData?.url) return;
    navigator.clipboard.writeText(previewData.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleManualReload = () => {
    setFrameKey(k => k + 1);
  };

  if (!previewData) {
    return (
      <div className="preview-panel preview-panel--empty">
        <div className="preview-panel__empty-content">
          <div className="preview-panel__empty-icon-wrap">
            <div className="preview-panel__empty-icon-glow" />
            <div className="preview-panel__empty-icon">
              <BrowserEmptyIcon />
            </div>
          </div>
          <h3 className="preview-panel__empty-title">
            Live app <span className="preview-panel__empty-title-serif">preview</span>
          </h3>
          <p className="preview-panel__empty-desc">
            The dev server will boot automatically when you open or create a workspace.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="preview-panel">
      {/* Notion-style Browser Chrome */}
      <div className="preview-panel__header">
        <div className="preview-panel__left">
          <div className="preview-panel__traffic-lights">
            <span className="preview-panel__light preview-panel__light--close" />
            <span className="preview-panel__light preview-panel__light--min" />
            <span className="preview-panel__light preview-panel__light--max" />
          </div>

          <div className={`preview-panel__status-pill ${!isServerReady ? 'preview-panel__status-pill--booting' : ''}`}>
            <span className="preview-panel__pulse-dot" />
            <span className="preview-panel__port-label">
              {isServerReady ? `:${previewData.port}` : `Booting :${previewData.port}...`}
            </span>
            {isServerReady && previewData.backend_port && (
              <span className="preview-panel__api-label">API :{previewData.backend_port}</span>
            )}
          </div>
        </div>

        {/* Center URL Address Bar */}
        <div className="preview-panel__address-bar" onClick={handleCopyUrl} title="Click to copy URL">
          <span className="preview-panel__address-icon"><GlobeIcon /></span>
          <span className="preview-panel__address-text">{previewData.url}</span>
          <span className="preview-panel__copy-btn">
            {copied ? <CheckIcon /> : <CopyIcon />}
          </span>
        </div>

        {/* Right Actions */}
        <div className="preview-panel__actions">
          <button
            className="preview-panel__action-btn"
            onClick={handleManualReload}
            title="Reload Preview"
          >
            <RefreshIcon />
          </button>
          
          <button
            className="preview-panel__action-btn"
            onClick={handleOpenExternal}
            title="Open in external browser"
          >
            <ExternalLinkIcon />
          </button>

        </div>
      </div>

      {/* Frame Container */}
      <div className="preview-panel__frame-wrapper">
        {!isServerReady ? (
          <div className="preview-panel__booting">
            <div className="preview-panel__spinner" />
            <div className="preview-panel__booting-title">Starting Development Server</div>
            <div className="preview-panel__booting-desc">
              Compiling template & launching Vite on port <code>:{previewData.port}</code>...
            </div>
          </div>
        ) : (
          <iframe
            key={frameKey}
            src={previewData.url}
            className="preview-panel__frame"
            title="Live Application Preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
          />
        )}
      </div>
    </div>
  );
}
