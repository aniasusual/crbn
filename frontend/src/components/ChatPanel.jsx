import { useState, useEffect, useRef, useMemo } from 'react';
import BranchSelector from './BranchSelector';
import BranchTreeModal from './BranchTreeModal';
import GitHubSyncModal from './GitHubSyncModal';
import ChatMessage from './ChatMessage';
import CommandApproval from './CommandApproval';
import ModelSelector from './ModelSelector';
import McpConnectModal from './McpConnectModal';
import PluginsModal from './PluginsModal';
import SubagentPanel from './SubagentPanel';
import ContextGauge from './ContextGauge';
import { getSubagentSessionData, isSubagentTool, normalizeSubagentName } from './subagentUtils';
import AttachmentRibbon from './AttachmentRibbon';
import { useMediaAttachments } from '../hooks/useMediaAttachments';
import './ChatPanel.css';
import PlanProposalCard from './PlanProposalCard';

const SendIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5"></line>
    <polyline points="5 12 12 5 19 12"></polyline>
  </svg>
);

const StopIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <rect x="5" y="5" width="14" height="14" rx="2" ry="2"></rect>
  </svg>
);

const ClearIcon = ({ size = 12, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </svg>
);

const SearchIcon = ({ size = 13, className = '' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const ChevronUpIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="18 15 12 9 6 15" />
  </svg>
);

const ChevronDownIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CloseIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18"></line>
    <line x1="6" y1="6" x2="18" y2="18"></line>
  </svg>
);

const ArrowDownIcon = ({ size = 14, className = '' }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
  >
    <line x1="12" y1="4" x2="12" y2="20" />
    <polyline points="19 13 12 20 5 13" />
  </svg>
);

const extractSearchableText = (msg) => {
  if (!msg) return '';
  const parts = [];
  if (typeof msg.content === 'string') parts.push(msg.content);
  if (msg.name) parts.push(msg.name);
  if (msg.arguments) {
    parts.push(typeof msg.arguments === 'string' ? msg.arguments : JSON.stringify(msg.arguments));
  }
  if (msg.result) {
    parts.push(typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result));
  }
  if (msg.summary) parts.push(msg.summary);
  if (msg.question) parts.push(msg.question);
  if (Array.isArray(msg.questions)) {
    for (const q of msg.questions) {
      if (q.question) parts.push(q.question);
      if (Array.isArray(q.options)) {
        for (const opt of q.options) {
          parts.push(typeof opt === 'string' ? opt : opt.label || '');
        }
      }
    }
  }
  if (Array.isArray(msg.files)) {
    for (const f of msg.files) {
      if (f.name) parts.push(f.name);
    }
  }
  return parts.join(' ').toLowerCase();
};

const isUserMessage = (msg) => {
  if (!msg) return false;
  if (msg.role === 'user' || msg.type === 'user') return true;
  if (
    msg.type === 'reset_boundary' ||
    msg.type === 'reset_divider' ||
    msg.role === 'assistant' ||
    msg.type === 'assistant' ||
    msg.type === 'token' ||
    msg.type === 'thinking' ||
    msg.type === 'status' ||
    msg.type === 'compaction_divider' ||
    msg.type === 'compaction' ||
    msg.type === 'tool_call' ||
    msg.type === 'tool_result' ||
    msg.name === 'ask_human' ||
    msg.type === 'ask_human' ||
    (msg.question && msg.role !== 'user') ||
    msg.name === 'todo' ||
    msg.type === 'todo'
  ) {
    return false;
  }
  return Boolean(msg.content);
};

const parseTodoText = (text) => {
  if (!text || typeof text !== 'string') return [];
  const phases = [];
  let currentPhase = null;
  const lines = text.split('\n');
  for (const line of lines) {
    const phaseMatch = line.match(/^\s{2}([A-Za-z0-9_\-\s]+):$/);
    if (phaseMatch) {
      currentPhase = { name: phaseMatch[1].trim(), tasks: [] };
      phases.push(currentPhase);
      continue;
    }
    const taskMatch = line.match(/^\s*-\s*\[([ Xx])\]\s*(.+)$/);
    if (taskMatch) {
      if (!currentPhase) {
        currentPhase = { name: 'Tasks', tasks: [] };
        phases.push(currentPhase);
      }
      const isCompleted = taskMatch[1].toUpperCase() === 'X';
      let content = taskMatch[2].trim();
      let status = isCompleted ? 'completed' : 'pending';
      let blocker = null;

      if (content.endsWith('(in progress)')) {
        status = 'in_progress';
        content = content.replace(/\(in progress\)$/, '').trim();
      } else if (content.endsWith('(dropped)')) {
        status = 'abandoned';
        content = content.replace(/\(dropped\)$/, '').trim();
      } else if (content.includes('(blocked')) {
        status = 'blocked';
        const blockMatch = content.match(/\(blocked(?::\s*([^)]+))?\)$/);
        if (blockMatch && blockMatch[1]) {
          blocker = blockMatch[1].trim();
        }
        content = content.replace(/\(blocked.*?\)$/, '').trim();
      }

      currentPhase.tasks.push({ content, status, blocker });
    }
  }
  return phases;
};

