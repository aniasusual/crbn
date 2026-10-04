import { useState, useEffect } from 'react';
import './LlmDebugModal.css';

function JsonNode({ name, value, isLast = true, depth = 0, globalExpand }) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object' && !isArray;

  // Default: depth 0 expanded, deeper levels collapsed for clean overview
  const [isCollapsed, setIsCollapsed] = useState(() => depth >= 1);

  useEffect(() => {
    if (globalExpand) {
      setIsCollapsed(!globalExpand.expand);
    }
  }, [globalExpand]);

  const renderKey = () => {
    if (name === undefined) return null;
    return (
      <span className="json-key">
        {typeof name === 'number' ? name : `"${name}"`}:{' '}
      </span>
    );
  };

  if (value === null) {
    return (
      <div className="json-line">
        <span className="json-indent" style={{ width: depth * 16 }} />
        {renderKey()}
        <span className="json-null">null</span>
        {!isLast && <span className="json-comma">,</span>}
      </div>
    );
  }

  if (typeof value === 'boolean') {
    return (
      <div className="json-line">
        <span className="json-indent" style={{ width: depth * 16 }} />
        {renderKey()}
        <span className="json-boolean">{String(value)}</span>
        {!isLast && <span className="json-comma">,</span>}
      </div>
    );
  }

  if (typeof value === 'number') {
    return (
      <div className="json-line">
        <span className="json-indent" style={{ width: depth * 16 }} />
        {renderKey()}
        <span className="json-number">{value}</span>
        {!isLast && <span className="json-comma">,</span>}
      </div>
    );
  }

  if (typeof value === 'string') {
    return (
      <div className="json-line">
        <span className="json-indent" style={{ width: depth * 16 }} />
        {renderKey()}
        <span className="json-string">{JSON.stringify(value)}</span>
        {!isLast && <span className="json-comma">,</span>}
      </div>
    );
  }

  if (isArray) {
    if (value.length === 0) {
      return (
        <div className="json-line">
          <span className="json-indent" style={{ width: depth * 16 }} />
          {renderKey()}
          <span className="json-bracket">[]</span>
          {!isLast && <span className="json-comma">,</span>}
        </div>
      );
    }

    return (
      <div className="json-node">
        <div
          className="json-line json-line--expandable"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <span className="json-indent" style={{ width: depth * 16 }} />
          <button
            type="button"
            className="json-toggle-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(!isCollapsed);
            }}
          >
            {isCollapsed ? '+' : '-'}
          </button>
          {renderKey()}
          <span className="json-bracket">[</span>
          {isCollapsed ? (
            <>
              <span className="json-collapsed-text"> {value.length} items </span>
              <span className="json-bracket">]</span>
              {!isLast && <span className="json-comma">,</span>}
            </>
          ) : null}
        </div>
        {!isCollapsed && (
          <div className="json-children">
            {value.map((item, idx) => (
              <JsonNode
                key={idx}
                name={idx}
                value={item}
                isLast={idx === value.length - 1}
                depth={depth + 1}
                globalExpand={globalExpand}
              />
            ))}
            <div className="json-line">
              <span className="json-indent" style={{ width: depth * 16 }} />
              <span className="json-bracket">]</span>
              {!isLast && <span className="json-comma">,</span>}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (isObject) {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return (
        <div className="json-line">
          <span className="json-indent" style={{ width: depth * 16 }} />
          {renderKey()}
          <span className="json-brace">{'{ }'}</span>
          {!isLast && <span className="json-comma">,</span>}
        </div>
      );
    }

    return (
      <div className="json-node">
        <div
          className="json-line json-line--expandable"
          onClick={() => setIsCollapsed(!isCollapsed)}
        >
          <span className="json-indent" style={{ width: depth * 16 }} />
          <button
            type="button"
            className="json-toggle-btn"
            onClick={(e) => {
              e.stopPropagation();
              setIsCollapsed(!isCollapsed);
            }}
          >
            {isCollapsed ? '+' : '-'}
          </button>
          {renderKey()}
          <span className="json-brace">{'{'}</span>
          {isCollapsed ? (
            <>
              <span className="json-collapsed-text"> {keys.length} keys </span>
              <span className="json-brace">{'}'}</span>
              {!isLast && <span className="json-comma">,</span>}
            </>
          ) : null}
        </div>
        {!isCollapsed && (
          <div className="json-children">
            {keys.map((k, idx) => (
              <JsonNode
                key={k}
                name={k}
                value={value[k]}
                isLast={idx === keys.length - 1}
                depth={depth + 1}
                globalExpand={globalExpand}
              />
            ))}
            <div className="json-line">
              <span className="json-indent" style={{ width: depth * 16 }} />
              <span className="json-brace">{'}'}</span>
              {!isLast && <span className="json-comma">,</span>}
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="json-line">
      <span className="json-indent" style={{ width: depth * 16 }} />
      {renderKey()}
      <span className="json-string">{String(value)}</span>
      {!isLast && <span className="json-comma">,</span>}
    </div>
  );
}

export default function LlmDebugModal({ isOpen, onClose, debugData }) {
  const [copied, setCopied] = useState(false);
  const [globalExpand, setGlobalExpand] = useState(null);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
    }
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !debugData) return null;

  let parsedData = debugData;
  let jsonString = '';

  if (typeof debugData === 'string') {
    try {
      parsedData = JSON.parse(debugData);
      jsonString = JSON.stringify(parsedData, null, 2);
    } catch {
      parsedData = debugData;
      jsonString = String(debugData);
    }
  } else {
    try {
      jsonString = JSON.stringify(debugData, null, 2);
    } catch {
      jsonString = String(debugData);
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(jsonString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExpandAll = () => {
    setGlobalExpand({ id: Date.now(), expand: true });
  };

  const handleCollapseAll = () => {
    setGlobalExpand({ id: Date.now(), expand: false });
  };

  return (
    <div className="llm-debug-overlay" onClick={onClose}>
      <div className="llm-debug-modal" onClick={(e) => e.stopPropagation()}>
        <div className="llm-debug-header">
          <div className="llm-debug-header__title">Debug Context JSON Tree</div>
          <div className="llm-debug-header__actions">
            <button
              type="button"
              className="llm-debug-btn"
              onClick={handleExpandAll}
            >
              Expand All
            </button>
            <button
              type="button"
              className="llm-debug-btn"
              onClick={handleCollapseAll}
            >
              Collapse All
            </button>
            <button
              type="button"
              className="llm-debug-btn"
              onClick={handleCopy}
            >
              {copied ? 'Copied' : 'Copy JSON'}
            </button>
            <button
              type="button"
              className="llm-debug-btn"
              onClick={onClose}
            >
              Close
            </button>
          </div>
        </div>
        <div className="llm-debug-body">
          {typeof parsedData === 'object' && parsedData !== null ? (
            <div className="json-tree">
              <JsonNode
                value={parsedData}
                isLast={true}
                depth={0}
                globalExpand={globalExpand}
              />
            </div>
          ) : (
            <pre className="json-raw-fallback">{jsonString}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
