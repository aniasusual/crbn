import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import CodeExplorerView from './CodeExplorerView';
import {
  MagneticDock,
  DockIconEye,
  DockIconCode,
  DockIconDesktop,
  DockIconTablet,
  DockIconMobile,
  DockIconRefresh,
  DockIconExternal,
} from '@/components/ui/magnetic-dock';
import './PreviewPanel.css';

const CanvasStudioGlyph = () => (
  <svg viewBox="0 0 48 48" width="44" height="44" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <rect x="6" y="8" width="36" height="26" rx="4" />
    <path d="M14 26l7-7 8 8 5-5 8 8" />
    <circle cx="16" cy="16" r="2.5" />
    <path d="M18 38l6-4 6 4" />
    <line x1="24" y1="34" x2="24" y2="42" />
  </svg>
);

const DEVICE_MODES = ['desktop', 'tablet', 'mobile'];

const BASE_PRESETS = [
  { id: 'desktop', label: 'Desktop', width: 1280, height: 800, canRotate: false },
  { id: 'tablet', label: 'Tablet', width: 768, height: 1024, canRotate: true },
  { id: 'mobile', label: 'Mobile', width: 375, height: 667, canRotate: true },
];

export default function PreviewPanel({ projectName, previewData, _onStopPreview, lastChangeTimestamp }) {
  const [frameKey, setFrameKey] = useState(0);
  const [isServerReady, setIsServerReady] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isLandscape, _setIsLandscape] = useState(false);

  const canvasRef = useRef(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  const [viewMode, setViewMode] = useState(() => {
    try {
      return localStorage.getItem('80degrees_view_mode') || 'preview';
    } catch {
      return 'preview';
    }
  });

  const [viewportMode, setViewportMode] = useState(() => {
    try {
      const saved = localStorage.getItem('80degrees_viewport_mode');
      if (saved && DEVICE_MODES.includes(saved)) {
        return saved;
      }
      return 'desktop';
    } catch {
      return 'desktop';
    }
  });

  // Track canvas size for smooth device fitting
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.contentRect) {
          setCanvasSize({
            width: entry.contentRect.width,
            height: entry.contentRect.height,
          });
        }
      }
    });

    observer.observe(el);
    return () => observer.disconnect();
  }, [viewMode]);

  const handleSelectMode = useCallback((mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('80degrees_view_mode', mode);
    } catch {}
  }, []);

  const handleSelectViewport = useCallback((mode) => {
    setViewportMode(mode);
    try {
      localStorage.setItem('80degrees_viewport_mode', mode);
    } catch {}
  }, []);

  // Single button toggles between Preview and Code Inspector
  const handleToggleViewMode = useCallback(() => {
    handleSelectMode(viewMode === 'preview' ? 'code' : 'preview');
  }, [viewMode, handleSelectMode]);

  // Single button cycles through all three modes: Desktop -> Tablet -> Mobile
  const handleCycleViewport = useCallback(() => {
    const currentIdx = DEVICE_MODES.indexOf(viewportMode);
    const nextIdx = currentIdx === -1 ? 0 : (currentIdx + 1) % DEVICE_MODES.length;
    const nextMode = DEVICE_MODES[nextIdx];
    handleSelectViewport(nextMode);
    if (viewMode !== 'preview') {
      handleSelectMode('preview');
    }
  }, [viewportMode, viewMode, handleSelectViewport, handleSelectMode]);

  // Dev Server Health Polling
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

  // Debounced Live Auto-Reload when AI agent writes/edits code
  useEffect(() => {
    if (!lastChangeTimestamp || !isServerReady) return;

    const timer = setTimeout(() => {
      setFrameKey((k) => k + 1);
    }, 450);

    return () => clearTimeout(timer);
  }, [lastChangeTimestamp, isServerReady]);

  const handleOpenExternal = useCallback(() => {
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
  }, [previewData?.url]);

  const handleManualReload = useCallback(() => {
    setIsReloading(true);
    setFrameKey((k) => k + 1);
    setTimeout(() => setIsReloading(false), 450);
  }, []);

  // Dimensions & scale calculation (clean fitting without auto-fit toggle)
  const currentConfig = useMemo(() => {
    const raw = BASE_PRESETS.find((p) => p.id === viewportMode) || BASE_PRESETS[0];

    let w = raw.width;
    let h = raw.height;

    if (isLandscape && raw.canRotate) {
      w = raw.height;
      h = raw.width;
    }

    let scale = 1;
    if (canvasSize.width > 0 && canvasSize.height > 0) {
      const availW = Math.max(100, canvasSize.width - 56);
      const availH = Math.max(100, canvasSize.height - 110);
      const scaleW = availW / w;
      const scaleH = availH / h;
      scale = Math.min(1, scaleW, scaleH);
      scale = Math.max(0.3, Number(scale.toFixed(3)));
    }

    return {
      ...raw,
      width: w,
      height: h,
      dims: `${w} × ${h}`,
      scale,
    };
  }, [viewportMode, isLandscape, canvasSize]);

  // Magnetic Dock Action Items: Single View Toggle, Single Device Toggle, Reload, Open
  const dockItems = useMemo(() => {
    return [
      {
        id: 'view-toggle',
        label: viewMode === 'preview' ? 'Live Preview' : 'Code Inspector',
        tooltip: viewMode === 'preview'
          ? 'Live Preview (Click for Code)'
          : 'Code Inspector (Click for Preview)',
        icon: viewMode === 'preview' ? <DockIconEye /> : <DockIconCode />,
        onClick: handleToggleViewMode,
      },
      {
        id: 'device-toggle',
        label:
          viewportMode === 'tablet'
            ? 'Tablet'
            : viewportMode === 'mobile'
            ? 'Mobile'
            : 'Desktop (Full)',
        tooltip:
          viewportMode === 'desktop'
            ? 'Desktop: Full Width (Click for Tablet)'
            : viewportMode === 'tablet'
            ? 'Tablet: 768×1024 (Click for Mobile)'
            : 'Mobile: 375×667 (Click for Desktop Full)',
        icon:
          viewportMode === 'tablet' ? (
            <DockIconTablet />
          ) : viewportMode === 'mobile' ? (
            <DockIconMobile />
          ) : (
            <DockIconDesktop />
          ),
        onClick: handleCycleViewport,
      },
      {
        id: 'reload',
        label: 'Reload',
        tooltip: isReloading ? 'Reloading Preview...' : 'Reload Preview',
        icon: <DockIconRefresh spinning={isReloading} />,
        onClick: handleManualReload,
      },
      {
        id: 'external',
        label: 'Open Browser',
        tooltip: 'Open in External Browser',
        icon: <DockIconExternal />,
        onClick: handleOpenExternal,
      },
    ];
  }, [
    viewMode,
    viewportMode,
    isReloading,
    handleToggleViewMode,
    handleCycleViewport,
    handleManualReload,
    handleOpenExternal,
  ]);

  // Clean empty state with sanctuary card
  if (!previewData && !projectName) {
    return (
      <div className="preview-sooth preview-sooth--empty">
        <div className="preview-sooth__viewport preview-sooth__viewport--empty">
          <div className="preview-sooth__sanctuary">
            <div className="preview-sooth__sanctuary-icon">
              <CanvasStudioGlyph />
            </div>
            <h3 className="preview-sooth__sanctuary-title">Creative Canvas</h3>
            <p className="preview-sooth__sanctuary-desc">
              Your live design preview will illuminate here as soon as you open a workspace or start crafting.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="preview-sooth">
      {/* Top Subtle Status Pill */}
      {previewData && (
        <div className="preview-sooth__top-badge">
          <div
            className="preview-sooth__badge-pill"
            title={
              isServerReady
                ? `Frontend :${previewData.port}${previewData.backend_port ? ` • Backend :${previewData.backend_port}` : ''}`
                : `Connecting frontend :${previewData.port}${previewData.backend_port ? ` • Backend :${previewData.backend_port}` : ''}`
            }
          >
            <span className={`preview-sooth__badge-dot ${!isServerReady ? 'preview-sooth__badge-dot--booting' : ''}`} />
            <span className="preview-sooth__badge-port">:{previewData.port}</span>
            {previewData.backend_port && (
              <span className="preview-sooth__badge-port-sub">api :{previewData.backend_port}</span>
            )}
          </div>
        </div>
      )}

      {/* Main Sanctuary: Viewport / Code Inspector */}
      <div className="preview-sooth__viewport">
        {viewMode === 'code' ? (
          <div className="preview-sooth__body">
            <CodeExplorerView
              projectName={projectName}
              lastChangeTimestamp={lastChangeTimestamp}
            />
          </div>
        ) : (
          <div
            ref={canvasRef}
            className={`preview-sooth__canvas ${viewportMode !== 'desktop' ? 'preview-sooth__canvas--framed' : ''}`}
          >
            {!previewData ? (
              <div className="preview-sooth__calm-state">
                <div className="preview-sooth__calm-icon"><CanvasStudioGlyph /></div>
                <div className="preview-sooth__calm-title">Dev Server Inactive</div>
                <div className="preview-sooth__calm-subtitle">
                  Switch to <strong>Code</strong> mode to inspect files or launch your project.
                </div>
              </div>
            ) : !isServerReady ? (
              <div className="preview-sooth__calm-state">
                <div className="preview-sooth__breathing-halo">
                  <div className="preview-sooth__halo-ring" />
                  <div className="preview-sooth__halo-core" />
                </div>
                <div className="preview-sooth__calm-title">Warming up preview</div>
                <div className="preview-sooth__calm-subtitle">
                  Connecting dev runtime on port <code>:{previewData.port}</code>
                </div>
              </div>
) : viewportMode === 'desktop' ? (
              <iframe
                key={frameKey}
                src={previewData.url}
                className="preview-sooth__frame preview-sooth__frame--fluid"
                title="Live Application Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              />
) : (
              <div className="preview-sooth__stage">
                <div
                  className="preview-sooth__chassis"
                  style={{
                    width: `${currentConfig.width}px`,
                    height: `${currentConfig.height}px`,
                    transform: `scale(${currentConfig.scale})`,
                    transformOrigin: 'top center',
                  }}
                >
                  <iframe
                    key={frameKey}
                    src={previewData.url}
                    className="preview-sooth__frame preview-sooth__frame--contained"
                    title="Live Application Preview"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Items Dock Positioned at Bottom Center */}
      <div className="preview-sooth__dock-bottom-center">
        <MagneticDock
          items={dockItems}
          iconSize={42}
          maxScale={1.35}
          magneticDistance={120}
          showLabels={true}
        />
      </div>
    </div>
  );
}
