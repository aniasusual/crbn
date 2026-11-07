import React, { useState, useRef, useEffect } from 'react';
import './SessionsDrawer.css';

function formatTimeAgo(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  const now = new Date();
  const diffSec = Math.floor((now.getTime() - date.getTime()) / 1000);
  if (diffSec < 60) return 'Just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function SessionsDrawer({
  sessions = [],
  activeSessionId = null,
  isOpen = true,
  onToggle = null,
  onCreateSession = null,
  onSwitchSession = null,
  onDeleteSession = null,
  onRenameSession = null,
  disabled = false,
}) {
  const [filterQuery, setFilterQuery] = useState('');
  const [editingSessionId, setEditingSessionId] = useState(null);
  const [editTitle, setEditTitle] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const editInputRef = useRef(null);

  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  const handleStartRename = (e, session) => {
    e.stopPropagation();
    setEditingSessionId(session.id);
    setEditTitle(session.title || '');
    setConfirmDeleteId(null);
  };

  const handleCommitRename = (sessionId) => {
    if (editTitle.trim() && onRenameSession) {
      onRenameSession(sessionId, editTitle.trim());
    }
    setEditingSessionId(null);
  };

  const handleRenameKeyDown = (e, sessionId) => {
    if (e.key === 'Enter') {
      handleCommitRename(sessionId);
    } else if (e.key === 'Escape') {
      setEditingSessionId(null);
    }
  };

  const handleDeleteClick = (e, session) => {
    e.stopPropagation();
    setConfirmDeleteId(session.id);
  };

  const handleConfirmDelete = (e, sessionId) => {
    e.stopPropagation();
    if (onDeleteSession) {
      onDeleteSession(sessionId);
    }
    setConfirmDeleteId(null);
  };

  const filteredSessions = sessions.filter((s) => {
    if (!filterQuery.trim()) return true;
    const q = filterQuery.toLowerCase();
    return (
      (s.title && s.title.toLowerCase().includes(q)) ||
      (s.firstMessage && s.firstMessage.toLowerCase().includes(q))
    );
  });

  return (
    <aside className={`sessions-drawer ${isOpen ? 'sessions-drawer--open' : 'sessions-drawer--collapsed'}`}>
      {isOpen ? (
        <div className="sessions-drawer__content">
          {/* Header */}
          <div className="sessions-drawer__header">
            <div className="sessions-drawer__title-wrap">
              <span className="sessions-drawer__title">Sessions</span>
              <span className="sessions-drawer__count">{sessions.length}</span>
            </div>
            <div className="sessions-drawer__header-actions">
              <button
                type="button"
                className="sessions-drawer__new-btn"
                onClick={() => onCreateSession?.()}
                disabled={disabled}
                title="Create a new conversation session in this project"
                aria-label="New Session"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
                <span>New</span>
              </button>
              <button
                type="button"
                className="sessions-drawer__toggle-btn"
                onClick={onToggle}
                title="Collapse sessions sidebar"
                aria-label="Collapse sidebar"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="15 18 9 12 15 6" />
                </svg>
              </button>
            </div>
          </div>

          {/* Optional Filter */}
          {sessions.length >= 3 && (
            <div className="sessions-drawer__filter-wrap">
              <svg className="sessions-drawer__filter-icon" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="sessions-drawer__filter-input"
                placeholder="Filter sessions..."
                value={filterQuery}
                onChange={(e) => setFilterQuery(e.target.value)}
              />
              {filterQuery && (
                <button
                  type="button"
                  className="sessions-drawer__filter-clear"
                  onClick={() => setFilterQuery('')}
                >
                  ×
                </button>
              )}
            </div>
          )}

          {/* Session List */}
          <div className="sessions-drawer__list">
            {filteredSessions.length === 0 ? (
              <div className="sessions-drawer__empty">
                {filterQuery ? 'No matching sessions' : 'No sessions yet'}
              </div>
            ) : (
              filteredSessions.map((session) => {
                const isActive = session.id === activeSessionId;
                const isEditing = editingSessionId === session.id;
                const isConfirmingDelete = confirmDeleteId === session.id;

                return (
                  <div
                    key={session.id}
                    className={`sessions-drawer__item ${isActive ? 'sessions-drawer__item--active' : ''}`}
                    onClick={() => {
                      if (!isActive && !isEditing && !isConfirmingDelete) {
                        onSwitchSession?.(session.id);
                      }
                    }}
                  >
                    <div className="sessions-drawer__item-top">
                      {isEditing ? (
                        <input
                          ref={editInputRef}
                          type="text"
                          className="sessions-drawer__rename-input"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={() => handleCommitRename(session.id)}
                          onKeyDown={(e) => handleRenameKeyDown(e, session.id)}
                          onClick={(e) => e.stopPropagation()}
                        />
                      ) : (
                        <span
                          className="sessions-drawer__item-title"
                          title={session.title || 'Untitled Session'}
                          onDoubleClick={(e) => handleStartRename(e, session)}
                        >
                          {session.title || 'Untitled Session'}
                        </span>
                      )}

                      {/* Item Actions */}
                      <div className="sessions-drawer__item-actions">
                        <button
                          type="button"
                          className="sessions-drawer__action-btn"
                          onClick={(e) => handleStartRename(e, session)}
                          title="Rename session"
                          disabled={disabled}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          className="sessions-drawer__action-btn sessions-drawer__action-btn--delete"
                          onClick={(e) => handleDeleteClick(e, session)}
                          title="Delete session"
                          disabled={disabled}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Meta Info */}
                    <div className="sessions-drawer__item-meta">
                      <span className="sessions-drawer__item-count">
                        {session.messageCount || 0} {session.messageCount === 1 ? 'msg' : 'msgs'}
                      </span>
                      {session.modified && (
                        <>
                          <span className="sessions-drawer__item-dot">•</span>
                          <span className="sessions-drawer__item-time">
                            {formatTimeAgo(session.modified)}
                          </span>
                        </>
                      )}
                    </div>

                    {/* Delete Confirmation Popover */}
                    {isConfirmingDelete && (
                      <div className="sessions-drawer__delete-confirm" onClick={(e) => e.stopPropagation()}>
                        <div className="sessions-drawer__delete-confirm-text">Delete this session?</div>
                        <div className="sessions-drawer__delete-confirm-actions">
                          <button
                            type="button"
                            className="sessions-drawer__delete-cancel-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setConfirmDeleteId(null);
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            className="sessions-drawer__delete-ok-btn"
                            onClick={(e) => handleConfirmDelete(e, session.id)}
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      ) : (
        /* Collapsed Icon Bar */
        <div className="sessions-drawer__collapsed-bar">
          <button
            type="button"
            className="sessions-drawer__expand-btn"
            onClick={onToggle}
            title="Expand sessions sidebar"
            aria-label="Expand sidebar"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <button
            type="button"
            className="sessions-drawer__collapsed-new-btn"
            onClick={() => onCreateSession?.()}
            disabled={disabled}
            title="New session"
            aria-label="New Session"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <div className="sessions-drawer__collapsed-badge" title={`${sessions.length} sessions in project`}>
            {sessions.length}
          </div>
        </div>
      )}
    </aside>
  );
}
