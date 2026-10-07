import { useState, useEffect } from 'react';
import CodeExplorerView from './CodeExplorerView';
import './PreviewPanel.css';

// Precision Studio Hairline Icons (14x14, stroke-width 1.6)
const RefreshIcon = ({ spinning }) => (
  <svg
    viewBox="0 0 24 24"
    width="13"
    height="13"
    stroke="currentColor"
    strokeWidth="1.6"
    fill="none"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={spinning ? 'preview-studio__spin' : ''}
  >
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 21h5v-5" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const FluidIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 3 21 3 21 9" />
    <polyline points="9 21 3 21 3 15" />
    <line x1="21" y1="3" x2="14" y2="10" />
    <line x1="3" y1="21" x2="10" y2="14" />
  </svg>
);

const DesktopIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="14" rx="2" />
    <line x1="8" y1="21" x2="16" y2="21" />
    <line x1="12" y1="17" x2="12" y2="21" />
  </svg>
);

const TabletIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="2" width="16" height="20" rx="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
);

const MobileIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
);

const StandbyIcon = () => (
  <svg viewBox="0 0 24 24" width="28" height="28" stroke="currentColor" strokeWidth="1.2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <line x1="12" y1="3" x2="12" y2="6" />
    <line x1="12" y1="18" x2="12" y2="21" />
    <line x1="3" y1="12" x2="6" y2="12" />
    <line x1="18" y1="12" x2="21" y2="12" />
  </svg>
);

const VIEWPORT_PRESETS = [
  { id: 'fluid', label: 'Fluid', dims: '100%', Icon: FluidIcon },
  { id: 'desktop', label: '1280', dims: '1280 × 800', width: 1280, height: 800, Icon: DesktopIcon },
  { id: 'tablet', label: '768', dims: '768 × 1024', width: 768, height: 1024, Icon: TabletIcon },
  { id: 'mobile', label: '375', dims: '375 × 667', width: 375, height: 667, Icon: MobileIcon },
];

