import React from 'react';
import './TabBar.css';

export default function TabBar({
  tabs = [],
  activeTabId,
  isHomeActive = false,
  onSelectHome,
  onSelectTab,
  onCloseTab,
  onNewTab,
}) {
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
          <div className="tab-bar__tab-icon">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
              <polyline points="9 22 9 12 15 12 15 22"></polyline>
            </svg>
          </div>
          <span className="tab-bar__tab-name">Home</span>
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
                <div className="tab-bar__tab-icon">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                  </svg>
                </div>

                <span className="tab-bar__tab-name">
                  {tab.projectName || 'Untitled'}
                </span>

                {/* Status Indicator Dot */}
                <div className="tab-bar__tab-status">
                  {isGenerating ? (
                    <span className="tab-bar__status-dot tab-bar__status-dot--generating" title="Agent is working..." />
                  ) : isAwaiting ? (
                    <span className="tab-bar__status-dot tab-bar__status-dot--awaiting" title="Waiting for user input" />
                  ) : null}
                </div>

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

    </div>
  );
}
