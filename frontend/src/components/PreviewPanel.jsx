import { API_BASE_URL } from '../config';
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
  DockIconDeploy,
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

const IPHONE_PRESET = { id: 'mobile', label: 'iPhone 16 Pro', width: 393, height: 852, canRotate: true };

export default function PreviewPanel({ projectName, previewData, _onStopPreview, lastChangeTimestamp, template, onOpenCompany }) {
  const isMobileApp = template === 'mobile_expo' || template?.includes('mobile');
  const [frameKey, setFrameKey] = useState(0);
  const [isServerReady, setIsServerReady] = useState(false);
  const [isBackendReady, setIsBackendReady] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [isLandscape, _setIsLandscape] = useState(false);
  const [companyData, setCompanyData] = useState(null);
  const [isCreatingCompany, setIsCreatingCompany] = useState(false);

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
    return isMobileApp ? 'mobile' : 'desktop';
  });

  // Auto-default to the appropriate viewport mode for the active template
  useEffect(() => {
    if (isMobileApp) {
      setViewportMode('mobile');
    } else {
      setViewportMode('desktop');
    }
  }, [isMobileApp, projectName]);
  // Fetch company status for current project
  useEffect(() => {
    if (!projectName) {
      setCompanyData(null);
      return;
    }
    let isMounted = true;
    fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/company`)
      .then((res) => (res.ok ? res.json() : { exists: false }))
      .then((data) => {
        if (isMounted) {
          setCompanyData(data.exists ? data.company : null);
        }
      })
      .catch(() => {
        if (isMounted) setCompanyData(null);
      });
    return () => {
      isMounted = false;
    };
  }, [projectName]);

  const handleStartOrOpenCompany = useCallback(async () => {
    if (companyData?.status === 'active' && companyData?.agentaProjectId && companyData?.agentaUrl?.includes('/p/')) {
      onOpenCompany?.(companyData);
      return;
    }
    if (!projectName || isCreatingCompany) return;
    setIsCreatingCompany(true);
    try {
      const formattedName = projectName
        .split(/[-_]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');

      const optimisticCompany = {
        projectName,
        name: formattedName,
        status: 'provisioning',
        agentaUrl: 'http://localhost/m',
      };
      onOpenCompany?.(optimisticCompany);

      const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/company`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formattedName,
          tagline: `Autonomous business for ${formattedName}`,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.company) {
          setCompanyData(data.company);
          onOpenCompany?.(data.company);
        }
      }
    } catch (err) {
      console.error('[Company-Dock]', 'Failed to create company:', err);
    } finally {
      setIsCreatingCompany(false);
    }
  }, [companyData, projectName, isCreatingCompany, onOpenCompany]);


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
  // Dev Server Backend Health Polling
  useEffect(() => {
    if (!previewData?.backend_port) {
      setIsBackendReady(false);
      return;
    }

    let isMounted = true;
    let timeoutId = null;
    setIsBackendReady(false);

    const checkBackendHealth = async () => {
      try {
        const targetUrl = (
          previewData.backend_url || `http://127.0.0.1:${previewData.backend_port}`
        ).replace('://localhost:', '://127.0.0.1:');
        await fetch(targetUrl, { mode: 'no-cors', cache: 'no-store' });
        if (isMounted) {
          setIsBackendReady(true);
        }
      } catch {
        if (isMounted) {
          setIsBackendReady(false);
          timeoutId = setTimeout(checkBackendHealth, 500);
        }
      }
    };

    checkBackendHealth();

    const intervalId = setInterval(() => {
      if (isMounted) checkBackendHealth();
    }, 3000);

    return () => {
      isMounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      clearInterval(intervalId);
    };
  }, [previewData?.backend_port, previewData?.backend_url]);

  // Live Auto-Reload when AI agent writes/edits code or tab is refreshed
  useEffect(() => {
    if (!lastChangeTimestamp) return;

    setIsReloading(true);
    setFrameKey((k) => k + 1);
    const timer = setTimeout(() => setIsReloading(false), 500);

    return () => clearTimeout(timer);
  }, [lastChangeTimestamp]);

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

  const [deployNotice, setDeployNotice] = useState(false);
  const deployTimerRef = useRef(null);

  const handleDeployClick = useCallback(() => {
    setDeployNotice(true);
    clearTimeout(deployTimerRef.current);
    deployTimerRef.current = setTimeout(() => {
      setDeployNotice(false);
    }, 4500);
  }, []);

  useEffect(() => {
    return () => {
      clearTimeout(deployTimerRef.current);
    };
  }, []);

  // Dimensions & scale calculation (clean fitting without auto-fit toggle)
  const currentConfig = useMemo(() => {
    const raw = isMobileApp
      ? IPHONE_PRESET
      : BASE_PRESETS.find((p) => p.id === viewportMode) || BASE_PRESETS[0];

    let w = raw.width;
    let h = raw.height;

    if (isLandscape && raw.canRotate) {
      w = raw.height;
      h = raw.width;
    }

    let scale = 1;
    if (canvasSize.width > 0 && canvasSize.height > 0) {
      const availW = Math.max(100, canvasSize.width - (isMobileApp ? 64 : 56));
      const availH = Math.max(100, canvasSize.height - (isMobileApp ? 120 : 110));
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
  }, [isMobileApp, viewportMode, isLandscape, canvasSize]);

  // Magnetic Dock Action Items: Single View Toggle, Single Device Toggle, Reload, Open
  const dockItems = useMemo(() => {
    const items = [
      {
        id: 'view-toggle',
        label: viewMode === 'preview' ? 'Live Preview' : 'Code Inspector',
        tooltip: viewMode === 'preview'
          ? 'Live Preview (Click for Code)'
          : 'Code Inspector (Click for Preview)',
        icon: viewMode === 'preview' ? <DockIconEye /> : <DockIconCode />,
        onClick: handleToggleViewMode,
      },
    ];

    if (!isMobileApp) {
      items.push({
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
            : 'Mobile: 393×852 (Click for Desktop Full)',
        icon:
          viewportMode === 'tablet' ? (
            <DockIconTablet />
          ) : viewportMode === 'mobile' ? (
            <DockIconMobile />
          ) : (
            <DockIconDesktop />
          ),
        onClick: handleCycleViewport,
      });
    }

    items.push(
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
      {
        id: 'company',
        label: isCreatingCompany ? 'Starting Company...' : (companyData?.status === 'active' && companyData?.agentaProjectId) ? 'Company' : 'Start a Company',
        tooltip: isCreatingCompany ? 'Setting up Company Workspace...' : (companyData?.status === 'active' && companyData?.agentaProjectId) ? 'Company Dashboard' : 'Start a Company',
        icon: <DockIconDeploy />,
        onClick: handleStartOrOpenCompany,
        isActive: Boolean(companyData?.status === 'active' && companyData?.agentaProjectId),
      }
    );

    return items;
  }, [
    isMobileApp,
    viewMode,
    viewportMode,
    isReloading,
    handleToggleViewMode,
    handleCycleViewport,
    handleManualReload,
    handleOpenExternal,
    companyData,
    isCreatingCompany,
    handleStartOrOpenCompany,
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
              `${isServerReady ? `Frontend active on :${previewData.port}` : `Connecting frontend on :${previewData.port}...`}` +
              (previewData.backend_port
                ? ` • ${isBackendReady ? `API server active on :${previewData.backend_port}` : `Connecting to API server on :${previewData.backend_port}...`}`
                : '')
            }
          >
            <span
              className={`preview-sooth__badge-dot ${!isServerReady ? 'preview-sooth__badge-dot--booting' : ''}`}
              title={isServerReady ? `Frontend running on :${previewData.port}` : `Starting frontend on :${previewData.port}...`}
            />
            <span className="preview-sooth__badge-port">:{previewData.port}</span>
            {previewData.backend_port && (
              <span
                className="preview-sooth__badge-port-sub"
                title={isBackendReady ? `API Server online on :${previewData.backend_port}` : `API Server connecting on :${previewData.backend_port}...`}
              >
                <span
                  className={`preview-sooth__badge-dot preview-sooth__badge-dot--sub ${!isBackendReady ? 'preview-sooth__badge-dot--booting' : ''}`}
                />
                api :{previewData.backend_port}
              </span>
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
) : !isMobileApp && viewportMode === 'desktop' ? (
              <iframe
                key={frameKey}
                src={previewData.url}
                className="preview-sooth__frame preview-sooth__frame--fluid"
                title="Live Application Preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock"
                allow="cross-origin-isolated; autoplay"
              />
) : (
              <div className="preview-sooth__stage">
                <div
                  className={`preview-sooth__chassis ${
                    isMobileApp ? 'preview-sooth__chassis--iphone' : ''
                  }`}
                  style={{
                    width: `${currentConfig.width}px`,
                    height: `${currentConfig.height}px`,
                    transform: `scale(${currentConfig.scale})`,
                    transformOrigin: 'top center',
                  }}
                >
                  {isMobileApp && (
                    <>
                      {/* Physical Side Buttons */}
                      <div className="preview-sooth__iphone-btn-action" aria-hidden="true" />
                      <div className="preview-sooth__iphone-btn-vol-up" aria-hidden="true" />
                      <div className="preview-sooth__iphone-btn-vol-down" aria-hidden="true" />
                      <div className="preview-sooth__iphone-btn-power" aria-hidden="true" />

                      {/* Top Bezel: Dynamic Island */}
                      <div className="preview-sooth__iphone-island" aria-hidden="true">
                        <div className="preview-sooth__iphone-camera-dot" />
                        <div className="preview-sooth__iphone-sensor-dot" />
                      </div>

                      {/* Bottom Bezel: Home Indicator Bar */}
                      <div className="preview-sooth__iphone-home-bar" aria-hidden="true" />
                    </>
                  )}

                  <iframe
                    key={frameKey}
                    src={previewData.url}
                    className="preview-sooth__frame preview-sooth__frame--contained"
                    title="Live Application Preview"
                    sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-pointer-lock"
                    allow="cross-origin-isolated; autoplay"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Action Items Dock Positioned at Bottom Center */}
      <div className="preview-sooth__dock-bottom-center">
        {deployNotice && (
          <div className="preview-deploy-notice" role="status" aria-live="polite">
            <span className="preview-deploy-notice__icon">
              <DockIconDeploy className="w-3.5 h-3.5" />
            </span>
            <span className="preview-deploy-notice__text">Deployments coming soon, stay tuned!</span>
            <button
              type="button"
              className="preview-deploy-notice__close"
              onClick={() => setDeployNotice(false)}
              aria-label="Dismiss notice"
            >
              ✕
            </button>
          </div>
        )}
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
