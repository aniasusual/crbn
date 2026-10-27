import React, { useState, useEffect } from 'react';
import { AnnotatedText } from '@/components/ui/annotated-text';
import { API_BASE_URL } from '../config';
import './TabBar.css';

export default function TabBar({
  tabs = [],
  activeTabId,
  isHomeActive = false,
  onSelectHome,
  onSelectTab,
  onCloseTab,
  onRefreshTab,
  onNewTab,
}) {
  const [updateInfo, setUpdateInfo] = useState(null);
  const [updateStatus, setUpdateStatus] = useState('idle'); // 'idle' | 'updating' | 'ready' | 'error'
  const [updateError, setUpdateError] = useState('');

  useEffect(() => {
    let isMounted = true;
    const checkUpdates = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/system/update/check`);
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data.hasUpdate) {
          setUpdateInfo(data);
        }
      } catch {}
    };

    checkUpdates();
    const interval = setInterval(checkUpdates, 1000 * 60 * 60 * 2); // Every 2 hours
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const handleApplyUpdate = async () => {
    if (updateStatus === 'updating') return;
    if (updateStatus === 'ready') {
      if (window.crbnDesktop?.restartApp) {
        window.crbnDesktop.restartApp();
      } else {
        window.location.reload();
      }
      return;
    }

    setUpdateStatus('updating');
    setUpdateError('');
    try {
      const res = await fetch(`${API_BASE_URL}/api/system/update/apply`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setUpdateStatus('ready');
      } else {
        setUpdateStatus('error');
        setUpdateError(data.error || data.message || 'Update failed');
      }
    } catch (err) {
      setUpdateStatus('error');
      setUpdateError(err.message || 'Network error');
    }
  };
  return (
    <div className="tab-bar">
      <div className="tab-bar__left">
        {/* Pinned Home / Projects Tab */}
        <button
          type="button"
          className={`tab-bar__tab tab-bar__tab--home ${isHomeActive ? 'tab-bar__tab--active' : ''}`}
          onClick={onSelectHome}
          title="Projects / Welcome Screen"
          aria-label="Home"
        >
          {isHomeActive ? (
            <AnnotatedText variant="circle" color="text-orange-500">
              <span className="tab-bar__tab-inner">
                <div className="tab-bar__tab-icon">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                    <polyline points="9 22 9 12 15 12 15 22"></polyline>
                  </svg>
                </div>
                <span className="tab-bar__tab-name">Home</span>
              </span>
            </AnnotatedText>
          ) : (
            <span className="tab-bar__tab-inner">
              <div className="tab-bar__tab-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                  <polyline points="9 22 9 12 15 12 15 22"></polyline>
                </svg>
              </div>
              <span className="tab-bar__tab-name">Home</span>
            </span>
          )}
        </button>

        {/* Project Tabs Scrollable Row */}
        <div className="tab-bar__tabs-scroll">
          {tabs.map((tab) => {
            const isActive = !isHomeActive && tab.id === activeTabId;
            const isGenerating = tab.agentStatus === 'generating';
            const isAwaiting = tab.agentStatus === 'awaiting_human';

            return (
              <div
                key={tab.id}
                className={`tab-bar__tab ${isActive ? 'tab-bar__tab--active' : ''}`}
                onClick={() => onSelectTab(tab.id)}
                title={tab.projectName || 'Project'}
              >
                <span className="tab-bar__tab-inner">
                  <div className="tab-bar__tab-icon">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                  </div>
                  <span className="tab-bar__tab-name">
                    {tab.projectName || 'Untitled'}
                  </span>
                </span>

                {/* Status Indicator Dot */}
                <div className="tab-bar__tab-status">
                  {tab.isConnected === false ? (
                    <span className="tab-bar__status-dot tab-bar__status-dot--offline" title="Agent is disconnected" />
                  ) : isGenerating ? (
                    <span className="tab-bar__status-dot tab-bar__status-dot--generating" title="Agent is working..." />
                  ) : isAwaiting ? (
                    <span className="tab-bar__status-dot tab-bar__status-dot--awaiting" title="Waiting for user input" />
                  ) : null}
                </div>

                {/* Refresh Tab Button */}
                <button
                  type="button"
                  className={`tab-bar__tab-refresh ${tab.isRefreshing ? 'tab-bar__tab-refresh--spinning' : ''}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshTab?.(tab.id);
                  }}
                  title="Refresh tab & reconnect session"
                  aria-label={`Refresh ${tab.projectName}`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
                  </svg>
                </button>

                <button
                  type="button"
                  className="tab-bar__tab-close"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  title="Close tab"
                  aria-label={`Close ${tab.projectName}`}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            );
          })}

          <button
            type="button"
            className="tab-bar__new-btn"
            onClick={onNewTab}
            title="Open or create project (+)"
            aria-label="New Project"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
        </div>
      </div>

      {updateInfo && (
        <div className="tab-bar__right">
          <button
            type="button"
            className={`tab-bar__update-btn ${updateStatus === 'ready' ? 'tab-bar__update-btn--success' : ''}`}
            onClick={handleApplyUpdate}
            title={updateError || (updateStatus === 'ready' ? 'Restart to apply update' : `Update to v${updateInfo.latestVersion}`)}
          >
            {updateStatus === 'idle' && (
              <>
                <span>⚡</span>
                <span>Update to v{updateInfo.latestVersion}</span>
              </>
            )}
            {updateStatus === 'updating' && (
              <>
                <span className="tab-bar__spin">⏳</span>
                <span>Updating...</span>
              </>
            )}
            {updateStatus === 'ready' && (
              <>
                <span>✓</span>
                <span>Restart to apply</span>
              </>
            )}
            {updateStatus === 'error' && (
              <>
                <span>⚠</span>
                <span>Update failed (retry)</span>
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