export default function PreviewPanel({ projectName, previewData, _onStopPreview, lastChangeTimestamp }) {
  const [frameKey, setFrameKey] = useState(0);
  const [isServerReady, setIsServerReady] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isReloading, setIsReloading] = useState(false);

  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem('80degrees_view_mode') || 'preview';
    } catch {
      return 'preview';
    }
  });

  const [viewportMode, setViewportMode] = useState(() => {
    try {
      return localStorage.getItem('80degrees_viewport_mode') || 'fluid';
    } catch {
      return 'fluid';
    }
  });

  const handleSelectMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('80degrees_view_mode', mode);
    } catch {}
  };

  const handleSelectViewport = (mode) => {
    setViewportMode(mode);
    try {
      localStorage.setItem('80degrees_viewport_mode', mode);
    } catch {}
  };

  // 1. Dev Server Health Polling
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

  // 2. Debounced Live Auto-Reload when code changes
  useEffect(() => {
    if (!lastChangeTimestamp || !isServerReady) return;

    const timer = setTimeout(() => {
      setFrameKey((k) => k + 1);
    }, 450);

    return () => clearTimeout(timer);
  }, [lastChangeTimestamp, isServerReady]);

  const handleOpenExternal = () => {
    if (!previewData?.url) return;
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
    setTimeout(() => setCopied(false), 1600);
  };

  const handleManualReload = () => {
    setIsReloading(true);
    setFrameKey((k) => k + 1);
    setTimeout(() => setIsReloading(false), 450);
  };

  const activePreset = VIEWPORT_PRESETS.find((p) => p.id === viewportMode) || VIEWPORT_PRESETS[0];

  // Clean empty standby state
  if (!previewData && !projectName) {
    return (
      <div className="preview-studio preview-studio--empty">
        <div className="preview-studio__standby-block">
          <div className="preview-studio__standby-glyph">
            <StandbyIcon />
          </div>
          <div className="preview-studio__standby-headline">Standby</div>
          <p className="preview-studio__standby-subline">
            Select or generate a workspace to initialize the runtime canvas and source inspector.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="preview-studio">
      {/* Studio Header: Single Minimalist Horizon */}
      <header className="preview-studio__bar">
        {/* Left: Mode Toggle & Quiet Telemetry */}
        <div className="preview-studio__group preview-studio__group--left">
          <nav className="preview-studio__nav" aria-label="View selection">
            <button
              type="button"
              className={`preview-studio__nav-tab ${viewMode === 'preview' ? 'preview-studio__nav-tab--active' : ''}`}
              onClick={() => handleSelectMode('preview')}
            >
              Preview
            </button>
            <button
              type="button"
              className={`preview-studio__nav-tab ${viewMode === 'code' ? 'preview-studio__nav-tab--active' : ''}`}
              onClick={() => handleSelectMode('code')}
            >
              Code
            </button>
          </nav>

          {previewData && (
            <div className="preview-studio__telemetry">
              <span className={`preview-studio__dot ${!isServerReady ? 'preview-studio__dot--pulse' : ''}`} />
              <span className="preview-studio__port">
                {isServerReady ? `:${previewData.port}` : `connecting :${previewData.port}`}
              </span>
              {isServerReady && previewData.backend_port && (
                <span className="preview-studio__port-sub">api :{previewData.backend_port}</span>
              )}
            </div>
          )}
        </div>

        {/* Center: Responsive Viewport Controls (Preview) or Project Name (Code) */}
        <div className="preview-studio__group preview-studio__group--center">
          {viewMode === 'preview' ? (
            <div className="preview-studio__viewports">
              {VIEWPORT_PRESETS.map((preset) => {
                const Icon = preset.Icon;
                const isActive = viewportMode === preset.id;
                return (
                  <button
                    key={preset.id}
                    type="button"
                    className={`preview-studio__viewport-btn ${isActive ? 'preview-studio__viewport-btn--active' : ''}`}
                    onClick={() => handleSelectViewport(preset.id)}
                    title={`${preset.label} (${preset.dims})`}
                    aria-label={`${preset.label} Viewport`}
                  >
                    <Icon />
                  </button>
                );
              })}

              {viewportMode !== 'fluid' && (
                <span className="preview-studio__dim-label">{activePreset.dims}</span>
              )}
            </div>
          ) : (
            <div className="preview-studio__project-crumb">
              <span className="preview-studio__project-name">{projectName}</span>
            </div>
          )}
        </div>

        {/* Right: Whisper URL Link & Ghost Utility Actions */}
        <div className="preview-studio__group preview-studio__group--right">
          {viewMode === 'preview' && previewData?.url && (
            <button
              type="button"
              className="preview-studio__url-link"
              onClick={handleCopyUrl}
              title="Click to copy preview URL"
            >
              <span className="preview-studio__url-text">{previewData.url}</span>
              <span className="preview-studio__url-status">
                {copied ? <CheckIcon /> : <CopyIcon />}
              </span>
            </button>
          )}

          <div className="preview-studio__ghost-actions">
            {viewMode === 'preview' && (
              <button
                type="button"
                className="preview-studio__ghost-btn"
                onClick={handleManualReload}
                title="Reload preview"
                aria-label="Reload preview"
              >
                <RefreshIcon spinning={isReloading} />
              </button>
            )}

            {previewData?.url && (
              <button
                type="button"
                className="preview-studio__ghost-btn"
                onClick={handleOpenExternal}
                title="Open in external browser"
                aria-label="Open in external browser"
              >
                <ExternalLinkIcon />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Main Surface: Code Inspector vs Studio Viewport */}
      {viewMode === 'code' ? (
        <div className="preview-studio__body">
          <CodeExplorerView
            projectName={projectName}
            lastChangeTimestamp={lastChangeTimestamp}
          />
        </div>
      ) : (
        <div className={`preview-studio__canvas ${viewportMode !== 'fluid' ? 'preview-studio__canvas--framed' : ''}`}>
          {!previewData ? (
            <div className="preview-studio__state-msg">
              <div className="preview-studio__state-glyph"><StandbyIcon /></div>
              <div className="preview-studio__state-title">No Runtime Active</div>
              <div className="preview-studio__state-desc">
                Switch to <strong>Code</strong> mode or initialize project runtime.
              </div>
            </div>
          ) : !isServerReady ? (
            <div className="preview-studio__state-msg">
              <div className="preview-studio__loader-ring" />
              <div className="preview-studio__state-title">Starting runtime</div>
              <div className="preview-studio__state-desc">
                Compiling on port <code>:{previewData.port}</code>
              </div>
            </div>
          ) : viewportMode === 'fluid' ? (
            <iframe
              key={frameKey}
              src={previewData.url}
              className="preview-studio__frame preview-studio__frame--fluid"
              title="Application Preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
            />
          ) : (
            <div className="preview-studio__stage">
              <div
                className="preview-studio__chassis"
                style={{
                  width: `${activePreset.width}px`,
                  height: `${activePreset.height}px`,
                }}
              >
                <iframe
                  key={frameKey}
                  src={previewData.url}
                  className="preview-studio__frame preview-studio__frame--contained"
                  title="Application Preview"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
