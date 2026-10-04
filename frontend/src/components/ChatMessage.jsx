import { useState, useEffect } from 'react';
import LlmDebugModal from './LlmDebugModal';
import { isSubagentTool, getSubagentDisplayName } from './subagentUtils';
import OmpToolCard from './OmpToolCard';
import MarkdownRenderer from './MarkdownRenderer';
import './ChatMessage.css';
const CopyIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
  </svg>
);

const CodeIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="16 18 22 12 16 6"></polyline>
    <polyline points="8 6 2 12 8 18"></polyline>
  </svg>
);

const LoaderIcon = () => (
  <svg className="chat-msg__loader" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10" opacity="0.25"></circle>
    <path d="M12 2a10 10 0 0 1 10 10"></path>
  </svg>
);

const ChevronIcon = ({ expanded }) => (
  <svg
    className={`chat-msg__chevron ${expanded ? 'chat-msg__chevron--expanded' : ''}`}
    width="13"
    height="13"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="9 18 15 12 9 6"></polyline>
  </svg>
);

const ToolIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
  </svg>
);

const FileIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
    <polyline points="13 2 13 9 20 9"></polyline>
  </svg>
);

const RewindIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="1 4 1 10 7 10"></polyline>
    <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>
  </svg>
);

const CheckIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

const SearchIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"></circle>
    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
  </svg>
);

const AgentIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
    <rect x="9" y="9" width="6" height="6"></rect>
    <line x1="9" y1="1" x2="9" y2="4"></line>
    <line x1="15" y1="1" x2="15" y2="4"></line>
    <line x1="9" y1="20" x2="9" y2="23"></line>
    <line x1="15" y1="20" x2="15" y2="23"></line>
  </svg>
);
const CameraIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path>
    <circle cx="12" cy="13" r="4"></circle>
  </svg>
);

const CompactionDividerCard = ({ message, onOpenDebug }) => {
  const [expanded, setExpanded] = useState(false);
  const shortSummary = message.short_summary || 'Compacted history';
  const tokensBefore = message.tokens_before ? `${Math.round(message.tokens_before / 1000)}k tokens` : '';

  return (
    <div className="chat-msg chat-msg--compaction-divider">
      <div
        className="compaction-divider__banner"
        onClick={() => setExpanded(!expanded)}
        title="Click to toggle executive handoff summary"
      >
        <span className="compaction-divider__line" />
        <div className="compaction-divider__pill">
          <CameraIcon />
          <span className="compaction-divider__title">{shortSummary}</span>
          {tokensBefore && <span className="compaction-divider__badge">{tokensBefore}</span>}
          <ChevronIcon expanded={expanded} />
        </div>
        <span className="compaction-divider__line" />
      </div>

      {expanded && message.summary && (
        <div className="compaction-divider__drawer">
          <div className="compaction-divider__drawer-header">
            <span>Executive Handoff Summary</span>
            {message.debug && onOpenDebug && (
              <button
                type="button"
                className="chat-msg__debug-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenDebug();
                }}
                style={{ padding: '2px 8px', fontSize: '11px' }}
                title="Inspect exact LLM Prompt & Response payload"
              >
                <CodeIcon />
                <span>Debug</span>
              </button>
            )}
          </div>
          <div className="compaction-divider__drawer-body">
            <pre className="compaction-divider__text">{message.summary}</pre>
          </div>
        </div>
      )}
    </div>
  );
};


