import { useState, useEffect, useRef } from 'react';
import BranchSelector from './BranchSelector';
import BranchTreeModal from './BranchTreeModal';
import GitHubSyncModal from './GitHubSyncModal';
import ChatMessage from './ChatMessage';
import CommandApproval from './CommandApproval';
import ModelSelector from './ModelSelector';
import SubagentPanel from './SubagentPanel';
import ContextGauge from './ContextGauge';
import { getSubagentSessionData, isSubagentTool, normalizeSubagentName } from './subagentUtils';
import AttachmentRibbon from './AttachmentRibbon';
import { useMediaAttachments } from '../hooks/useMediaAttachments';
import './ChatPanel.css';

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
}) {
  const [localInput, setLocalInput] = useState('');
  const input = controlledInput !== undefined ? controlledInput : localInput;
  const setInput = onInputChange || setLocalInput;
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
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
  const messagesEndRef = useRef(null);
  const scrollContainerRef = useRef(null);
  const isUserScrolledRef = useRef(false);

  const currentModelObj = models.find((m) => m.id === selectedModel || m.canonical_id === selectedModel) || {
    name: selectedModel || 'gemini-3.8-flash',
    compatibility_label: 'Optimal',
  };

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
    const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50;
    isUserScrolledRef.current = !isAtBottom;
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
    e.preventDefault();
    const hasContent = input.trim() || attachments.length > 0;
    if (!hasContent || !isConnected || isAgentRunning) return;

    const images = attachments
      .filter((a) => a.type === 'image')
      .map((a) => ({ data: a.base64, mimeType: a.mimeType, name: a.name }));
    const files = attachments
      .filter((a) => a.type === 'file')
      .map((a) => ({ name: a.name, content: a.content, size: a.size }));

    onSendMessage(input, { images, files });
    setInput('');
    clearAttachments();

    isUserScrolledRef.current = false;
    setTimeout(() => {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, 50);
  };

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
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
  }, [isAgentRunning, onStopAgent, isModelSelectorOpen, selectedSubagentMsg]);

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
    <div className="chat-panel">
      <div className="chat-panel__header">
        <div className="chat-panel__header-left">
          <span className="chat-panel__project-title">{projectName || _projectName || 'Workspace'}</span>
        </div>
        <div className="chat-panel__header-right">
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


      <div
        className="chat-panel__messages"
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        {messages?.map((msg, i) => (
          <ChatMessage
            key={i}
            message={msg}
            isActive={isAgentRunning && i === messages.length - 1}
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
        ))}
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


      <CommandApproval
        request={pendingApproval}
        onApprove={onApproveCommand}
        onDeny={onDenyCommand}
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
          accept="image/*,.pdf,.txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.py,.html,.css"
          style={{ display: 'none' }}
          onChange={(e) => {
            if (e.target.files) addFiles(Array.from(e.target.files));
          }}
        />

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
                : agentStatus === 'generating'
                ? 'Agent is generating...'
                : agentStatus === 'awaiting_human'
                ? 'Answer the agent...'
                : 'Describe a change...'
            }
            disabled={!isConnected || isAgentRunning}
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
                  {currentModelObj.name || selectedModel}
                </span>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
              </button>

              <ContextGauge telemetry={contextTelemetry} />

            </div>

            <div className="chat-panel__input-footer-right">
              <span className="chat-panel__hint">
                <kbd className="degrees-keycap">{isAgentRunning ? 'Esc' : '↵'}</kbd>
              </span>
              {isAgentRunning ? (
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
    </div>
  );
}
