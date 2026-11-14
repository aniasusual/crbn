import { useState, useEffect, useRef, useCallback } from 'react';
import './AgentaEmbeddedView.css';
import { API_BASE_URL } from '../config';
import { getAgentaSessionHeaders } from '../lib/agenta-session';
import BlackboardPanel from './BlackboardPanel';

const KanbanIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor">
    <path d="M216,40H40A16,16,0,0,0,24,56V200a16,16,0,0,0,16,16H96a8,8,0,0,0,8-8V56h48V152a8,8,0,0,0,8,8h56a16,16,0,0,0,16-16V56A16,16,0,0,0,216,40ZM40,56H88V96H40Zm0,56H88v88H40Zm176,32H168V56h48Z" />
  </svg>
);
const ArrowLeftIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="19" y1="12" x2="5" y2="12" />
    <polyline points="12 19 5 12 12 5" />
  </svg>
);

const RefreshIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.19" />
  </svg>
);

const ExternalLinkIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const BuildingIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect width="16" height="20" x="4" y="2" rx="2" ry="2" />
    <path d="M9 22v-4h6v4" />
    <path d="M8 6h.01" />
    <path d="M16 6h.01" />
    <path d="M8 10h.01" />
    <path d="M16 10h.01" />
    <path d="M8 14h.01" />
    <path d="M16 14h.01" />
  </svg>
);