const extractTargetFiles = (message, resultStr = '') => {
  const args = message?.arguments;

  // Support input or patch strings containing [PATH#TAG] sections
  if (args) {
    const inputStr = args.input || args.patch || args.new_text;
    if (typeof inputStr === 'string' && inputStr.includes('[')) {
      const matches = [...inputStr.matchAll(/\[([^#\]\n\r]+)(?:#[0-9a-fA-F]+)?\]/g)];
      const files = matches
        .map((m) => m[1]?.trim())
        .filter((f) => f && !f.startsWith('Range ') && !f.includes('AST Signature Map'));
      if (files.length > 0) return files;
    }

    if (Array.isArray(args)) {
      return args.map((f) => (typeof f === 'string' ? f : f?.file_path)).filter(Boolean);
    }
    if (args.files && Array.isArray(args.files)) {
      return args.files.map((f) => (typeof f === 'string' ? f : f?.file_path)).filter(Boolean);
    }
    if (args.paths && Array.isArray(args.paths)) {
      return args.paths.map((f) => (typeof f === 'string' ? f : f?.file_path)).filter(Boolean);
    }

    const rawPath = args.file_path || args.path || args.file;
    if (Array.isArray(rawPath)) {
      return rawPath.filter(Boolean);
    }
    if (typeof rawPath === 'string' && rawPath.trim()) {
      if (rawPath.includes(';')) {
        return rawPath.split(';').map((p) => p.trim()).filter(Boolean);
      }
      return [rawPath.trim()];
    }
  }

  if (resultStr && typeof resultStr === 'string') {
    const matches = [...resultStr.matchAll(/\[([^#\]\n\r]+)(?:#[0-9a-fA-F]+)?\]/g)];
    const files = matches
      .map((m) => m[1]?.trim())
      .filter((f) => f && !f.startsWith('Range ') && !f.includes('AST Signature Map'));
    if (files.length > 0) return files;
  }

  return [];
};

const AskHumanQuestionItem = ({ questionData, onSelectOption }) => {
  const [submittedChoice, setSubmittedChoice] = useState(questionData.selectedAnswer || null);
  const [selectedMulti, setSelectedMulti] = useState([]);
  const [customText, setCustomText] = useState('');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const isMulti = Boolean(questionData.multi);

  const rawOptions = Array.isArray(questionData.options) ? questionData.options : [];
  // Ensure options is always a clean array of { label, description } objects
  const options = rawOptions
    .map((opt) => {
      if (typeof opt === 'string') {
        const trimmed = opt.trim();
        return trimmed ? { label: trimmed, description: '' } : null;
      }
      if (typeof opt === 'object' && opt !== null) {
        const label = String(opt.label || opt.name || opt.choice || opt.value || opt.text || '').trim();
        const description = String(opt.description || opt.desc || '').trim();
        return label ? { label, description } : null;
      }
      return null;
    })
    .filter(Boolean);

  // Recommended index: if explicitly given as number, use it; otherwise default to index 0 if options exist
  const recIndex =
    typeof questionData.recommended === 'number' && questionData.recommended >= 0
      ? questionData.recommended
      : options.length > 0
      ? 0
      : null;

  const handleSingleClick = (label) => {
    if (submittedChoice) return;
    setSubmittedChoice(label);
    if (onSelectOption) {
      onSelectOption(label);
    }
  };

  const handleMultiToggle = (label) => {
    if (submittedChoice) return;
    setSelectedMulti((prev) =>
      prev.includes(label) ? prev.filter((item) => item !== label) : [...prev, label]
    );
  };

  const handleMultiSubmit = () => {
    if (submittedChoice || selectedMulti.length === 0) return;
    const answer = selectedMulti.join(', ');
    setSubmittedChoice(answer);
    if (onSelectOption) {
      onSelectOption(answer);
    }
  };

  const handleCustomSubmit = (e) => {
    e?.preventDefault?.();
    if (submittedChoice || !customText.trim()) return;
    const answer = customText.trim();
    setSubmittedChoice(answer);
    if (onSelectOption) {
      onSelectOption(answer);
      setCustomText('');
      setShowCustomInput(false);
    }
  };

  return (
    <div className="ask-human__item">
      <div className="ask-human__header-row">
        {questionData.header && (
          <span className="ask-human__chip">{questionData.header}</span>
        )}
        <div className="ask-human__question-title">{questionData.question}</div>
      </div>

      {options.length > 0 && (
        <div className="ask-human__options-grid">
          {options.map((opt, optIdx) => {
            const isRec = recIndex === optIdx;
            const isChecked = selectedMulti.includes(opt.label);
            return (
              <button
                key={optIdx}
                type="button"
                className={`ask-human__option-card ${isRec ? 'ask-human__option-card--recommended' : ''} ${submittedChoice === opt.label ? 'ask-human__option-card--selected' : ''}`}
                disabled={Boolean(submittedChoice)}
                onClick={() => (isMulti ? handleMultiToggle(opt.label) : handleSingleClick(opt.label))}
              >
                <div className="ask-human__option-top">
                  <span className="ask-human__option-label">
                    {isMulti && (
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => {}}
                        style={{ marginRight: '8px', pointerEvents: 'none' }}
                      />
                    )}
                    {opt.label}
                  </span>
                  {isRec && <span className="ask-human__badge-recommended">Recommended</span>}
                </div>
                {opt.description ? (
                  <div className="ask-human__option-desc">{opt.description}</div>
                ) : null}
              </button>
            );
          })}
        </div>
      )}

      {isMulti && options.length > 0 && (
        <button
          type="button"
          className="ask-human__submit-btn"
          disabled={selectedMulti.length === 0}
          onClick={handleMultiSubmit}
        >
          Submit Selection ({selectedMulti.length})
        </button>
      )}

      {submittedChoice && (
        <div style={{ color: '#4ade80', fontSize: '12px', marginTop: '6px', fontWeight: 500 }}>
          ✓ Choice submitted: {submittedChoice}
        </div>
      )}

      {/* Direct custom text reply option */}
      {!submittedChoice && (
        !showCustomInput ? (
          <button
            type="button"
            className="ask-human__other-btn"
            onClick={() => setShowCustomInput(true)}
          >
            <span>Other (type your own answer)...</span>
          </button>
        ) : (
          <form className="ask-human__custom-form" onSubmit={handleCustomSubmit}>
            <input
              className="ask-human__custom-input"
              value={customText}
              onChange={(e) => setCustomText(e.target.value)}
              placeholder="Type your custom answer..."
              autoFocus
            />
            <button
              type="submit"
              className="ask-human__submit-btn"
              disabled={!customText.trim()}
            >
              Send
            </button>
            <button
              type="button"
              className="ask-human__cancel-btn"
              onClick={() => setShowCustomInput(false)}
            >
              Cancel
            </button>
          </form>
        )
      )}
    </div>
  );
};

const MessageFooter = ({ timestamp, contentToCopy, debug, onOpenDebug, stepId, onRewindToStep }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e) => {
    e.stopPropagation();
    if (contentToCopy) {
      const text = typeof contentToCopy === 'string' ? contentToCopy : JSON.stringify(contentToCopy, null, 2);
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDebugClick = (e) => {
    e.stopPropagation();
    if (onOpenDebug) {
      onOpenDebug();
    }
  };

  const handleRewindClick = (e) => {
    e.stopPropagation();
    if (onRewindToStep && stepId) {
      if (window.confirm(`Rewind workspace to ${stepId}? All file modifications made after this point will be reverted.`)) {
        onRewindToStep(stepId);
      }
    }
  };

  const timeValue = timestamp ? new Date(timestamp) : new Date();
  const timeString = timeValue.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

  return (
    <div className="chat-msg__footer">
      <span className="chat-msg__time">{timeString}</span>
      {stepId && onRewindToStep && (
        <button
          className="chat-msg__rewind-btn"
          onClick={handleRewindClick}
          title={`Rewind workspace to ${stepId}`}
        >
          <RewindIcon />
          <span>Rewind</span>
        </button>
      )}
      {debug && (
        <button
          className="chat-msg__debug-btn"
          onClick={handleDebugClick}
          title="Inspect exact LLM Prompt & Response payload"
        >
          <CodeIcon />
          <span>Debug</span>
        </button>
      )}
      {contentToCopy && (
        <button className="chat-msg__copy" onClick={handleCopy} title="Copy text">
          {copied ? <CheckIcon /> : <CopyIcon />}
        </button>
      )}
    </div>
  );
};

/**
 * ChatMessage — Renders a single chat message bubble with Notion minimalism and LLM payload debugging.
 */
export default function ChatMessage({ message, isActive, onOpenSubagent, onSelectOption, onToolResponse, onRewindToStep }) {
  const [isDebugOpen, setIsDebugOpen] = useState(false);
  const [isExpanded, setIsExpanded] = useState(!message.collapsed);
  useEffect(() => {
    if (message.collapsed) {
      setIsExpanded(false);
    }
  }, [message.collapsed]);

  const toggleExpand = () => setIsExpanded(prev => !prev);
  const openDebug = () => setIsDebugOpen(true);

  const renderBubble = () => {
    // User message
    if (message.role === 'user' || message.type === 'user') {
      const hasImages = Array.isArray(message.images) && message.images.length > 0;
      const hasFiles = Array.isArray(message.files) && message.files.length > 0;

      return (
        <div className="chat-msg chat-msg--user">
          <div className="chat-msg__box chat-msg__box--user">
            {hasImages && (
              <div className="chat-msg__user-images">
                {message.images.map((img, idx) => {
                  const src =
                    img.dataUrl ||
                    (img.data ? `data:${img.mimeType || 'image/png'};base64,${img.data}` : '');
                  return (
                    <img
                      key={idx}
                      src={src}
                      alt={img.name || `Image attachment ${idx + 1}`}
                      className="chat-msg__user-img"
                      onClick={() => {
                        if (src) window.open(src, '_blank');
                      }}
                      title="Click to view full image"
                    />
                  );
                })}
              </div>
            )}

            {hasFiles && (
              <div className="chat-msg__user-files">
                {message.files.map((file, idx) => (
                  <div key={idx} className="chat-msg__user-file-chip" title={file.name}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                    </svg>
                    <span>{file.name}</span>
                  </div>
                ))}
              </div>
            )}

            {message.content && <div className="chat-msg__content">{message.content}</div>}
          </div>
          <MessageFooter
            timestamp={message.timestamp}
            debug={message.debug}
            onOpenDebug={openDebug}
            stepId={message.step_id}
            onRewindToStep={onRewindToStep}
          />
        </div>
      );
    }
    // Compaction Divider (Phase 8 Standard)
    if (message.type === 'compaction_divider' || message.type === 'compaction') {
      return <CompactionDividerCard message={message} onOpenDebug={openDebug} />;
    }

    // Status message
    if (message.type === 'status') {
      return <div className="chat-msg chat-msg--status">{message.content}</div>;
    }

    // Tool call (exclude ask_human, which renders as interactive question card below)
    if (message.type === 'tool_call' && message.name !== 'ask_human' && message.name !== 'todo') {
      const isSubagent = isSubagentTool(message.name);
      if (!isSubagent) {
        const argsStr = message.arguments
          ? (typeof message.arguments === 'string' ? message.arguments : JSON.stringify(message.arguments, null, 2))
          : '';
        return (
          <div className="chat-msg chat-msg--tool_call">
            <div className="chat-msg__assistant-row">
              <div className="chat-msg__assistant-icon">
                <AgentIcon />
              </div>
              <div className="chat-msg__content" style={{ flex: 1, minWidth: 0 }}>
                <OmpToolCard
                  name={message.name}
                  args={message.arguments}
                  result={message.result}
                  running={Boolean(isActive && !message.collapsed && !message.result)}
                  intent={message.intent || message.arguments?.i}
                  defaultOpen={message.is_error || !message.collapsed}
                />
              </div>
            </div>
            <MessageFooter
              timestamp={message.timestamp}
              contentToCopy={message.result ? (typeof message.result === 'string' ? message.result : JSON.stringify(message.result, null, 2)) : argsStr}
              debug={message.debug}
              onOpenDebug={openDebug}
              stepId={message.step_id}
              onRewindToStep={onRewindToStep}
            />
          </div>
        );
      }
      const isRunning = isActive && !message.collapsed;
      const isSubagentRunning = isSubagent && isActive && isRunning && (
        message.subagentStatus === 'running' ||
        (message.subagentStatus !== 'completed' && message.subagentStatus !== 'failed' && message.subagentStatus !== 'interrupted')
      );
      const isSubagentFinished = isSubagent && !isSubagentRunning;
      const argsStr = message.arguments
        ? (typeof message.arguments === 'string' ? message.arguments : JSON.stringify(message.arguments, null, 2))
        : '';
      // Extract file targets for friendly display
      const fileList = extractTargetFiles(message);

      const handleClick = (e) => {
        if (isSubagent && onOpenSubagent) {
          e?.stopPropagation?.();
          onOpenSubagent(message);
        } else {
          toggleExpand();
        }
      };
      const subagentLabel = isSubagent ? getSubagentDisplayName(message.name, message.arguments) : message.name;
      return (
        <div className={`chat-msg chat-msg--tool_call ${isSubagent ? 'chat-msg--subagent-card' : ''}`}>
          <div className="chat-msg__assistant-row">
            <div className="chat-msg__assistant-icon">
              <AgentIcon />
            </div>
            <div className="chat-msg__content" style={{ flex: 1, minWidth: 0 }}>
              <div
                className="chat-msg__box"
                onClick={isSubagent ? handleClick : undefined}
                style={isSubagent ? { cursor: 'pointer' } : undefined}
              >
                <div
                  className="chat-msg__header"
                  onClick={!isSubagent ? handleClick : undefined}
                  style={{ cursor: 'pointer' }}
                  title={isSubagent ? 'Click to open subagent panel' : undefined}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <ToolIcon />
                    <span style={{ fontWeight: isSubagent ? 500 : 400 }}>{subagentLabel}</span>
                    {fileList.length > 0 && (
                      <div className="chat-msg__file-badges">
                        {fileList.map((fp, i) => (
                          <span key={i} className="chat-msg__file-badge">
                            <FileIcon /> {fp}
                          </span>
                        ))}
                      </div>
                    )}
                    {message.name === 'search_web' && message.arguments?.query && (
                      <div className="chat-msg__file-badges">
                        <span className="chat-msg__file-badge">
                          <SearchIcon /> {message.arguments.query}
                        </span>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                      {isRunning ? <LoaderIcon /> : <ChevronIcon expanded={isExpanded} />}
                    </span>
                  </div>
                </div>
                {isSubagent && (
                  <div
                    className="chat-msg__subagent-preview"
                    style={{
                      padding: '6px 12px 8px',
                      borderTop: '1px solid rgba(255, 255, 255, 0.05)',
                      fontSize: '12px',
                    }}
                  >
                    {isSubagentFinished ? (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          color: 'var(--text-tertiary, rgba(255, 255, 255, 0.45))',
                          fontSize: '12px',
                        }}
                      >
                        <span>{message.subagentStatus === 'failed' ? 'Subagent failed' : 'Subagent finished'}</span>
                      </div>
                    ) : (
                      <div
                        style={{
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '4px',
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            color: 'var(--text-secondary, rgba(255, 255, 255, 0.75))',
                            fontSize: '12px',
                          }}
                        >
                          <span>Active subagent running...</span>
                        </div>
                        {message.subagentEvents && message.subagentEvents.length > 0 && (
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              gap: '2px',
                              marginTop: '2px',
                            }}
                          >
                            {message.subagentEvents.slice(-4).map((evt, idx) => {
                              let lineText = '';
                              if (evt.event === 'thought' && evt.content) {
                                lineText = `💭 ${evt.content.replace(/\s+/g, ' ').trim()}`;
                              } else if (evt.event === 'tool_call') {
                                const argsPreview = evt.arguments ? JSON.stringify(evt.arguments) : '';
                                lineText = `🔧 ${evt.tool}${argsPreview ? `(${argsPreview})` : ''}`;
                              } else if (evt.event === 'tool_executed') {
                                const shortRes = typeof evt.result === 'string' ? evt.result.replace(/\s+/g, ' ').trim() : JSON.stringify(evt.result || '');
                                lineText = `✓ ${evt.tool || 'action'}: ${shortRes}`;
                              } else if (evt.event === 'finish') {
                                lineText = `🏁 Concluded (${evt.status || 'completed'})`;
                              }
                              if (!lineText) return null;
                              return (
                                <div
                                  key={idx}
                                  style={{
                                    fontSize: '11px',
                                    color: 'rgba(255, 255, 255, 0.45)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    lineHeight: '1.4',
                                  }}
                                  title={lineText}
                                >
                                  {lineText}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {message.diff && (
                  <div
                    className="chat-msg__diff-preview"
                    style={{
                      margin: '6px 12px 10px',
                      padding: '8px 10px',
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      borderRadius: '6px',
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      lineHeight: '1.5',
                      overflowX: 'auto',
                      maxHeight: '280px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    <div style={{ color: 'rgba(255, 255, 255, 0.45)', marginBottom: '4px', fontSize: '10px' }}>
                      Diff: {message.diffFile || message.arguments?.file_path || 'Modified file'}
                    </div>
                    {message.diff.split('\n').map((line, idx) => {
                      let color = 'rgba(255, 255, 255, 0.7)';
                      let bg = 'transparent';
                      if (line.startsWith('+') && !line.startsWith('+++')) {
                        color = '#4ade80';
                        bg = 'rgba(74, 222, 128, 0.12)';
                      } else if (line.startsWith('-') && !line.startsWith('---')) {
                        color = '#f87171';
                        bg = 'rgba(248, 113, 113, 0.12)';
                      } else if (line.startsWith('@@')) {
                        color = '#818cf8';
                      }
                      return (
                        <div key={idx} style={{ color, backgroundColor: bg, padding: '0 4px', whiteSpace: 'pre' }}>
                          {line}
                        </div>
                      );
                    })}
                  </div>
                )}
                {!isSubagent && isExpanded && argsStr && <pre className="chat-msg__details">{argsStr}</pre>}
              </div>
            </div>
          </div>
          <MessageFooter
            timestamp={message.timestamp}
            contentToCopy={argsStr}
            debug={message.debug}
            onOpenDebug={openDebug}
            stepId={message.step_id}
            onRewindToStep={onRewindToStep}
          />
        </div>
      );
    }

    // Tool result (exclude ask_human result to avoid duplicate completed pill)
    if (message.type === 'tool_result' && message.name !== 'ask_human' && message.name !== 'todo') {
      const isSubagent = isSubagentTool(message.name);
      if (!isSubagent) {
        const resultStr = typeof message.result === 'string' ? message.result : JSON.stringify(message.result, null, 2);
        return (
          <div className="chat-msg chat-msg--tool_result">
            <div className="chat-msg__assistant-row">
              <div className="chat-msg__assistant-icon">
                <AgentIcon />
              </div>
              <div className="chat-msg__content" style={{ flex: 1, minWidth: 0 }}>
                <OmpToolCard
                  name={message.name}
                  args={message.arguments}
                  result={message.result}
                  running={false}
                  intent={message.intent || message.arguments?.i}
                  defaultOpen={message.is_error || !message.collapsed}
                />
              </div>
            </div>
            <MessageFooter
              timestamp={message.timestamp}
              contentToCopy={resultStr}
              debug={message.debug}
              onOpenDebug={openDebug}
              stepId={message.step_id}
              onRewindToStep={onRewindToStep}
            />
          </div>
        );
      }
      const resultStr = typeof message.result === 'string' ? message.result : JSON.stringify(message.result, null, 2);
      const subagentLabel = isSubagent ? getSubagentDisplayName(message.name, message.arguments) : message.name;

      const handleClick = (e) => {
        if (isSubagent && onOpenSubagent) {
          e?.stopPropagation?.();
          onOpenSubagent(message);
        } else {
          toggleExpand();
        }
      };
      return (
        <div className={`chat-msg chat-msg--tool_result ${isSubagent ? 'chat-msg--subagent-result' : ''}`}>
          <div className="chat-msg__assistant-row">
            <div className="chat-msg__assistant-icon">
              <AgentIcon />
            </div>
            <div className="chat-msg__content" style={{ flex: 1, minWidth: 0 }}>
              <div
                className="chat-msg__box"
                onClick={isSubagent ? handleClick : undefined}
                style={isSubagent ? { cursor: 'pointer' } : undefined}
              >
                <div
                  className="chat-msg__header"
                  onClick={!isSubagent ? handleClick : undefined}
                  style={{ cursor: 'pointer' }}
                  title={isSubagent ? 'Click to open subagent panel' : undefined}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <CheckIcon />
                    <span style={{ fontWeight: isSubagent ? 500 : 400 }}>
                      {isSubagent ? `${subagentLabel} Completed` : message.name}
                    </span>
                    {extractTargetFiles(message, resultStr).length > 0 && (
                      <div className="chat-msg__file-badges">
                        {extractTargetFiles(message, resultStr).map((fp, i) => (
                          <span key={i} className="chat-msg__file-badge">
                            <FileIcon /> {fp}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ display: 'flex', alignItems: 'center' }}>
                      <ChevronIcon expanded={isExpanded} />
                    </span>
                  </div>
                </div>
                {message.diff && (
                  <div
                    className="chat-msg__diff-preview"
                    style={{
                      margin: '6px 12px 10px',
                      padding: '8px 10px',
                      backgroundColor: 'rgba(0, 0, 0, 0.4)',
                      borderRadius: '6px',
                      fontFamily: 'monospace',
                      fontSize: '11px',
                      lineHeight: '1.5',
                      overflowX: 'auto',
                      maxHeight: '280px',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                    }}
                  >
                    <div style={{ color: 'rgba(255, 255, 255, 0.45)', marginBottom: '4px', fontSize: '10px' }}>
                      Diff: {message.diffFile || message.arguments?.file_path || 'Modified file'}
                    </div>
                    {message.diff.split('\n').map((line, idx) => {
                      let color = 'rgba(255, 255, 255, 0.7)';
                      let bg = 'transparent';
                      if (line.startsWith('+') && !line.startsWith('+++')) {
                        color = '#4ade80';
                        bg = 'rgba(74, 222, 128, 0.12)';
                      } else if (line.startsWith('-') && !line.startsWith('---')) {
                        color = '#f87171';
                        bg = 'rgba(248, 113, 113, 0.12)';
                      } else if (line.startsWith('@@')) {
                        color = '#818cf8';
                      }
                      return (
                        <div key={idx} style={{ color, backgroundColor: bg, padding: '0 4px', whiteSpace: 'pre' }}>
                          {line}
                        </div>
                      );
                    })}
                  </div>
                )}
                {isExpanded && resultStr && <pre className="chat-msg__details">{resultStr}</pre>}
              </div>
            </div>
          </div>
          <MessageFooter
            timestamp={message.timestamp}
            contentToCopy={resultStr}
            debug={message.debug}
            onOpenDebug={openDebug}
            stepId={message.step_id}
            onRewindToStep={onRewindToStep}
          />
        </div>
      );
    }

    // Assistant response / token
    if (message.type === 'token' || message.role === 'assistant' || message.type === 'assistant') {
      return (
        <div className="chat-msg chat-msg--assistant">
          <div className="chat-msg__assistant-row">
            <div className="chat-msg__assistant-icon">
              <AgentIcon />
            </div>
            <div className="chat-msg__content">
              <MarkdownRenderer content={message.content} />
            </div>
          </div>
          <MessageFooter
            timestamp={message.timestamp}
            contentToCopy={message.content}
            debug={message.debug}
            onOpenDebug={openDebug}
            stepId={message.step_id}
            onRewindToStep={onRewindToStep}
          />
        </div>
      );
    }

    // Thinking content
    if (message.type === 'thinking') {
      const isThinking = isActive && !message.collapsed;
      return (
        <div className="chat-msg chat-msg--thinking">
          <div className="chat-msg__assistant-row">
            <div className="chat-msg__assistant-icon">
              <AgentIcon />
            </div>
            <div className="chat-msg__content" style={{ flex: 1, minWidth: 0 }}>
              <div className="chat-msg__box chat-msg__box--thinking">
                <div className="chat-msg__header" onClick={toggleExpand} style={{ cursor: 'pointer' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {isThinking ? 'Thinking...' : 'Thought'}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center' }}>
                    {isThinking ? <LoaderIcon /> : <ChevronIcon expanded={isExpanded} />}
                  </span>
                </div>
                {(isExpanded || isThinking) && (
                  <div className="chat-msg__thinking-content">
                    {message.content}
                  </div>
                )}
              </div>
            </div>
          </div>
          <MessageFooter
            timestamp={message.timestamp}
            contentToCopy={message.content}
            debug={message.debug}
            onOpenDebug={openDebug}
            stepId={message.step_id}
            onRewindToStep={onRewindToStep}
          />
        </div>
      );
    }
    // Ask human interactive question card (matches direct event OR tool_call)
    if (
      message.type === 'ask_human' ||
      (message.type === 'tool_call' && message.name === 'ask_human')
    ) {
      const rawArgs = message.arguments || message.data || {};
      let questionsList = [];

      if (Array.isArray(message.questions) && message.questions.length > 0) {
        questionsList = message.questions;
      } else if (Array.isArray(rawArgs.questions) && rawArgs.questions.length > 0) {
        questionsList = rawArgs.questions;
      } else {
        const questionText =
          message.question ||
          rawArgs.question ||
          message.prompt ||
          rawArgs.prompt ||
          message.query ||
          rawArgs.query ||
          message.content ||
          '';

        const rawOpts =
          message.options ||
          rawArgs.options ||
          message.choices ||
          rawArgs.choices ||
          message.flat_options ||
          rawArgs.flat_options ||
          [];

        const optionsArray = Array.isArray(rawOpts)
          ? rawOpts
          : typeof rawOpts === 'string'
          ? [rawOpts]
          : [];

        const recVal = message.recommended ?? rawArgs.recommended;
        const isMulti = Boolean(message.multi ?? rawArgs.multi);
        const headerVal = message.header || rawArgs.header;

        if (questionText || optionsArray.length > 0) {
          questionsList = [
            {
              id: 'q1',
              question: questionText || 'Please select an option to proceed:',
              header: headerVal,
              options: optionsArray,
              recommended: recVal,
              multi: isMulti,
            },
          ];
        }
      }

      if (questionsList.length === 0) {
        // Absolute fallback so the box is NEVER empty
        questionsList = [
          {
            id: 'q1',
            question: message.content || 'Please provide your input to proceed:',
            options: ['Yes', 'No'],
            recommended: 0,
            multi: false,
          },
        ];
      }

      const copyText =
        message.question ||
        rawArgs.question ||
        questionsList.map((q) => q.question).join('\n') ||
        'Ask Human Question';

      return (
        <div className="chat-msg chat-msg--ask_human">
          <div className="chat-msg__assistant-row">
            <div className="chat-msg__assistant-icon">
              <AgentIcon />
            </div>
            <div className="chat-msg__content" style={{ flex: 1, minWidth: 0 }}>
              <div className="chat-msg__box chat-msg__box--ask_human">
                {questionsList.map((q, qIdx) => (
                  <AskHumanQuestionItem
                    key={q.id || qIdx}
                    questionData={q}
                    onSelectOption={(answer) => {
                      if (onToolResponse) {
                        onToolResponse(message.id || q.id, answer);
                      } else if (onSelectOption) {
                        onSelectOption(answer);
                      }
                    }}
                  />
                ))}
              </div>
            </div>
          </div>
          <MessageFooter
            timestamp={message.timestamp}
            contentToCopy={copyText}
            debug={message.debug}
            onOpenDebug={openDebug}
            stepId={message.step_id}
            onRewindToStep={onRewindToStep}
          />
        </div>
      );
    }

    // Todo tool call / result compact history pill (interactive checklist lives in the docked sheet above chat input)
    if (
      message.type === 'todo' ||
      message.type === 'todo_update' ||
      (message.type === 'tool_call' && message.name === 'todo') ||
      (message.type === 'tool_result' && message.name === 'todo')
    ) {
      const rawArgs = message.arguments || message.data || {};
      const op = rawArgs.op || message.op || 'update';
      const taskName = rawArgs.task || (rawArgs.items ? `${rawArgs.items.length} tasks` : '');
      const copyText = typeof message.result === 'string' ? message.result : JSON.stringify(rawArgs, null, 2);

      return (
        <div className="chat-msg chat-msg--tool_result chat-msg--todo-pill">
          <div className="chat-msg__assistant-row">
            <div className="chat-msg__assistant-icon">
              <CheckIcon />
            </div>
            <div className="chat-msg__content" style={{ flex: 1, minWidth: 0 }}>
              <div className="chat-msg__box" onClick={toggleExpand} style={{ cursor: 'pointer' }}>
                <div className="chat-msg__header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                    <span style={{ fontWeight: 500 }}>Tasks ({op})</span>
                    {taskName && (
                      <span className="chat-msg__file-badge">{taskName}</span>
                    )}
                  </div>
                  <ChevronIcon expanded={isExpanded} />
                </div>
                {isExpanded && (
                  <pre className="chat-msg__details">{copyText}</pre>
                )}
              </div>
            </div>
          </div>
          <MessageFooter
            timestamp={message.timestamp}
            contentToCopy={copyText}
            debug={message.debug}
            onOpenDebug={openDebug}
            stepId={message.step_id}
            onRewindToStep={onRewindToStep}
          />
        </div>
      );
    }

    // Fallback for untyped content if it exists
    if (message.content) {
      return (
        <div className="chat-msg chat-msg--user">
          <div className="chat-msg__box chat-msg__box--user">
            <div className="chat-msg__content">{message.content}</div>
          </div>
          <MessageFooter
            timestamp={message.timestamp}
            contentToCopy={message.content}
            debug={message.debug}
            onOpenDebug={openDebug}
            stepId={message.step_id}
            onRewindToStep={onRewindToStep}
          />
        </div>
      );
    }

    return null;
  };

  return (
    <>
      {renderBubble()}
      {message.debug && (
        <LlmDebugModal
          isOpen={isDebugOpen}
          onClose={() => setIsDebugOpen(false)}
          debugData={message.debug}
        />
      )}
    </>
  );
}
