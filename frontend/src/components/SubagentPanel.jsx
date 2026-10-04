import { useEffect, useRef } from 'react';
import ChatMessage from './ChatMessage';
import { getSubagentDisplayName, convertSubagentEventsToMessages } from './subagentUtils';
import './SubagentPanel.css';

const BackIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"></polyline>
  </svg>
);

const CloseIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

/**
 * SubagentPanel — UI matching ChatPanel for subagent activities and conversations.
 */
export default function SubagentPanel({ subagent, onClose, isActive = false }) {
  const scrollContainerRef = useRef(null);
  const messagesEndRef = useRef(null);
  const isUserScrolledRef = useRef(false);

  const displayName = getSubagentDisplayName(subagent?.name, subagent?.arguments);
  const isRunning = Boolean(isActive && subagent?.status === 'running');
  const status = isRunning
    ? 'running'
    : (subagent?.status === 'failed' ? 'failed' : (subagent?.status === 'interrupted' ? 'interrupted' : 'completed'));

  // Convert subagent telemetry events and activity into standard chat messages
  const messages = convertSubagentEventsToMessages(subagent);

  // Close on Escape key
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Handle scroll tracking
  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 40;
    isUserScrolledRef.current = !isAtBottom;
  };

  // Auto-scroll on new messages
  useEffect(() => {
    if (!isUserScrolledRef.current && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages.length, status]);

  return (
    <div className="subagent-panel-overlay">
      {/* Header — identical layout and style to ChatPanel header */}
      <div className="chat-panel__header subagent-panel__header">
        <div className="chat-panel__status subagent-panel__status-group">
          <button
            type="button"
            className="subagent-panel__back-btn"
            onClick={onClose}
            title="Back to chat (Esc)"
          >
            <BackIcon />
          </button>
          <div className="chat-panel__status-dot chat-panel__status-dot--connected" />
          <span className="subagent-panel__title">{displayName}</span>
        </div>

        <button
          type="button"
          className="subagent-panel__close-btn"
          onClick={onClose}
          title="Close (Esc)"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Messages area — Reuses exact same ChatMessage component */}
      <div
        className="chat-panel__messages subagent-panel__messages"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        {messages.map((msg, i) => (
          <ChatMessage
            key={i}
            message={msg}
            isActive={isRunning && i === messages.length - 1}
          />
        ))}

        {/* Loader when subagent is running and awaiting next action */}
        {isRunning && (
          <div className="chat-msg chat-msg--assistant chat-msg--loading-stream">
            <div className="chat-msg__assistant-row">
              <div className="chat-msg__assistant-icon">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
                  <rect x="9" y="9" width="6" height="6"></rect>
                  <line x1="9" y1="1" x2="9" y2="4"></line>
                  <line x1="15" y1="1" x2="15" y2="4"></line>
                  <line x1="9" y1="20" x2="9" y2="23"></line>
                  <line x1="15" y1="20" x2="15" y2="23"></line>
                </svg>
              </div>
              <div className="chat-msg__loading-box">
                <div className="chat-msg__pulse-dots">
                  <span className="chat-msg__dot"></span>
                  <span className="chat-msg__dot"></span>
                  <span className="chat-msg__dot"></span>
                </div>
                <span className="chat-msg__loading-text">Working on your request...</span>
              </div>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Bottom status area — identical styling to ChatPanel status banner */}
      <div className="chat-panel__input-area subagent-panel__bottom-area">
        <div
          className={`chat-panel__agent-status ${
            isRunning
              ? 'chat-panel__agent-status--running'
              : 'chat-panel__agent-status--idle'
          }`}
        >
          <span className="chat-panel__agent-status-label">
            {isRunning
              ? 'Subagent is running...'
              : status === 'failed'
                ? 'Subagent failed'
                : status === 'interrupted'
                  ? 'Subagent interrupted'
                  : 'Subagent completed'}
          </span>
        </div>
      </div>
    </div>
  );
}