export default function AgentaEmbeddedView({ company, onBack, onOpenProject, onSendTaskToEngineering }) {
  const [companyState, setCompanyState] = useState(company);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const [isBlackboardOpen, setIsBlackboardOpen] = useState(false);
  const [agentaTheme, setAgentaTheme] = useState(() => {
    try {
      const raw = localStorage.getItem('agenta-theme');
      const mode = raw ? (raw.charAt(0) === '"' ? JSON.parse(raw) : raw) : 'system';
      const isDark =
        mode === 'dark' ||
        (mode === 'system' &&
          typeof window !== 'undefined' &&
          window.matchMedia?.('(prefers-color-scheme: dark)').matches);
      return isDark ? 'dark' : 'light';
    } catch {
      return 'dark';
    }
  });
  const [bbMetrics, setBbMetrics] = useState({
    totalTasks: 0,
    inProgressTasks: 0,
    blockedTasks: 0,
    doneTasks: 0,
    pendingApprovals: 0,
    totalArtifacts: 0,
  });
  const webviewRef = useRef(null);
  const companyStateRef = useRef(company);
  companyStateRef.current = companyState;
  const activeProjectName = companyState?.projectName || company?.projectName;
  useEffect(() => {
    setCompanyState(company);
    companyStateRef.current = company;
    console.log('[Company-EmbeddedView]', 'Company prop received:', company);

    if (!company?.projectName || company?.isInitialCreate) return;
    let cancelled = false;
    (async () => {
      try {
        const sessionHeaders = await getAgentaSessionHeaders(webviewRef.current);
        const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(company.projectName)}/company`, {
          headers: sessionHeaders,
        });
        if (!cancelled && res.ok) {
          const data = await res.json();
          if (data?.exists && data.company) {
            companyStateRef.current = data.company;
            setCompanyState(data.company);
          }
        }
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, [company]);

  // If user was not logged in at company creation time, poll until login completes and project is provisioned
  useEffect(() => {
    if (!companyState?.projectName) return;
    if (companyState.status !== 'provisioning' && companyState.agentaProjectId && companyState.agentaUrl?.includes('/p/')) {
      return;
    }
    if (companyState.isInitialCreate) {
      return;
    }

    let isMounted = true;
    const checkProvisioning = async () => {
      try {
        const sessionHeaders = await getAgentaSessionHeaders(webviewRef.current);
        const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(companyState.projectName)}/company`, {
          headers: sessionHeaders,
        });
        if (res.ok) {
          const data = await res.json();
          console.log('[Company-EmbeddedView]', 'Polled company status:', data);
          if (data.exists && data.company?.status === 'active' && data.company.agentaUrl?.includes('/p/')) {
            if (isMounted) {
              companyStateRef.current = data.company;
              setCompanyState(data.company);
              clearInterval(interval);
            }
          }
        }
      } catch {}
    };

    const interval = setInterval(checkProvisioning, 2000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [companyState?.projectName, companyState?.status, companyState?.agentaProjectId, companyState?.agentaUrl]);
  const resolveTargetUrl = (url) => {
    let base = url || 'http://localhost/m';
    if (base.includes('localhost:3000')) {
      base = base.replace('http://localhost:3000', 'http://localhost');
    }
    if (base.includes('/w') && !base.includes('/m')) {
      base = base.replace('/w', '/m');
    }
    base = base.replace(/[?&]view=desktop/, '');
    if (!base.includes('/m')) {
      base = 'http://localhost/m';
    }
    return base;
  };
  const targetUrl = resolveTargetUrl(companyState?.agentaUrl || company?.agentaUrl);
  const isElectron = typeof window !== 'undefined' && (
    Boolean(window.crbnDesktop) ||
    Boolean(window.__80DEGREES_CONFIG__) ||
    navigator.userAgent.toLowerCase().includes('electron')
  );

  const handleReload = useCallback(() => {
    setIsLoading(true);
    setLoadError(false);
    setFrameKey((k) => k + 1);

    if (webviewRef.current && typeof webviewRef.current.reload === 'function') {
      try {
        webviewRef.current.reload();
      } catch {
        // Fallback to frameKey
      }
    }
  }, []);

  const handleOpenExternal = useCallback(() => {
    window.open(targetUrl, '_blank');
  }, [targetUrl]);


  const handleOpenSpecialistChat = useCallback(
    (agentMeta, task) => {
      const latest = companyStateRef.current || company;
      const wsId = latest?.agentaWorkspaceId;
      const projId = latest?.agentaProjectId;
      const wfId =
        agentMeta?.workflowId ||
        (Array.isArray(latest?.agents)
          ? latest.agents.find(
              (a) =>
                a.id === agentMeta?.id ||
                a.initials === agentMeta?.initials ||
                a.name === agentMeta?.name
            )?.workflowId
          : undefined);

      if (task?.title && typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        const promptText = task.id
          ? `[Blackboard Task #${task.id}] ${task.title}${task.description ? `\n\n${task.description}` : ''}`
          : `${task.title}${task.description ? `\n\n${task.description}` : ''}`;
        navigator.clipboard.writeText(promptText).catch(() => {});
      }

      if (wsId && projId && wfId) {
        const originMatch = targetUrl.match(/^(https?:\/\/[^/]+)/i);
        const origin = originMatch ? originMatch[1] : 'http://localhost';
        const nextAgentUrl = agentMeta?.sessionId
          ? `${origin}/m/w/${encodeURIComponent(wsId)}/p/${encodeURIComponent(
              projId
            )}/sessions/${encodeURIComponent(agentMeta.sessionId)}?agent=${encodeURIComponent(wfId)}`
          : `${origin}/m/w/${encodeURIComponent(wsId)}/p/${encodeURIComponent(
              projId
            )}/agents/${encodeURIComponent(wfId)}?open=playground`;
        if (webviewRef.current && typeof webviewRef.current.loadURL === 'function') {
          try {
            webviewRef.current.loadURL(nextAgentUrl);
          } catch {
            setCompanyState((prev) => (prev ? { ...prev, agentaUrl: nextAgentUrl } : prev));
          }
        } else {
          setCompanyState((prev) => (prev ? { ...prev, agentaUrl: nextAgentUrl } : prev));
        }
      }
      setIsBlackboardOpen(false);
    },
    [company, targetUrl]
  );
  // Attach Electron webview listeners for styling injection and error interception
  useEffect(() => {
    const webview = webviewRef.current;
    if (!webview || !isElectron) return;

    const handleDomReady = () => {
      setIsLoading(false);
      setLoadError(false);

      // Retain 100% of Agenta's original styling, loader, and themes untouched.
      // Apply strictly text/logo branding replacement ("Agenta" -> "80degrees").
      try {
        webview.executeJavaScript(`
          (function() {
            function replaceBranding() {
              try {
                if (document.title && document.title.includes('Agenta')) {
                  document.title = document.title.replace(/Agenta/g, '80degrees');
                }
                const root = document.body || document.documentElement;
                if (!root) return;
                const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
                let node;
                while ((node = walker.nextNode())) {
                  if (node.nodeValue && node.nodeValue.includes('Agenta')) {
                    node.nodeValue = node.nodeValue.replace(/Agenta/g, '80degrees');
                  }
                }
                // On auth/login screen top-left corner: ensure both logo and text appear cleanly
                const authHeaderImgs = document.querySelectorAll('.auth-shell > section:first-child > div.absolute img, .auth-shell section[class*="lg:w-1/2"] > div.absolute img');
                authHeaderImgs.forEach((img) => {
                  if (img.dataset.eightyDegreesLockup || img.nextElementSibling?.classList.contains('eighty-degrees-wordmark')) return;
                  img.dataset.eightyDegreesLockup = 'true';
                  img.src = '/assets/logo-white1.png';
                  img.alt = '80degrees';
                  img.style.cssText = 'height: 20px; width: 20px; object-fit: contain; flex-shrink: 0; display: inline-block; vertical-align: middle;';

                  if (!img.parentNode.querySelector('.eighty-degrees-wordmark')) {
                    const text = document.createElement('span');
                    text.className = 'eighty-degrees-wordmark';
                    text.textContent = '80degrees';
                    text.style.cssText = 'font-size: 15px; font-weight: 600; letter-spacing: -0.02em; color: currentColor; margin-left: 6px; line-height: 1; vertical-align: middle; user-select: none;';
                    img.parentNode.insertBefore(text, img.nextSibling);
                  }
                });

                // Remove any stray wordmark injected into the right-side preview banner
                const strayPreviewWordmarks = document.querySelectorAll('.auth-preview-sidebar .eighty-degrees-wordmark, .auth-panel .eighty-degrees-wordmark');
                strayPreviewWordmarks.forEach((el) => el.remove());

                // Update any other img elements with Agenta in alt or src
                const otherImgs = document.querySelectorAll('img[alt*="Agenta"], img[src*="Agenta"]');
                otherImgs.forEach((img) => {
                  img.alt = '80degrees';
                  if (!img.src.includes('logo-white1.png')) {
                    img.src = '/assets/logo-white1.png';
                  }
                });

                // Replace any SVGs representing the Agenta logo/symbol in the rail
                const svgs = document.querySelectorAll('svg[aria-label="Agenta"], [role="img"][aria-label="Agenta"]');
                svgs.forEach((svg) => {
                  if (svg.dataset.eightyDegrees) return;
                  svg.dataset.eightyDegrees = 'true';
                  const img = document.createElement('img');
                  img.src = '/assets/logo-white1.png';
                  img.alt = '80degrees';
                  img.style.cssText = 'width: 20px; height: 20px; object-fit: contain; flex-shrink: 0; display: inline-block;';
                  svg.parentNode.replaceChild(img, svg);
                });
              } catch (_brandingErr) {}
            }

            replaceBranding();
            if (!window.__80degrees_branding_observer && (document.documentElement || document.body)) {
              window.__80degrees_branding_observer = new MutationObserver(replaceBranding);
              window.__80degrees_branding_observer.observe(document.documentElement || document.body, {
                childList: true,
                subtree: true,
                characterData: true,
              });
            }
            return document.documentElement && document.documentElement.classList.contains('dark') ? 'dark' : 'light';
          })();
        `)
          .then((detectedTheme) => {
            if (detectedTheme === 'light' || detectedTheme === 'dark') {
              setAgentaTheme(detectedTheme);
            }
          })
          .catch(() => {});
      } catch (err) {
        console.warn('Could not execute branding script in webview:', err);
      }
    };

    const handleDidFailLoad = (e) => {
      // Error code -3 is ERR_ABORTED (normal during redirection or reload)
      if (e.errorCode !== -3) {
        setLoadError(true);
        setIsLoading(false);
      }
    };
    const handleNavigate = (e) => {
      const url = e.url || '';
      const latest = companyStateRef.current;
      if (url.includes('/auth')) {
        if (latest?.status === 'active') {
          const next = { ...latest, status: 'provisioning' };
          companyStateRef.current = next;
          setCompanyState(next);
        }
        return;
      }
      if (latest?.status === 'active' && latest?.agentaProjectId && latest?.agentaUrl?.includes('/p/')) {
        return;
      }
      const projName = latest?.projectName || company?.projectName;
      if (!projName) return;
      if ((url.includes('/m') || url.includes('/w/')) && !url.includes('/auth')) {
        getAgentaSessionHeaders(webview)
          .then((sessionHeaders) =>
            fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projName)}/company`, {
              headers: sessionHeaders,
            })
          )
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.exists && data.company?.status === 'active' && data.company.agentaUrl?.includes('/p/')) {
              companyStateRef.current = data.company;
              setCompanyState(data.company);
            }
          })
          .catch(() => {});
      }
    };


    webview.addEventListener('dom-ready', handleDomReady);
    webview.addEventListener('did-fail-load', handleDidFailLoad);
    webview.addEventListener('did-navigate', handleNavigate);
    webview.addEventListener('did-navigate-in-page', handleNavigate);

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady);
      webview.removeEventListener('did-fail-load', handleDidFailLoad);
      webview.removeEventListener('did-navigate', handleNavigate);
      webview.removeEventListener('did-navigate-in-page', handleNavigate);
    };
  }, [isElectron, frameKey, companyState?.isInitialCreate, companyState?.projectName, company?.projectName]);

  return (
    <div className={`agenta-embedded-view ${agentaTheme === 'light' ? 'ag-bb-theme-light' : 'ag-bb-theme-dark'}`}>
      {/* 80degrees Native Top Bar */}
      <header className="agenta-embedded-header">
        <div className="agenta-embedded-header__left">
          <button
            type="button"
            className="agenta-embedded-btn agenta-embedded-btn--back"
            onClick={onBack}
            title="Return to previous view"
          >
            <ArrowLeftIcon />
            <span>Back</span>
          </button>

          <div className="agenta-embedded-breadcrumb">
            <span className="agenta-embedded-breadcrumb__root">80degrees</span>
            <span className="agenta-embedded-breadcrumb__sep">/</span>
            <span className="agenta-embedded-breadcrumb__company">
              <BuildingIcon size={12} />
              <span>{company?.name || company?.projectName || 'Company Portal'}</span>
            </span>
          </div>
        </div>

        <div className="agenta-embedded-header__right">
          {activeProjectName && (
            <button
              type="button"
              className={`agenta-embedded-btn agenta-embedded-btn--blackboard ${
                isBlackboardOpen ? 'agenta-embedded-btn--active' : ''
              }`}
              onClick={() => setIsBlackboardOpen((v) => !v)}
              title="Blackboard (Tasks, Approvals & Artifacts)"
            >
              <KanbanIcon size={14} />
              <span>Blackboard</span>
              {bbMetrics.totalTasks > 0 && (
                <span className="agenta-embedded-badge">{bbMetrics.totalTasks}</span>
              )}
              {bbMetrics.pendingApprovals > 0 && (
                <span className="agenta-embedded-badge agenta-embedded-badge--alert">
                  {bbMetrics.pendingApprovals} waiting
                </span>
              )}
            </button>
          )}
        </div>
      </header>
      {/* Main View Area */}
      <div className="agenta-embedded-content">
        {isLoading && !loadError && (
          <div className="agenta-embedded-loading-bar">
            <div className="agenta-embedded-loading-bar__pulse" />
          </div>
        )}

        {loadError ? (
          <div className="agenta-embedded-offline-state">
            <div className="agenta-embedded-offline-state__icon">
              <BuildingIcon size={32} />
            </div>
            <h3 className="agenta-embedded-offline-state__title">Agenta Dashboard Offline</h3>
            <p className="agenta-embedded-offline-state__desc">
              Could not connect to Agenta at <code>{targetUrl}</code>. Ensure the headless Agenta Docker container is running.
            </p>
            <div className="agenta-embedded-offline-state__code">
              <code>docker compose up -d</code>
            </div>
            <div className="agenta-embedded-offline-state__actions">
              <button
                type="button"
                className="agenta-embedded-btn agenta-embedded-btn--primary"
                onClick={handleReload}
              >
                <RefreshIcon size={12} />
                <span>Retry Connection</span>
              </button>
              <button
                type="button"
                className="agenta-embedded-btn"
                onClick={handleOpenExternal}
              >
                <ExternalLinkIcon size={12} />
                <span>Open External URL</span>
              </button>
              <button
                type="button"
                className="agenta-embedded-btn"
                onClick={onBack}
              >
                <span>Back to App</span>
              </button>
            </div>
          </div>
        ) : companyState?.isInitialCreate ? null : isElectron ? (
          <webview
            key={frameKey}
            ref={webviewRef}
            src={targetUrl}
            className="agenta-embedded-webview"
            allowpopups="true"
          />
        ) : (
          <iframe
            key={frameKey}
            src={targetUrl}
            className="agenta-embedded-iframe"
            title="Agenta Dashboard"
            onLoad={() => setIsLoading(false)}
            onError={() => {
              setIsLoading(false);
              setLoadError(true);
            }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-presentation allow-downloads"
          />
        )}

        <BlackboardPanel
          projectName={activeProjectName}
          companyAgents={companyState?.agents || company?.agents || []}
          isReady={Boolean(activeProjectName)}
          theme={agentaTheme}
          isOpen={isBlackboardOpen}
          onClose={() => setIsBlackboardOpen(false)}
          onMetricsUpdate={setBbMetrics}
          onOpenSpecialistChat={handleOpenSpecialistChat}
          onSendTaskToEngineering={
            typeof onSendTaskToEngineering === 'function'
              ? (task) => onSendTaskToEngineering(activeProjectName, task)
              : typeof onOpenProject === 'function'
              ? (task) => onOpenProject({ name: activeProjectName, task })
              : undefined
          }
        />
      </div>
    </div>
  );
}
