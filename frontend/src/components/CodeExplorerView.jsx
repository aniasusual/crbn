import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-tsx';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-bash';
import 'prismjs/components/prism-markdown';
import { API_BASE_URL } from '../config';
import './CodeExplorerView.css';

// SVG Icons
const FolderIcon = ({ open }) => (
  <svg viewBox="0 0 24 24" width="14" height="14" fill={open ? '#fbbf24' : '#eab308'} stroke="none">
    {open ? (
      <path d="M19 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a1 1 0 0 0 .85.45H19a2 2 0 0 1 2 2v.5a.5.5 0 0 1-.5.5H4a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4.5a.5.5 0 0 1 .5-.5h.5a1 1 0 0 1 1 1V18a2 2 0 0 1-2 2z" />
    ) : (
      <path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z" />
    )}
  </svg>
);

const FileTypeIcon = ({ path = '' }) => {
  const ext = path.split('.').pop()?.toLowerCase();
  if (ext === 'jsx' || ext === 'tsx') {
    return (
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="#60a5fa" strokeWidth="2">
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)" />
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(90 12 12)" />
        <ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(150 12 12)" />
        <circle cx="12" cy="12" r="2" fill="#60a5fa" />
      </svg>
    );
  }
  if (ext === 'js' || ext === 'mjs' || ext === 'cjs') {
    return (
      <span style={{ fontSize: '10px', fontWeight: 700, color: '#facc15', lineHeight: 1 }}>
        JS
      </span>
    );
  }
  if (ext === 'ts') {
    return (
      <span style={{ fontSize: '10px', fontWeight: 700, color: '#3b82f6', lineHeight: 1 }}>
        TS
      </span>
    );
  }
  if (ext === 'css') {
    return (
      <span style={{ fontSize: '10px', fontWeight: 700, color: '#a78bfa', lineHeight: 1 }}>
        #
      </span>
    );
  }
  if (ext === 'html') {
    return (
      <span style={{ fontSize: '10px', fontWeight: 700, color: '#f97316', lineHeight: 1 }}>
        &lt;&gt;
      </span>
    );
  }
  if (ext === 'json') {
    return (
      <span style={{ fontSize: '10px', fontWeight: 700, color: '#eab308', lineHeight: 1 }}>
        &#123;&#125;
      </span>
    );
  }
  if (['png', 'jpg', 'jpeg', 'webp', 'svg', 'gif', 'ico'].includes(ext)) {
    return (
      <svg viewBox="0 0 24 24" width="13" height="13" stroke="#ec4899" strokeWidth="2" fill="none">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" stroke="rgba(255,255,255,0.4)" strokeWidth="2" fill="none">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
};

const ChevronRightIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

const RefreshIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
    <path d="M3 3v5h5" />
    <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
    <path d="M16 21h5v-5" />
  </svg>
);

const PlusFileIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="12" y1="18" x2="12" y2="12" />
    <line x1="9" y1="15" x2="15" y2="15" />
  </svg>
);

const PlusFolderIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    <line x1="12" y1="11" x2="12" y2="17" />
    <line x1="9" y1="14" x2="15" y2="14" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const CopyIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" stroke="#22c55e" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

function getGrammarForPath(filePath = '') {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'jsx':
      return Prism.languages.jsx;
    case 'tsx':
      return Prism.languages.tsx;
    case 'ts':
      return Prism.languages.typescript;
    case 'js':
    case 'mjs':
    case 'cjs':
      return Prism.languages.javascript;
    case 'css':
      return Prism.languages.css;
    case 'json':
      return Prism.languages.json;
    case 'html':
    case 'svg':
    case 'xml':
      return Prism.languages.markup;
    case 'sh':
    case 'bash':
      return Prism.languages.bash;
    case 'md':
      return Prism.languages.markdown;
    default:
      return null;
  }
}