const getTodoStats = (phases = []) => {
  const tasks = phases.flatMap((p) => p.tasks || []);
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const total = tasks.length;
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0;
  const activeTask = tasks.find((t) => t.status === 'in_progress');
  return { completed, total, percent, activeTask };
};


export default function ChatPanel({
  messages,
  onSendMessage,
  onToolResponse,
  isConnected,
  isAgentRunning,
  agentStatus = null,
  onClearStatus,
  onClearContext,
  onUndoClear,
  pendingApproval,
  onApproveCommand,
  onDenyCommand,
  models = [],
  providers = [],
  selectedModel,
  hardwareInfo,
  onSelectModel,
  onRefreshModels,
  contextTelemetry,
  onStopAgent,
  todoState = null,
  _checkpointTimeline = [],
  onRewindToStep = null,
  input: controlledInput,
  onInputChange,
  projectName = '',
  _projectName = '',
  activeBranch = 'main',
  branches = [],
  onSelectBranch,
  _onCreateBranch,
  onDeleteBranch,
  onBranchFromStep,
  mcpState = null,
  onReloadMcp = null,
  pluginsState = null,
  onReloadPlugins = null,
  mode = 'build',
  onToggleMode = null,
  pendingPlanProposal = null,
  onApprovePlan = null,
  onRefinePlan = null,
  onRefreshTab = null,
  queuedMessages = null,
  onRemoveQueuedMessage = null,
}) {
  const [isClearPopoverOpen, setIsClearPopoverOpen] = useState(false);
  const [undoToast, setUndoToast] = useState(null);
  const clearPopoverRef = useRef(null);
  const undoToastTimerRef = useRef(null);
  const [localInput, setLocalInput] = useState('');
  const input = controlledInput !== undefined ? controlledInput : localInput;
  const setInput = onInputChange || setLocalInput;
  const [isQueueExpanded, setIsQueueExpanded] = useState(false);
  const queuedItems = useMemo(() => {
    if (!queuedMessages) return [];
    const items = [];
    if (Array.isArray(queuedMessages.steering)) {
      for (const t of queuedMessages.steering) {
        items.push({ text: typeof t === 'string' ? t : t.text || JSON.stringify(t), type: 'steering' });
      }
    }
    if (Array.isArray(queuedMessages.followUp)) {
      for (const t of queuedMessages.followUp) {
        items.push({ text: typeof t === 'string' ? t : t.text || JSON.stringify(t), type: 'followUp' });
      }
    }
    return items;
  }, [queuedMessages]);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const searchInputRef = useRef(null);

  const matches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q || !Array.isArray(messages)) return [];
    const results = [];
    messages.forEach((msg, idx) => {
      const text = extractSearchableText(msg);
      if (text.includes(q)) {
        results.push({ messageIndex: idx, id: `chat-msg-${idx}` });
      }
    });
    return results;
  }, [messages, searchQuery]);

  const matchingIndices = useMemo(() => {
    return new Set(matches.map((m) => m.messageIndex));
  }, [matches]);

  const currentMatch = matches[activeMatchIndex] || null;

  useEffect(() => {
    if (!currentMatch) return;
    const el = document.getElementById(currentMatch.id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [activeMatchIndex, currentMatch]);

  useEffect(() => {
    setActiveMatchIndex(0);
  }, [searchQuery]);

  const handleNextMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIndex((prev) => (prev + 1) % matches.length);
  };

  const handlePrevMatch = () => {
    if (matches.length === 0) return;
    setActiveMatchIndex((prev) => (prev - 1 + matches.length) % matches.length);
  };

  const handleCloseSearch = () => {
    setIsSearchOpen(false);
    setSearchQuery('');
  };

  const handleSearchInputKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        handlePrevMatch();
      } else {
        handleNextMatch();
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleCloseSearch();
    }
  };


  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
  const connectedMcpCount = (mcpState?.servers || []).filter(
    (s) => s.status === 'connected' && !s.disabled
  ).length;
  const [isPluginsModalOpen, setIsPluginsModalOpen] = useState(false);
  const activePluginsCount = (pluginsState?.plugins || []).filter(
    (p) => p.enabled && !p.shadowed
  ).length;
  const {
    attachments,
    isDragging,
    fileInputRef,
    openFilePicker,
    removeAttachment,
    clearAttachments,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    addFiles,
  } = useMediaAttachments();
  const [selectedSubagentMsg, setSelectedSubagentMsg] = useState(null);
  const [isTodoExpanded, setIsTodoExpanded] = useState(false);
  const [isTreeModalOpen, setIsTreeModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isUserScrolledRef = useRef(false);

  const currentModelObj = models.find((m) => m.id === selectedModel || m.canonical_id === selectedModel) || (
    selectedModel ? { name: selectedModel, compatibility_label: 'Optimal' } : null
  );

  const handleOpenSubagent = (msg) => {
    if (msg && isSubagentTool(msg.name)) {
      setSelectedSubagentMsg(msg);
    }
  };

  const handleCloseSubagent = () => {
    setSelectedSubagentMsg(null);
  };

  // Derive active todo state from todoState prop or latest todo message
  const activeTodos = (() => {
    if (todoState && Array.isArray(todoState.phases) && todoState.phases.length > 0) {
      return todoState;
    }
    if (Array.isArray(messages)) {
      for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        if (!msg) continue;
        if (Array.isArray(msg.phases) && msg.phases.length > 0) {
          return { phases: msg.phases, op: msg.op || 'view' };
        }
        const rawArgs = msg.arguments || msg.data;
        if (rawArgs && Array.isArray(rawArgs.phases) && rawArgs.phases.length > 0) {
          return { phases: rawArgs.phases, op: rawArgs.op || 'view' };
        }
        if (msg.name === 'todo' && msg.result && typeof msg.result === 'string') {
          const parsed = parseTodoText(msg.result);
          if (parsed && parsed.length > 0) {
            return { phases: parsed, op: 'view' };
          }
        }
      }
    }
    return null;
  })();
  const todoStats = activeTodos?.phases ? getTodoStats(activeTodos.phases) : null;

  // Keep active subagent data reactive to incoming live websocket events
  const activeSubagentData = selectedSubagentMsg && isSubagentTool(selectedSubagentMsg.name)
    ? getSubagentSessionData(
        messages?.find((m) => m === selectedSubagentMsg || (selectedSubagentMsg.timestamp && m.timestamp === selectedSubagentMsg.timestamp))
        || messages?.slice().reverse().find(
          (m) =>
            (m.type === 'tool_call' || m.type === 'tool_result') &&
            isSubagentTool(m.name) &&
            (m.name === selectedSubagentMsg.name || normalizeSubagentName(m.name) === normalizeSubagentName(selectedSubagentMsg.name))
        )
        || selectedSubagentMsg,
        messages
      )
    : null;

  const handleScroll = () => {
    const container = scrollContainerRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    const isAtBottom = distanceToBottom < 60;
    isUserScrolledRef.current = !isAtBottom;
    setShowScrollBottom(distanceToBottom > 120);
  };

  const handleScrollToBottomClick = () => {
    isUserScrolledRef.current = false;
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    setShowScrollBottom(false);
  };

  const scrollToBottom = () => {
    if (!isUserScrolledRef.current) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSubmit = (e) => {
    e?.preventDefault();
    const hasContent = input.trim() || attachments.length > 0;
    if (!hasContent || !isConnected) return;

    // Guard: ensure selected model belongs to an authenticated provider
    const isModelAuth = models.some(
      (m) => (m.canonical_id === selectedModel || m.id === selectedModel) && (m.has_auth || m.installed)
    );
    if (models.length > 0 && (!selectedModel || !isModelAuth)) {
      setIsModelSelectorOpen(true);
      return;
    }
    const images = attachments
      .filter((a) => a.type === 'image')
      .map((a) => ({ data: a.data || a.base64, mimeType: a.mimeType, name: a.name }));
    const videos = attachments
      .filter((a) => a.type === 'video')
      .map((a) => ({
        name: a.name,
        data: a.data || a.base64,
        mimeType: a.mimeType,
        size: a.size,
        thumbnailUrl: a.thumbnailUrl,
      }));
    const files = attachments
      .filter((a) => a.type === 'file')
      .map((a) => ({ name: a.name, data: a.data, size: a.size, mimeType: a.mimeType }));
    if (typeof input === 'string' && input.trim() === '/clear') {
      setInput('');
      clearAttachments();
      if (onClearContext) {
        onClearContext();
      } else {
        onSendMessage('/clear');
      }
      return;
    }

    onSendMessage(input, { images, videos, files });
    setInput('');
    clearAttachments();
    isUserScrolledRef.current = false;
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setIsSearchOpen(true);
        setTimeout(() => {
          searchInputRef.current?.focus();
          searchInputRef.current?.select();
        }, 50);
        return;
      }

      if (e.key === 'Escape') {
        if (isSearchOpen) {
          e.preventDefault();
          handleCloseSearch();
          return;
        }
        if (isModelSelectorOpen) return;
        if (selectedSubagentMsg) return;

        if (isAgentRunning && onStopAgent) {
          e.preventDefault();
          onStopAgent();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [isAgentRunning, onStopAgent, isModelSelectorOpen, selectedSubagentMsg, isSearchOpen]);

  useEffect(() => {
    const handleOutsideClick = (e) => {
      if (clearPopoverRef.current && !clearPopoverRef.current.contains(e.target)) {
        setIsClearPopoverOpen(false);
      }
    };
    if (isClearPopoverOpen) {
      document.addEventListener('mousedown', handleOutsideClick);
    }
    return () => document.removeEventListener('mousedown', handleOutsideClick);
  }, [isClearPopoverOpen]);

  const handleExecuteClear = () => {
    setIsClearPopoverOpen(false);
    onClearContext?.();
    setUndoToast({ visible: true });
    clearTimeout(undoToastTimerRef.current);
    undoToastTimerRef.current = setTimeout(() => {
      setUndoToast(null);
    }, 8000);
  };
  const handleKeyDown = (e) => {
    if (e.key === 'Escape' && isAgentRunning && onStopAgent) {
      e.preventDefault();
      onStopAgent();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Determine whether the agent has started streaming any content (tokens, thinking, tool calls)
  // for the current user request.
  const lastUserIndex = messages && messages.length > 0
    ? messages.map((m) => m.role === 'user' || m.type === 'user').lastIndexOf(true)
    : -1;
  const messagesAfterUser = lastUserIndex >= 0 ? messages.slice(lastUserIndex + 1) : messages || [];
  const hasStreamingStarted = messagesAfterUser.some(
    (m) => m.type === 'token' || m.type === 'thinking' || m.type === 'tool_call' || m.type === 'tool_result' || m.role === 'assistant'
  );
  const showLoader = isAgentRunning && !hasStreamingStarted;

  return (
    <div className={`chat-panel ${mode === 'plan' ? 'chat-panel--plan-mode' : 'chat-panel--build-mode'}`}>
      <div className="chat-panel__mode-backdrop" aria-hidden="true" />
      <div className="chat-panel__header">
        <div className="chat-panel__header-left">
          <span className="chat-panel__project-title">{projectName || _projectName || 'Workspace'}</span>
        </div>
        <div className="chat-panel__header-right">
          <div className="chat-panel__clear-wrap" ref={clearPopoverRef}>
            <button
              type="button"
              className={`chat-panel__clear-btn ${isClearPopoverOpen ? 'chat-panel__clear-btn--active' : ''}`}
              onClick={() => setIsClearPopoverOpen((prev) => !prev)}
              disabled={Boolean(isAgentRunning)}
              title={
                isAgentRunning
                  ? "Cannot clear context while agent is generating"
                  : "Clear conversation context in place — drops message history from model memory while keeping workspace files, checkpoints, and git branches intact."
              }
              aria-label="Clear conversation context"
              aria-expanded={isClearPopoverOpen}
            >
              <ClearIcon size={12} />
              <span>Clear</span>
            </button>
            {isClearPopoverOpen && (
              <div className="chat-panel__clear-popover">
                <div className="chat-panel__clear-popover-title">Reset Conversation Context?</div>
                <div className="chat-panel__clear-popover-desc">
                  AI memory will be dropped. Your workspace files, git commits, and checkpoints remain safe.
                </div>
                <div className="chat-panel__clear-popover-actions">
                  <button
                    type="button"
                    className="chat-panel__clear-popover-cancel"
                    onClick={() => setIsClearPopoverOpen(false)}
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    className="chat-panel__clear-popover-confirm"
                    onClick={handleExecuteClear}
                  >
                    Clear Context
                  </button>
                </div>
              </div>
            )}
          </div>
          <button
            type="button"
            className={`chat-panel__search-toggle-btn ${isSearchOpen ? 'chat-panel__search-toggle-btn--active' : ''}`}
            onClick={() => {
              setIsSearchOpen((prev) => {
                const next = !prev;
                if (next) {
                  setTimeout(() => {
                    searchInputRef.current?.focus();
                    searchInputRef.current?.select();
                  }, 50);
                } else {
                  setSearchQuery('');
                }
                return next;
              });
            }}
            title="Find in chat (Cmd+F)"
            aria-label="Find in chat"
          >
            <SearchIcon size={12} />
          </button>
          <button
            type="button"
            className="chat-panel__gh-btn"
            onClick={() => setIsSyncModalOpen(true)}
            title="Push changes to GitHub or publish repository"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
            </svg>
            <span>Push</span>
          </button>
          <BranchSelector
            activeBranch={activeBranch}
            branches={branches}
            onSelectBranch={onSelectBranch}
            onDeleteBranch={onDeleteBranch}
            onOpenTreeView={() => setIsTreeModalOpen(true)}
            disabled={Boolean(isAgentRunning)}
          />
        </div>
      </div>
      {/* Floating Apple-style Glassmorphic Chat Search Bar */}
      {isSearchOpen && (
        <div className="chat-panel__search-bar">
          <div className="chat-panel__search-input-wrap">
            <SearchIcon size={12} className="chat-panel__search-icon" />
            <input
              ref={searchInputRef}
              type="text"
              className="chat-panel__search-input"
              placeholder="Find in chat..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchInputKeyDown}
              autoFocus
              spellCheck="false"
            />
          </div>

          <div className="chat-panel__search-controls">
            {searchQuery.trim() && (
              <span className="chat-panel__search-counter">
                {matches.length > 0 ? `${activeMatchIndex + 1} of ${matches.length}` : 'No matches'}
              </span>
            )}
            <div className="chat-panel__search-nav">
              <button
                type="button"
                className="chat-panel__search-nav-btn"
                onClick={handlePrevMatch}
                disabled={matches.length === 0}
                title="Previous match (Shift+Enter)"
                aria-label="Previous match"
              >
                <ChevronUpIcon size={11} />
              </button>
              <button
                type="button"
                className="chat-panel__search-nav-btn"
                onClick={handleNextMatch}
                disabled={matches.length === 0}
                title="Next match (Enter)"
                aria-label="Next match"
              >
                <ChevronDownIcon size={11} />
              </button>
            </div>
            <button
              type="button"
              className="chat-panel__search-close-btn"
              onClick={handleCloseSearch}
              title="Close search (Esc)"
              aria-label="Close search"
            >
              <CloseIcon size={11} />
            </button>
          </div>
        </div>
      )}



      <div
        className="chat-panel__messages"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        {(() => {
          const lastBoundaryIndex = (messages || []).findLastIndex(
            (m) => m.type === 'reset_boundary' || m.type === 'reset_divider'
          );
          return messages?.map((msg, i) => {
            const isDivider = msg.type === 'reset_boundary' || msg.type === 'reset_divider';
            const isUser = !isDivider && isUserMessage(msg);
            const isOutOfContext = lastBoundaryIndex >= 0 && i < lastBoundaryIndex;
            return (
              <div
                key={msg.id || i}
                id={`chat-msg-${i}`}
                className={`chat-panel__msg-wrapper ${isDivider ? 'chat-panel__msg-wrapper--divider' : isUser ? 'chat-panel__msg-wrapper--user' : ''} ${currentMatch?.messageIndex === i ? 'chat-panel__msg-wrapper--active-match' : ''}`}
              >
                <ChatMessage
                  message={msg}
                  isActive={isAgentRunning && i === messages.length - 1}
                  isOutOfContext={isOutOfContext}
                  isSearchActive={currentMatch?.messageIndex === i}
                  isSearchMatch={matchingIndices.has(i)}
                  onOpenSubagent={handleOpenSubagent}
                  onToolResponse={onToolResponse}
                  onSelectOption={(answer, qId) => {
                    if (onToolResponse) {
                      onToolResponse(qId || msg.id, answer);
                    } else if (onSendMessage) {
                      onSendMessage(answer);
                    }
                  }}
                  onRewindToStep={onRewindToStep}
                  onBranchFromStep={(stepId, name) => onBranchFromStep?.(stepId, name, activeBranch)}
                />
              </div>
            );
          });
        })()}
        {/* Loader in chat area when agent is working and response has not started streaming yet */}
        {showLoader && (
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

      {showScrollBottom && (
        <div className="chat-panel__scroll-bottom-anchor">
          <button
            type="button"
            className="chat-panel__scroll-bottom-btn"
            onClick={handleScrollToBottomClick}
            title="Scroll to bottom"
            aria-label="Scroll to bottom"
          >
            <ArrowDownIcon size={14} />
          </button>
        </div>
      )}


      <CommandApproval
        request={pendingApproval}
        onApprove={onApproveCommand}
        onDeny={onDenyCommand}
      />

      <PlanProposalCard
        proposal={pendingPlanProposal}
        onApprove={onApprovePlan}
        onRefine={onRefinePlan}
      />
      {/* Collapsible Todo Progress Sheet docked right above the input box */}
      {/* {activeTodos && activeTodos.phases && activeTodos.phases.length > 0 && todoStats && (
        <div className={`chat-panel__todo-sheet ${isTodoExpanded ? 'chat-panel__todo-sheet--expanded' : ''}`}>
          <div
            className="chat-panel__todo-ribbon"
            onClick={() => setIsTodoExpanded((prev) => !prev)}
            title="Toggle task checklist"
          >
            <div className="chat-panel__todo-ribbon-left">
              <span className="chat-panel__todo-title">
                Tasks · {todoStats.completed} of {todoStats.total}
              </span>
              {todoStats.activeTask && (
                <span className="chat-panel__todo-active-chip" title={todoStats.activeTask.content}>
                  {todoStats.activeTask.content}
                </span>
              )}
            </div>
            <div className="chat-panel__todo-ribbon-right">
              <span className="chat-panel__todo-toggle-label">{isTodoExpanded ? 'Hide' : 'Show'}</span>
              <svg
                className={`chat-panel__todo-chevron ${isTodoExpanded ? 'chat-panel__todo-chevron--up' : ''}`}
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>

          {isTodoExpanded && (
            <div className="chat-panel__todo-content">
              {activeTodos.phases.map((phase, pIdx) => {
                const pCompleted = (phase.tasks || []).filter((t) => t.status === 'completed').length;
                const pTotal = (phase.tasks || []).length;
                return (
                  <div key={pIdx} className="chat-panel__todo-phase">
                    <div className="chat-panel__todo-phase-head">
                      <span className="chat-panel__todo-phase-title">{phase.name}</span>
                      <span className="chat-panel__todo-phase-count">{pCompleted}/{pTotal}</span>
                    </div>
                    <div className="chat-panel__todo-task-list">
                      {(phase.tasks || []).map((task, tIdx) => {
                        const isDone = task.status === 'completed';
                        const isRunning = task.status === 'in_progress';
                        const isBlocked = task.status === 'blocked';
                        const isDropped = task.status === 'abandoned';

                        return (
                          <div
                            key={tIdx}
                            className={`chat-panel__todo-task-item ${isDone ? 'chat-panel__todo-task-item--done' : ''}`}
                          >
                            <span className="chat-panel__todo-checkbox">
                              {isDone ? '✓' : ''}
                            </span>
                            <span className={`chat-panel__todo-item-text ${isDone || isDropped ? 'chat-panel__todo-item-text--done' : ''} ${isRunning ? 'chat-panel__todo-item-text--active' : ''}`}>
                              {task.content}
                              {isRunning && <span className="chat-panel__todo-status-note">in progress</span>}
                              {isBlocked && (
                                <span className="chat-panel__todo-status-note">
                                  {task.blocker ? `blocked: ${task.blocker}` : 'blocked'}
                                </span>
                              )}
                              {isDropped && <span className="chat-panel__todo-status-note">dropped</span>}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )} */}
      {undoToast && (
        <div className="chat-panel__undo-toast">
          <span>Context reset. Previous messages dropped from model memory.</span>
          <button
            type="button"
            className="chat-panel__undo-toast-btn"
            onClick={() => {
              setUndoToast(null);
              clearTimeout(undoToastTimerRef.current);
              onUndoClear?.();
            }}
          >
            Undo
          </button>
        </div>
      )}
      {contextTelemetry && contextTelemetry.usage_pct >= 70 && (
        <div className={`chat-panel__context-alert chat-panel__context-alert--${contextTelemetry.usage_pct >= 85 ? 'critical' : 'warning'}`}>
          <div className="chat-panel__context-alert-content">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <span>
              Context window is <strong>{contextTelemetry.usage_pct}% full</strong>. Clear context soon to keep responses fast.
            </span>
          </div>
          <button
            type="button"
            className="chat-panel__context-alert-btn"
            onClick={() => setIsClearPopoverOpen(true)}
          >
            Clear Context
          </button>
        </div>
      )}
      <form
        className="chat-panel__input-area"
        onSubmit={handleSubmit}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onPaste={handlePaste}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/*,.mp4,.webm,.mov,.mkv,.avi,.m4v,.pdf,.txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.py,.html,.css"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) addFiles(Array.from(e.target.files));
          }}
        />
        {/* Plan Mode Active Banner: located ABOVE the agent status strip */}
        {mode === 'plan' && (
          <div className="chat-panel__plan-mode-banner">
            <svg className="chat-panel__plan-mode-banner-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
              <polyline points="14 2 14 8 20 8"></polyline>
              <line x1="16" y1="13" x2="8" y2="13"></line>
              <line x1="16" y1="17" x2="8" y2="17"></line>
            </svg>
            <span className="chat-panel__plan-mode-banner-text">Plan mode active</span>
          </div>
        )}

        {/* Collapsible Queued Messages List docked above the input box */}
        {queuedItems.length > 0 && (
          <div className={`chat-panel__queue-sheet ${isQueueExpanded ? 'chat-panel__queue-sheet--expanded' : ''}`}>
            <div
              className="chat-panel__queue-ribbon"
              onClick={() => setIsQueueExpanded((prev) => !prev)}
              title="Toggle queued messages"
            >
              <div className="chat-panel__queue-ribbon-left">
                <svg className="chat-panel__queue-ribbon-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6"></line>
                  <line x1="8" y1="12" x2="21" y2="12"></line>
                  <line x1="8" y1="18" x2="21" y2="18"></line>
                  <line x1="3" y1="6" x2="3.01" y2="6"></line>
                  <line x1="3" y1="12" x2="3.01" y2="12"></line>
                  <line x1="3" y1="18" x2="3.01" y2="18"></line>
                </svg>
                <span className="chat-panel__queue-title">
                  Queued · {queuedItems.length}
                </span>
                <span className="chat-panel__queue-preview" title={queuedItems[0].text}>
                  &ldquo;{queuedItems[0].text.length > 36 ? `${queuedItems[0].text.slice(0, 36)}…` : queuedItems[0].text}&rdquo;
                </span>
              </div>
              <div className="chat-panel__queue-ribbon-right">
                <span className="chat-panel__queue-toggle-label">{isQueueExpanded ? 'Hide' : 'Show'}</span>
                <svg
                  className={`chat-panel__queue-chevron ${isQueueExpanded ? 'chat-panel__queue-chevron--up' : ''}`}
                  width="11"
                  height="11"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </div>
            </div>

            {isQueueExpanded && (
              <div className="chat-panel__queue-body">
                {queuedItems.map((item, idx) => (
                  <div key={idx} className="chat-panel__queue-item">
                    <div className="chat-panel__queue-item-left">
                      <span className="chat-panel__queue-item-index">#{idx + 1}</span>
                      <span className="chat-panel__queue-item-text" title={item.text}>{item.text}</span>
                    </div>
                    <div className="chat-panel__queue-item-actions">
                      <span className="chat-panel__queue-item-badge">
                        {item.type === 'steering' ? 'Steer' : 'Next Turn'}
                      </span>
                      {onRemoveQueuedMessage && (
                        <button
                          type="button"
                          className="chat-panel__queue-item-remove"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveQueuedMessage(item.text, item.type);
                          }}
                          title="Remove from queue"
                          aria-label="Remove from queue"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Status Strip above input box (Online, Offline, Generating, Awaiting, Done) */}
        <div
          className={`chat-panel__status-strip chat-panel__status-strip--${
            !isConnected
              ? 'offline'
              : agentStatus === 'generating'
              ? 'generating'
              : agentStatus === 'awaiting_human'
              ? 'awaiting_human'
              : agentStatus === 'done'
              ? 'done'
              : 'online'
          }`}
        >
          <span className="chat-panel__status-strip-text">
            {!isConnected
              ? 'Agent is offline · Engine disconnected'
              : agentStatus === 'generating'
              ? 'Agent is generating...'
              : agentStatus === 'awaiting_human'
              ? 'Agent is awaiting human response'
              : agentStatus === 'done'
              ? 'Done'
              : 'Agent is online'}
          </span>
          {!isConnected && onRefreshTab && (
            <button
              type="button"
              className="chat-panel__reconnect-btn"
              onClick={onRefreshTab}
              title="Reconnect agent & reload project session"
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67" />
              </svg>
              <span>Reconnect</span>
            </button>
          )}
        </div>

        {/* Attachment preview directly ABOVE the input box */}
        {attachments && attachments.length > 0 && (
          <div style={{ padding: '0 4px' }}>
            <AttachmentRibbon attachments={attachments} onRemove={removeAttachment} />
          </div>
        )}
        <div
          className={`chat-panel__input-wrapper ${
            isDragging ? 'chat-panel__input-wrapper--dragging' : ''
          }`}
        >
          <textarea
            className="chat-panel__input"
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              if (agentStatus === 'done') {
                onClearStatus?.();
              }
            }}
            onKeyDown={handleKeyDown}
            placeholder={
              !isConnected
                ? 'Connecting...'
                : isAgentRunning
                ? 'Type a message to queue for next turn...'
                : agentStatus === 'awaiting_human'
                ? 'Answer the agent...'
                : mode === 'plan'
                ? 'Describe what you want to plan (working tree is read-only)...'
                : 'Describe a change...'
            }
            disabled={!isConnected}
          />

          {/* Bottom footer containing Model Selector & Context Gauge chips on left, and send button on right */}
          <div className="chat-panel__input-footer">
            <div className="chat-panel__input-footer-left">
              <button
                type="button"
                className="chat-panel__attach-btn"
                onClick={openFilePicker}
                title="Attach media or files"
                aria-label="Attach files"
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                </svg>
              </button>

              <button
                type="button"
                className="chat-panel__model-pill"
                onClick={() => setIsModelSelectorOpen(true)}
                title="Change active model"
              >
                <span className="chat-panel__model-pill-icon">✦</span>
                <span className="chat-panel__model-name">
                  {currentModelObj?.name || selectedModel || 'Select a model...'}
                </span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              <button
                type="button"
                className={`chat-panel__mcp-btn ${connectedMcpCount > 0 ? 'chat-panel__mcp-btn--active' : ''}`}
                onClick={() => setIsMcpModalOpen(true)}
                title="Connect Model Context Protocol (MCP) servers"
                aria-label="Connect MCP servers"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22v-5"/>
                  <path d="M9 8V2"/>
                  <path d="M15 8V2"/>
                  <path d="M18 8v5a6 6 0 0 1-12 0V8z"/>
                </svg>
                <span>MCP</span>
                {connectedMcpCount > 0 && (
                  <span className="chat-panel__mcp-badge">{connectedMcpCount}</span>
                )}
              </button>

              <button
                type="button"
                className={`chat-panel__plugin-btn ${activePluginsCount > 0 ? 'chat-panel__plugin-btn--active' : ''}`}
                onClick={() => setIsPluginsModalOpen(true)}
                title="Manage Extensions & Plugins"
                aria-label="Manage Extensions & Plugins"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                  <line x1="7" y1="7" x2="7.01" y2="7"/>
                </svg>
                <span>Plugins</span>
                {activePluginsCount > 0 && (
                  <span className="chat-panel__plugin-badge">{activePluginsCount}</span>
                )}
              </button>

              <ContextGauge telemetry={contextTelemetry} />

              <div className="chat-panel__mode-segmented" role="radiogroup" aria-label="Mode">
                <button
                  type="button"
                  className={`chat-panel__mode-seg-btn ${mode === 'build' ? 'chat-panel__mode-seg-btn--active' : ''}`}
                  onClick={() => onToggleMode?.('build')}
                  title="Build Mode: Agent directly edits and creates files"
                  aria-checked={mode === 'build'}
                  role="radio"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                  </svg>
                  <span>Build</span>
                </button>
                <button
                  type="button"
                  className={`chat-panel__mode-seg-btn ${mode === 'plan' ? 'chat-panel__mode-seg-btn--active-plan' : ''}`}
                  onClick={() => onToggleMode?.('plan')}
                  title="Plan Mode: Working tree is read-only. Agent explores and designs an execution plan"
                  aria-checked={mode === 'plan'}
                  role="radio"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                  </svg>
                  <span>Plan</span>
                </button>
              </div>
            </div>

            <div className="chat-panel__input-footer-right">
              <span className="chat-panel__hint">
                <kbd className="degrees-keycap">{isAgentRunning && (!input.trim() && attachments.length === 0) ? 'Esc' : '↵'}</kbd>
              </span>
              {isAgentRunning ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {(input.trim() || attachments.length > 0) && (
                    <button
                      type="submit"
                      className="chat-panel__send chat-panel__send--queue"
                      title="Queue message for next turn (↵)"
                      aria-label="Queue message"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="8" y1="6" x2="21" y2="6"></line>
                        <line x1="8" y1="12" x2="21" y2="12"></line>
                        <line x1="8" y1="18" x2="21" y2="18"></line>
                        <line x1="3" y1="6" x2="3.01" y2="6"></line>
                        <line x1="3" y1="12" x2="3.01" y2="12"></line>
                        <line x1="3" y1="18" x2="3.01" y2="18"></line>
                      </svg>
                      <span>Queue</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="chat-panel__send chat-panel__send--stop"
                    onClick={onStopAgent}
                    title="Stop agent (Esc)"
                    aria-label="Stop agent"
                  >
                    <StopIcon />
                    <span>Stop</span>
                  </button>
                </div>
              ) : (
                <button
                  type="submit"
                  className="chat-panel__send"
                  disabled={(!input.trim() && attachments.length === 0) || !isConnected}
                  title="Send message"
                >
                  <SendIcon />
                </button>
              )}
            </div>
          </div>
        </div>
      </form>

      {/* Model Selector Modal */}
      <ModelSelector
        isOpen={isModelSelectorOpen}
        onClose={() => setIsModelSelectorOpen(false)}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        hardwareInfo={hardwareInfo}
        models={models}
        providers={providers}
        onRefreshModels={onRefreshModels}
      />

      {/* Subagent Activity Panel Overlay */}
      {activeSubagentData && (
        <SubagentPanel
          subagent={activeSubagentData}
          onClose={handleCloseSubagent}
          isActive={isAgentRunning}
        />
      )}

      {/* Complete Branch & Checkpoint Tree Modal */}
      <BranchTreeModal
        isOpen={isTreeModalOpen}
        onClose={() => setIsTreeModalOpen(false)}
        projectName={projectName || _projectName}
        activeBranch={activeBranch}
        onSelectBranch={onSelectBranch}
        onBranchFromStep={onBranchFromStep}
      />

      {/* GitHub Sync & Publish Modal */}
      <GitHubSyncModal
        isOpen={isSyncModalOpen}
        onClose={() => setIsSyncModalOpen(false)}
        projectName={projectName || _projectName}
        activeBranch={activeBranch}
        isAgentRunning={Boolean(isAgentRunning)}
      />

      {/* MCP Connect Modal */}
      <McpConnectModal
        isOpen={isMcpModalOpen}
        onClose={() => setIsMcpModalOpen(false)}
        projectName={projectName || _projectName}
        onReloadMcp={onReloadMcp}
      />

      {/* Plugins & Extensions Modal */}
      <PluginsModal
        isOpen={isPluginsModalOpen}
        onClose={() => setIsPluginsModalOpen(false)}
        projectName={projectName || _projectName}
        onReloadPlugins={onReloadPlugins}
      />
    </div>
  );
}