export default function CodeExplorerView({ projectName, lastChangeTimestamp }) {
  const [tree, setTree] = useState([]);
  const [openTabs, setOpenTabs] = useState([]);
  const [activeFilePath, setActiveFilePath] = useState(null);
  const [fileContents, setFileContents] = useState({});
  const [expandedDirs, setExpandedDirs] = useState(new Set(['src', 'components', 'server']));
  const [searchQuery, setSearchQuery] = useState('');
  const [wordWrap, setWordWrap] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  const [creatingNode, setCreatingNode] = useState(null); // { type: 'file' | 'directory', parentPath: '' }
  const [createName, setCreateName] = useState('');
  const [saveToast, setSaveToast] = useState(null);

  const textareaRef = useRef(null);
  const preRef = useRef(null);
  const gutterRef = useRef(null);

  // 1. Fetch File Tree
  const fetchTree = useCallback(async () => {
    if (!projectName) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/tree`);
      if (res.ok) {
        const data = await res.json();
        setTree(data.tree || []);
      }
    } catch (err) {
      console.error('[CodeExplorerView] Failed to fetch tree:', err);
    }
  }, [projectName]);

  // Initial fetch and auto-refresh on agent file_changed
  useEffect(() => {
    fetchTree();
  }, [fetchTree, lastChangeTimestamp]);

  // 2. Open File and Fetch Content
  const openFile = useCallback(async (filePath) => {
    if (!filePath || !projectName) return;

    // Add to open tabs if not present
    setOpenTabs((prev) => (prev.includes(filePath) ? prev : [...prev, filePath]));
    setActiveFilePath(filePath);

    // If file content not loaded yet, fetch it
    setFileContents((prev) => {
      if (prev[filePath]) return prev;
      return {
        ...prev,
        [filePath]: { loading: true, content: '', original: '', isBinary: false, size: 0, mimeType: '' },
      };
    });

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/file?path=${encodeURIComponent(filePath)}`
      );
      if (res.ok) {
        const data = await res.json();
        setFileContents((prev) => ({
          ...prev,
          [filePath]: {
            loading: false,
            content: data.content || '',
            original: data.content || '',
            isBinary: Boolean(data.isBinary),
            size: data.size || 0,
            mimeType: data.mimeType || 'text/plain',
          },
        }));
      } else {
        setFileContents((prev) => ({
          ...prev,
          [filePath]: { loading: false, error: 'Failed to read file', content: '', original: '' },
        }));
      }
    } catch (err) {
      setFileContents((prev) => ({
        ...prev,
        [filePath]: { loading: false, error: String(err), content: '', original: '' },
      }));
    }
  }, [projectName]);

  // Auto-reload active file if modified by agent in background (when pristine)
  useEffect(() => {
    if (!lastChangeTimestamp || !activeFilePath || !projectName) return;
    const current = fileContents[activeFilePath];
    // If not dirty, refresh content quietly
    if (current && current.content === current.original && !current.isBinary) {
      fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/file?path=${encodeURIComponent(activeFilePath)}`
      )
        .then((r) => r.json())
        .then((data) => {
          if (data?.content !== undefined) {
            setFileContents((prev) => ({
              ...prev,
              [activeFilePath]: {
                ...prev[activeFilePath],
                content: data.content,
                original: data.content,
                size: data.size,
              },
            }));
          }
        })
        .catch(() => {});
    }
  }, [lastChangeTimestamp, activeFilePath, projectName, fileContents]);

  // Default Open file on initial tree load (prefer src/App.jsx)
  useEffect(() => {
    if (openTabs.length > 0 || tree.length === 0) return;

    const findDefaultFile = (nodes) => {
      // 1. Look for src/App.jsx / src/App.tsx
      for (const n of nodes) {
        if (n.type === 'file' && (n.path === 'src/App.jsx' || n.path === 'src/App.tsx')) return n.path;
        if (n.children) {
          const found = findDefaultFile(n.children);
          if (found) return found;
        }
      }
      return null;
    };

    const findAnyFile = (nodes) => {
      for (const n of nodes) {
        if (n.type === 'file') return n.path;
        if (n.children) {
          const found = findAnyFile(n.children);
          if (found) return found;
        }
      }
      return null;
    };

    const target = findDefaultFile(tree) || findAnyFile(tree);
    if (target) {
      openFile(target);
    }
  }, [tree, openTabs.length, openFile]);

  // Close Tab
  const closeTab = (filePath, e) => {
    e?.stopPropagation();
    const nextTabs = openTabs.filter((t) => t !== filePath);
    setOpenTabs(nextTabs);
    if (activeFilePath === filePath) {
      setActiveFilePath(nextTabs[nextTabs.length - 1] || null);
    }
  };

  // Directory toggle
  const toggleDir = (dirPath) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  };

  // Active File Data
  const activeData = fileContents[activeFilePath] || null;
  const isDirty = activeData && activeData.content !== activeData.original;

  // 3. Save Active File
  const handleSave = useCallback(async () => {
    if (!activeFilePath || !projectName || !activeData || activeData.isBinary || isSaving) return;

    setIsSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: activeFilePath,
          content: activeData.content,
        }),
      });

      if (res.ok) {
        setFileContents((prev) => ({
          ...prev,
          [activeFilePath]: {
            ...prev[activeFilePath],
            original: activeData.content,
          },
        }));
        setSaveToast('Saved');
        setTimeout(() => setSaveToast(null), 1800);
      } else {
        setSaveToast('Error saving');
        setTimeout(() => setSaveToast(null), 2500);
      }
    } catch {
      setSaveToast('Error saving');
      setTimeout(() => setSaveToast(null), 2500);
    } finally {
      setIsSaving(false);
    }
  }, [activeFilePath, projectName, activeData, isSaving]);

  // Keyboard shortcut Cmd+S / Ctrl+S
  useEffect(() => {
    const handleKeyDown = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleSave();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleSave]);

  // Code change in editor
  const handleCodeChange = (e) => {
    const newContent = e.target.value;
    setFileContents((prev) => ({
      ...prev,
      [activeFilePath]: {
        ...prev[activeFilePath],
        content: newContent,
      },
    }));
    updateCursorPos(e.target);
  };

  // Cursor position tracking
  const updateCursorPos = (target) => {
    const pos = target.selectionStart || 0;
    const textBefore = target.value.slice(0, pos);
    const lines = textBefore.split('\n');
    setCursorPos({
      line: lines.length,
      col: lines[lines.length - 1].length + 1,
    });
  };

  // Tab key indentation support
  const handleEditorKeyDown = (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;

      const newValue = value.substring(0, start) + '  ' + value.substring(end);
      setFileContents((prev) => ({
        ...prev,
        [activeFilePath]: {
          ...prev[activeFilePath],
          content: newValue,
        },
      }));

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
        updateCursorPos(textarea);
      }, 0);
    }
  };

  // Scroll sync: Textarea -> Pre -> Gutter
  const handleEditorScroll = (e) => {
    const { scrollTop, scrollLeft } = e.target;
    if (preRef.current) {
      preRef.current.scrollTop = scrollTop;
      preRef.current.scrollLeft = scrollLeft;
    }
    if (gutterRef.current) {
      gutterRef.current.scrollTop = scrollTop;
    }
  };

  // Copy Code
  const handleCopyCode = () => {
    if (!activeData?.content) return;
    navigator.clipboard.writeText(activeData.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  // Create New File or Directory
  const handleCreateSubmit = async (e) => {
    e?.preventDefault();
    if (!createName.trim() || !creatingNode || !projectName) return;

    const fullPath = creatingNode.parentPath
      ? `${creatingNode.parentPath}/${createName.trim()}`
      : createName.trim();

    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/file`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: fullPath,
          type: creatingNode.type,
        }),
      });

      if (res.ok) {
        setCreatingNode(null);
        setCreateName('');
        await fetchTree();
        if (creatingNode.type === 'file') {
          openFile(fullPath);
        }
      }
    } catch (err) {
      console.error('[CodeExplorerView] Create failed:', err);
    }
  };

  // Delete File / Directory
  const handleDeleteNode = async (nodePath, e) => {
    e.stopPropagation();
    if (!confirm(`Are you sure you want to delete "${nodePath}"?`)) return;

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/file?path=${encodeURIComponent(nodePath)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        closeTab(nodePath);
        fetchTree();
      }
    } catch (err) {
      console.error('[CodeExplorerView] Delete failed:', err);
    }
  };

  // Line count for gutter
  const lineCount = useMemo(() => {
    if (!activeData || activeData.isBinary || typeof activeData.content !== 'string') return 0;
    return activeData.content.split('\n').length;
  }, [activeData]);

  // Syntax Highlighted HTML
  const highlightedCode = useMemo(() => {
    if (!activeData || activeData.isBinary || typeof activeData.content !== 'string') return '';
    const grammar = getGrammarForPath(activeFilePath);
    if (!grammar) {
      // Escape HTML for plain text
      return activeData.content
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    try {
      return Prism.highlight(activeData.content, grammar, activeFilePath);
    } catch {
      return activeData.content;
    }
  }, [activeData, activeFilePath]);

  // Recursive Tree Rendering
  const renderTreeNodes = (nodes, depth = 0) => {
    return nodes.map((node) => {
      const isDir = node.type === 'directory';
      const isOpen = expandedDirs.has(node.path);
      const isActive = activeFilePath === node.path;

      // Filter by search query
      if (searchQuery.trim()) {
        const matchesName = node.name.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesChild = isDir && JSON.stringify(node.children || '').toLowerCase().includes(searchQuery.toLowerCase());
        if (!matchesName && !matchesChild) return null;
      }

      return (
        <div key={node.path}>
          <div
            className={`code-ide__tree-node ${isActive ? 'code-ide__tree-node--active' : ''}`}
            style={{ paddingLeft: `${14 + depth * 14}px` }}
            onClick={() => (isDir ? toggleDir(node.path) : openFile(node.path))}
            title={node.path}
          >
            {isDir ? (
              <span className={`code-ide__chevron ${isOpen ? 'code-ide__chevron--open' : ''}`}>
                <ChevronRightIcon />
              </span>
            ) : null}

            <span className="code-ide__file-icon">
              {isDir ? <FolderIcon open={isOpen} /> : <FileTypeIcon path={node.path} />}
            </span>

            <span className="code-ide__node-name">{node.name}</span>

            {/* Hover Actions */}
            <div className="code-ide__node-actions">
              {isDir && (
                <button
                  className="code-ide__node-action-btn"
                  title="New File inside"
                  onClick={(e) => {
                    e.stopPropagation();
                    setCreatingNode({ type: 'file', parentPath: node.path });
                    setExpandedDirs((prev) => new Set([...prev, node.path]));
                  }}
                >
                  <PlusFileIcon />
                </button>
              )}
              <button
                className="code-ide__node-action-btn"
                title={`Delete ${node.name}`}
                onClick={(e) => handleDeleteNode(node.path, e)}
              >
                <TrashIcon />
              </button>
            </div>
          </div>

          {/* Inline creation input inside this folder */}
          {creatingNode && creatingNode.parentPath === node.path && (
            <form onSubmit={handleCreateSubmit} className="code-ide__inline-create" style={{ paddingLeft: `${24 + depth * 14}px` }}>
              <input
                autoFocus
                className="code-ide__inline-input"
                placeholder={`New ${creatingNode.type} name...`}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onBlur={() => setCreatingNode(null)}
                onKeyDown={(e) => e.key === 'Escape' && setCreatingNode(null)}
              />
            </form>
          )}

          {isDir && isOpen && node.children && renderTreeNodes(node.children, depth + 1)}
        </div>
      );
    });
  };

  return (
    <div className="code-ide">
      <div className="code-ide__body">
        {/* Left Sidebar: File Explorer */}
        <aside className="code-ide__sidebar">
          <div className="code-ide__sidebar-header">
            <div className="code-ide__project-badge" title={projectName}>
              <span className="code-ide__project-icon">&#9881;</span>
              <span>{projectName || 'Workspace'}</span>
            </div>
            <div className="code-ide__sidebar-tools">
              <button
                className="code-ide__tool-btn"
                title="New File in root"
                onClick={() => setCreatingNode({ type: 'file', parentPath: '' })}
              >
                <PlusFileIcon />
              </button>
              <button
                className="code-ide__tool-btn"
                title="New Folder in root"
                onClick={() => setCreatingNode({ type: 'directory', parentPath: '' })}
              >
                <PlusFolderIcon />
              </button>
              <button className="code-ide__tool-btn" title="Refresh Files" onClick={fetchTree}>
                <RefreshIcon />
              </button>
            </div>
          </div>

          {/* Search Box */}
          <div className="code-ide__search-wrap">
            <div className="code-ide__search-box">
              <svg className="code-ide__search-icon" viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                className="code-ide__search-input"
                placeholder="Filter files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button className="code-ide__search-clear" onClick={() => setSearchQuery('')}>
                  <CloseIcon />
                </button>
              )}
            </div>
          </div>

          {/* Inline creation at root */}
          {creatingNode && creatingNode.parentPath === '' && (
            <form onSubmit={handleCreateSubmit} className="code-ide__inline-create">
              <input
                autoFocus
                className="code-ide__inline-input"
                placeholder={`New ${creatingNode.type} in root...`}
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                onBlur={() => setCreatingNode(null)}
                onKeyDown={(e) => e.key === 'Escape' && setCreatingNode(null)}
              />
            </form>
          )}

          {/* File Tree List */}
          <div className="code-ide__tree-list">{renderTreeNodes(tree)}</div>
        </aside>

        {/* Right Main Pane: Tabs + Code Area */}
        <section className="code-ide__main">
          {/* Tabs Bar */}
          <div className="code-ide__tabs-bar">
            {openTabs.map((tabPath) => {
              const tabName = tabPath.split('/').pop();
              const tabData = fileContents[tabPath];
              const tabIsDirty = tabData && tabData.content !== tabData.original;
              const isActive = tabPath === activeFilePath;

              return (
                <div
                  key={tabPath}
                  className={`code-ide__tab ${isActive ? 'code-ide__tab--active' : ''}`}
                  onClick={() => openFile(tabPath)}
                  title={tabPath}
                >
                  <FileTypeIcon path={tabPath} />
                  <span>{tabName}</span>
                  {tabIsDirty ? <span className="code-ide__tab-dirty-dot" title="Unsaved changes" /> : null}
                  <button
                    className="code-ide__tab-close"
                    title="Close file"
                    onClick={(e) => closeTab(tabPath, e)}
                  >
                    <CloseIcon />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Breadcrumbs and Actions Strip */}
          {activeFilePath ? (
            <div className="code-ide__subbar">
              <div className="code-ide__breadcrumbs">
                {activeFilePath.split('/').map((crumb, idx, arr) => (
                  <span key={idx}>
                    <span className={idx === arr.length - 1 ? 'code-ide__crumb-current' : ''}>{crumb}</span>
                    {idx < arr.length - 1 ? <span className="code-ide__crumb-sep"> / </span> : null}
                  </span>
                ))}
              </div>

              <div className="code-ide__subbar-actions">
                {saveToast ? (
                  <span style={{ fontSize: '11px', color: '#34d399', fontWeight: 500 }}>{saveToast}</span>
                ) : null}

                {!activeData?.isBinary && (
                  <button
                    className={`code-ide__save-btn ${isDirty ? 'code-ide__save-btn--dirty' : ''}`}
                    onClick={handleSave}
                    disabled={isSaving}
                    title="Save changes (⌘S)"
                  >
                    {isSaving ? 'Saving...' : isDirty ? 'Save •' : 'Saved'}
                  </button>
                )}

                {!activeData?.isBinary && (
                  <button
                    className="code-ide__action-mini"
                    onClick={() => setWordWrap(!wordWrap)}
                    title={wordWrap ? 'Disable wrap' : 'Enable word wrap'}
                  >
                    <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="2" fill="none">
                      <line x1="3" y1="6" x2="21" y2="6" />
                      <line x1="3" y1="12" x2="15" y2="12" />
                      <path d="M15 12h4a3 3 0 0 1 3 3v0a3 3 0 0 1-3 3h-4" />
                      <polyline points="14 15 11 18 14 21" />
                    </svg>
                  </button>
                )}

                <button
                  className="code-ide__action-mini"
                  onClick={handleCopyCode}
                  title="Copy Code"
                >
                  {copied ? <CheckIcon /> : <CopyIcon />}
                </button>
              </div>
            </div>
          ) : null}

          {/* Code Surface */}
          {!activeFilePath ? (
            <div className="code-ide__empty-state">
              <div className="code-ide__empty-icon">
                <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" strokeWidth="1.5" fill="none">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <polyline points="14 2 14 8 20 8" />
                </svg>
              </div>
              <div className="code-ide__empty-title">Select a file to inspect code</div>
              <div className="code-ide__empty-hint">Use the explorer on the left or filter files</div>
            </div>
          ) : activeData?.isBinary ? (
            /* Image / Binary Preview */
            <div className="code-ide__binary-preview">
              <div className="code-ide__image-checkerboard">
                <img
                  className="code-ide__image-preview"
                  src={`data:${activeData.mimeType};base64,${activeData.content}`}
                  alt={activeFilePath}
                />
              </div>
              <div className="code-ide__binary-meta">
                {activeFilePath.split('/').pop()} &bull; {(activeData.size / 1024).toFixed(1)} KB &bull; {activeData.mimeType}
              </div>
            </div>
          ) : (
            /* Line-Numbered Text Editor */
            <div className="code-ide__editor-surface">
              {/* Gutter */}
              <div className="code-ide__gutter" ref={gutterRef}>
                {Array.from({ length: lineCount }).map((_, i) => (
                  <div key={i} className="code-ide__gutter-num">
                    {i + 1}
                  </div>
                ))}
              </div>

              {/* Scroll Container with overlay textarea and pre */}
              <div className="code-ide__code-scroll" onScroll={handleEditorScroll}>
                <textarea
                  ref={textareaRef}
                  className={`code-ide__textarea ${wordWrap ? 'code-ide__textarea--wrap' : ''}`}
                  value={activeData?.content || ''}
                  onChange={handleCodeChange}
                  onKeyDown={handleEditorKeyDown}
                  onSelect={(e) => updateCursorPos(e.target)}
                  onKeyUp={(e) => updateCursorPos(e.target)}
                  onClick={(e) => updateCursorPos(e.target)}
                  spellCheck="false"
                  autoCapitalize="off"
                  autoComplete="off"
                />
                <pre
                  ref={preRef}
                  className={`code-ide__pre ${wordWrap ? 'code-ide__pre--wrap' : ''}`}
                  dangerouslySetInnerHTML={{ __html: highlightedCode + '\n' }}
                />
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Bottom Status Bar */}
      <footer className="code-ide__status-bar">
        <div className="code-ide__status-group">
          <span>{activeFilePath || 'No file selected'}</span>
          {isDirty && <span style={{ color: '#60a5fa' }}>• Modified</span>}
        </div>
        <div className="code-ide__status-group">
          {activeFilePath && !activeData?.isBinary && (
            <span>
              Ln {cursorPos.line}, Col {cursorPos.col}
            </span>
          )}
          <span>UTF-8</span>
          <span>{activeFilePath?.split('.').pop()?.toUpperCase() || 'PLAINTEXT'}</span>
        </div>
      </footer>
    </div>
  );
}
