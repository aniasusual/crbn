import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { API_BASE_URL } from '../config';
import './McpConnectModal.css';

const MCP_PRESETS = [
  {
    id: 'filesystem',
    name: 'Filesystem',
    description: 'Read and write local files and directories safely.',
    requiresKey: false,
    defaultName: 'filesystem',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
    env: {},
  },
  {
    id: 'fetch',
    name: 'Web Fetch',
    description: 'Fetch and parse HTML and JSON web content directly.',
    requiresKey: false,
    defaultName: 'fetch',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-fetch'],
    env: {},
  },
  {
    id: 'sqlite',
    name: 'SQLite Database',
    description: 'Execute queries and inspect local SQLite database tables.',
    requiresKey: false,
    defaultName: 'sqlite',
    transport: 'stdio',
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', './data.db'],
    env: {},
  },
  {
    id: 'memory',
    name: 'Knowledge Graph',
    description: 'Persistent knowledge graph memory across agent sessions.',
    requiresKey: false,
    defaultName: 'memory',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    env: {},
  },
  {
    id: 'github',
    name: 'GitHub',
    description: 'Search repositories, manage PRs, inspect commits and issues.',
    requiresKey: true,
    keyHint: 'Requires GITHUB_PERSONAL_ACCESS_TOKEN',
    defaultName: 'github',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-github'],
    env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
  },
  {
    id: 'brave-search',
    name: 'Brave Web Search',
    description: 'Real-time web search and content summarization API.',
    requiresKey: true,
    keyHint: 'Requires BRAVE_API_KEY',
    defaultName: 'brave-search',
    transport: 'stdio',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '' },
  },
];

export default function McpConnectModal({
  isOpen,
  onClose,
  projectName = '',
  onReloadMcp,
}) {
  const effectiveProject = projectName || '_global';
  const isGlobalScope = !projectName || projectName === '_global';

  const [activeTab, setActiveTab] = useState('servers'); // 'servers' | 'add'
  const [addMode, setAddMode] = useState('presets'); // 'presets' | 'form' | 'json'

  const [servers, setServers] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [expandedServer, setExpandedServer] = useState(null);

  // Form Fields
  const [serverName, setServerName] = useState('');
  const [transport, setTransport] = useState('stdio');
  const [command, setCommand] = useState('npx');
  const [argsStr, setArgsStr] = useState('');
  const [envStr, setEnvStr] = useState('');
  const [url, setUrl] = useState('');
  const [headersStr, setHeadersStr] = useState('');
  const [rawJson, setRawJson] = useState('');

  // Fetch servers from backend
  const fetchServers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/mcp`);
      if (res.ok) {
        const data = await res.json();
        setServers(Array.isArray(data.servers) ? data.servers : []);
      }
    } catch (err) {
      console.warn('Failed to fetch MCP servers:', err);
    } finally {
      setIsLoading(false);
    }
  }, [effectiveProject]);

  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);
      fetchServers();
    }
  }, [isOpen, fetchServers]);

  // Load a preset into the form
  const applyPreset = (preset) => {
    setServerName(preset.defaultName);
    setTransport(preset.transport);
    setCommand(preset.command);
    setArgsStr(preset.args.join(' '));
    const envEntries = Object.entries(preset.env || {})
      .map(([k, v]) => `${k}=${v}`)
      .join('\n');
    setEnvStr(envEntries);
    setUrl('');
    setHeadersStr('');
    setAddMode('form');
  };

  // Toggle server disabled/enabled
  const handleToggle = async (name, currentlyDisabled) => {
    setErrorMsg(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/mcp/servers/${encodeURIComponent(name)}/toggle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ disabled: !currentlyDisabled }),
        }
      );
      if (res.ok) {
        await fetchServers();
        onReloadMcp?.();
      } else {
        const data = await res.json();
        setErrorMsg(data.detail || 'Failed to toggle server');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Delete server
  const handleDelete = async (name) => {
    if (!confirm(`Are you sure you want to remove MCP server "${name}"?`)) return;
    setErrorMsg(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/mcp/servers/${encodeURIComponent(name)}`,
        { method: 'DELETE' }
      );
      if (res.ok) {
        setSuccessMsg(`Removed server "${name}"`);
        await fetchServers();
        onReloadMcp?.();
      } else {
        const data = await res.json();
        setErrorMsg(data.detail || 'Failed to delete server');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  };

  // Reload all servers
  const handleReload = async () => {
    setIsReloading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/mcp/reload`, {
        method: 'POST',
      });
      if (res.ok) {
        setSuccessMsg('Reloaded MCP servers and refreshed tool definitions.');
        await fetchServers();
        onReloadMcp?.();
      } else {
        const data = await res.json();
        setErrorMsg(data.detail || 'Failed to reload servers');
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsReloading(false);
    }
  };

  // Save / Add Server
  const handleSave = async (e) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSaving(true);

    try {
      if (addMode === 'json') {
        let parsed;
        try {
          parsed = JSON.parse(rawJson);
        } catch (jsonErr) {
          throw new Error(`Invalid JSON: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`);
        }

        // Support either { mcpServers: { ... } } or a single { command: ... } block
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
          const entries = Object.entries(parsed.mcpServers);
          if (entries.length === 0) {
            throw new Error('No servers found inside "mcpServers" object.');
          }
          for (const [name, cfg] of entries) {
            const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/mcp/servers`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ name, config: cfg }),
            });
            if (!res.ok) {
              const data = await res.json();
              throw new Error(`Failed to add server "${name}": ${data.detail || 'Unknown error'}`);
            }
          }
        } else {
          const nameToUse = (serverName || parsed.name || '').trim();
          if (!nameToUse) {
            throw new Error('Please enter a Server Name for this configuration.');
          }
          const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/mcp/servers`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: nameToUse, config: parsed }),
          });
          if (!res.ok) {
            const data = await res.json();
            throw new Error(data.detail || 'Failed to add server');
          }
        }
      } else {
        const cleanName = serverName.trim();
        if (!cleanName) {
          throw new Error('Server name is required.');
        }

        const config = {};
        if (transport === 'stdio') {
          if (!command.trim()) throw new Error('Command is required for stdio transport.');
          config.type = 'stdio';
          config.command = command.trim();
          if (argsStr.trim()) {
            config.args = argsStr.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((s) => s.replace(/(^"|"$)/g, '')) || [];
          }
          if (envStr.trim()) {
            const envObj = {};
            for (const line of envStr.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#')) continue;
              const eqIdx = trimmed.indexOf('=');
              if (eqIdx > 0) {
                const k = trimmed.slice(0, eqIdx).trim();
                const v = trimmed.slice(eqIdx + 1).trim();
                envObj[k] = v;
              }
            }
            if (Object.keys(envObj).length > 0) {
              config.env = envObj;
            }
          }
        } else {
          if (!url.trim()) throw new Error('URL is required for HTTP/SSE transport.');
          config.type = 'http';
          config.url = url.trim();
          if (headersStr.trim()) {
            const headersObj = {};
            for (const line of headersStr.split('\n')) {
              const trimmed = line.trim();
              if (!trimmed || trimmed.startsWith('#')) continue;
              const colonIdx = trimmed.indexOf(':');
              if (colonIdx > 0) {
                const k = trimmed.slice(0, colonIdx).trim();
                const v = trimmed.slice(colonIdx + 1).trim();
                headersObj[k] = v;
              }
            }
            if (Object.keys(headersObj).length > 0) {
              config.headers = headersObj;
            }
          }
        }

        const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/mcp/servers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: cleanName, config }),
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.detail || 'Failed to add server');
        }
      }

      setSuccessMsg('Successfully configured MCP server!');
      setServerName('');
      setArgsStr('');
      setEnvStr('');
      setUrl('');
      setHeadersStr('');
      setRawJson('');
      await fetchServers();
      onReloadMcp?.();
      setActiveTab('servers');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={Boolean(isOpen)} onClose={onClose} className="mcp-dialog-root">
      <DialogBackdrop transition className="mcp-dialog-backdrop" />

      <div className="mcp-dialog-wrap">
        <DialogPanel transition className="mcp-dialog-panel">
          {/* Header */}
          <div className="mcp-dialog-header">
            <div className="mcp-dialog-header-left">
              <div className="mcp-dialog-header-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 22v-5"/>
                  <path d="M9 8V2"/>
                  <path d="M15 8V2"/>
                  <path d="M18 8v5a6 6 0 0 1-12 0V8z"/>
                </svg>
              </div>
              <div>
                <DialogTitle className="mcp-dialog-title">Model Context Protocol</DialogTitle>
                <p className="mcp-dialog-subtitle">
                  Connect external tools, databases, and APIs {isGlobalScope ? 'globally across projects' : 'for this project'}.
                </p>
              </div>
            </div>

            <div className="mcp-dialog-header-right">
              <button
                type="button"
                className="mcp-dialog-reload-btn"
                onClick={handleReload}
                disabled={isReloading}
                title="Reload all MCP servers and discover tools"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isReloading ? 'mcp-spin' : ''}
                >
                  <path d="M21 2v6h-6"/>
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
                  <path d="M3 22v-6h6"/>
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
                </svg>
                <span>{isReloading ? 'Reloading...' : 'Reload'}</span>
              </button>
              <button
                type="button"
                className="mcp-dialog-close-btn"
                onClick={onClose}
                aria-label="Close modal"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="mcp-dialog-tabs">
            <button
              type="button"
              className={`mcp-dialog-tab ${activeTab === 'servers' ? 'mcp-dialog-tab--active' : ''}`}
              onClick={() => setActiveTab('servers')}
            >
              <span>Servers & Tools</span>
              {servers.length > 0 && (
                <span className="mcp-dialog-tab-badge">{servers.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`mcp-dialog-tab ${activeTab === 'add' ? 'mcp-dialog-tab--active' : ''}`}
              onClick={() => setActiveTab('add')}
            >
              <span>+ Add Server</span>
            </button>
          </div>

          {/* Banners */}
          {errorMsg && (
            <div className="mcp-dialog-banner mcp-dialog-banner--error">
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="mcp-dialog-banner mcp-dialog-banner--success">
              <span>{successMsg}</span>
            </div>
          )}

          {/* Tab 1: Configured Servers & Live Tools */}
          {activeTab === 'servers' && (
            <div className="mcp-dialog-content">
              {isLoading ? (
                <div className="mcp-dialog-empty">Loading servers...</div>
              ) : servers.length === 0 ? (
                <div className="mcp-dialog-empty">
                  <div className="mcp-dialog-empty-icon">🔌</div>
                  <h4>No MCP servers connected yet</h4>
                  <p>
                    Add a server to give the coding agent tools like Web Fetch, SQLite, GitHub, or custom CLI commands.
                  </p>
                  <button
                    type="button"
                    className="mcp-dialog-btn mcp-dialog-btn--primary"
                    onClick={() => {
                      setActiveTab('add');
                      setAddMode('presets');
                    }}
                  >
                    Browse Starter Presets
                  </button>
                </div>
              ) : (
                <div className="mcp-dialog-servers-list">
                  {servers.map((srv) => {
                    const isExpanded = expandedServer === srv.name;
                    const toolCount = srv.tools?.length || 0;
                    let statusClass = 'mcp-status--disconnected';
                    if (srv.disabled) {
                      statusClass = 'mcp-status--disabled';
                    } else if (srv.status === 'connected') {
                      statusClass = 'mcp-status--connected';
                    } else if (srv.status === 'connecting') {
                      statusClass = 'mcp-status--connecting';
                    } else if (srv.status === 'configured') {
                      statusClass = 'mcp-status--configured';
                    }

                    return (
                      <div key={srv.name} className="mcp-server-card">
                        <div className="mcp-server-card-header">
                          <div className="mcp-server-card-info">
                            <div className="mcp-server-card-title-row">
                              <span className="mcp-server-card-name">{srv.name}</span>
                              <span className={`mcp-server-status-pill ${statusClass}`}>
                                <span className="mcp-server-status-dot" />
                                {srv.disabled ? 'Disabled' : srv.status || 'configured'}
                              </span>
                              {srv.config?.type && (
                                <span className="mcp-server-type-tag">{srv.config.type}</span>
                              )}
                              {srv.source === 'global' && (
                                <span className="mcp-server-source-tag">User Config</span>
                              )}
                            </div>
                            <div className="mcp-server-card-meta">
                              {srv.config?.command && (
                                <code className="mcp-server-cmd">
                                  {srv.config.command} {srv.config.args?.join(' ') || ''}
                                </code>
                              )}
                              {srv.config?.url && (
                                <code className="mcp-server-cmd">{srv.config.url}</code>
                              )}
                            </div>
                          </div>

                          <div className="mcp-server-card-actions">
                            <button
                              type="button"
                              className="mcp-action-btn"
                              onClick={() => handleToggle(srv.name, srv.disabled)}
                              title={srv.disabled ? 'Enable server' : 'Disable server'}
                            >
                              {srv.disabled ? 'Enable' : 'Disable'}
                            </button>
                            <button
                              type="button"
                              className="mcp-action-btn mcp-action-btn--danger"
                              onClick={() => handleDelete(srv.name)}
                              title="Delete server from config"
                            >
                              Delete
                            </button>
                          </div>
                        </div>

                        {/* Tools Accordion */}
                        <div className="mcp-server-tools-section">
                          <button
                            type="button"
                            className="mcp-server-tools-toggle"
                            onClick={() => setExpandedServer(isExpanded ? null : srv.name)}
                          >
                            <span>
                              {toolCount} {toolCount === 1 ? 'tool' : 'tools'} provided
                            </span>
                            <span className="mcp-tools-toggle-icon">{isExpanded ? '▲' : '▼'}</span>
                          </button>

                          {isExpanded && (
                            <div className="mcp-server-tools-list">
                              {toolCount === 0 ? (
                                <div className="mcp-tools-empty">
                                  {srv.status === 'connected'
                                    ? 'No tools exported by this server.'
                                    : 'Server will discover tools once connected in a project session.'}
                                </div>
                              ) : (
                                srv.tools.map((t) => (
                                  <div key={t.name} className="mcp-tool-item">
                                    <div className="mcp-tool-header">
                                      <span className="mcp-tool-name">{t.name}</span>
                                      {t.label && t.label !== t.name && (
                                        <span className="mcp-tool-label">({t.label})</span>
                                      )}
                                    </div>
                                    {t.description && (
                                      <p className="mcp-tool-desc">{t.description}</p>
                                    )}
                                  </div>
                                ))
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Tab 2: Add New Server */}
          {activeTab === 'add' && (
            <div className="mcp-dialog-content">
              {/* Add Mode Selector */}
              <div className="mcp-mode-selector">
                <button
                  type="button"
                  className={`mcp-mode-btn ${addMode === 'presets' ? 'mcp-mode-btn--active' : ''}`}
                  onClick={() => setAddMode('presets')}
                >
                  Popular Presets
                </button>
                <button
                  type="button"
                  className={`mcp-mode-btn ${addMode === 'form' ? 'mcp-mode-btn--active' : ''}`}
                  onClick={() => setAddMode('form')}
                >
                  Custom Form
                </button>
                <button
                  type="button"
                  className={`mcp-mode-btn ${addMode === 'json' ? 'mcp-mode-btn--active' : ''}`}
                  onClick={() => setAddMode('json')}
                >
                  Paste JSON
                </button>
              </div>

              {/* Mode 1: Presets */}
              {addMode === 'presets' && (
                <div className="mcp-presets-grid">
                  {MCP_PRESETS.map((p) => (
                    <div key={p.id} className="mcp-preset-card">
                      <div className="mcp-preset-info">
                        <div className="mcp-preset-title-row">
                          <span className="mcp-preset-title">{p.name}</span>
                          <span className={`mcp-preset-key-tag ${p.requiresKey ? 'mcp-preset-key-tag--req' : 'mcp-preset-key-tag--free'}`}>
                            {p.requiresKey ? 'Requires Key' : 'No Key Needed'}
                          </span>
                        </div>
                        <div className="mcp-preset-desc">{p.description}</div>
                        {p.keyHint && <div className="mcp-preset-key-hint">{p.keyHint}</div>}
                        <code className="mcp-preset-cmd">{p.command} {p.args.join(' ')}</code>
                      </div>
                      <button
                        type="button"
                        className="mcp-dialog-btn mcp-dialog-btn--secondary"
                        onClick={() => applyPreset(p)}
                      >
                        Use Preset
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Mode 2: Custom Form */}
              {addMode === 'form' && (
                <form onSubmit={handleSave} className="mcp-form">
                  <div className="mcp-form-group">
                    <label className="mcp-form-label">Server Identifier</label>
                    <input
                      type="text"
                      className="mcp-form-input"
                      placeholder="e.g. fetch, my-db, context-api"
                      value={serverName}
                      onChange={(e) => setServerName(e.target.value)}
                      required
                    />
                    <span className="mcp-form-hint">Unique name without spaces, used in tool namespace: mcp__&lt;name&gt;_&lt;tool&gt;</span>
                  </div>

                  <div className="mcp-form-group">
                    <label className="mcp-form-label">Transport Type</label>
                    <div className="mcp-transport-toggle">
                      <button
                        type="button"
                        className={`mcp-transport-btn ${transport === 'stdio' ? 'mcp-transport-btn--active' : ''}`}
                        onClick={() => setTransport('stdio')}
                      >
                        stdio (Process / CLI)
                      </button>
                      <button
                        type="button"
                        className={`mcp-transport-btn ${transport === 'http' ? 'mcp-transport-btn--active' : ''}`}
                        onClick={() => setTransport('http')}
                      >
                        HTTP / SSE (Remote URL)
                      </button>
                    </div>
                  </div>

                  {transport === 'stdio' ? (
                    <>
                      <div className="mcp-form-row">
                        <div className="mcp-form-group mcp-form-group--half">
                          <label className="mcp-form-label">Command Executable</label>
                          <input
                            type="text"
                            className="mcp-form-input"
                            placeholder="e.g. npx, uvx, node, python3, docker"
                            value={command}
                            onChange={(e) => setCommand(e.target.value)}
                            required
                          />
                        </div>
                        <div className="mcp-form-group mcp-form-group--half">
                          <label className="mcp-form-label">Command Arguments</label>
                          <input
                            type="text"
                            className="mcp-form-input"
                            placeholder="e.g. -y @modelcontextprotocol/server-filesystem ."
                            value={argsStr}
                            onChange={(e) => setArgsStr(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="mcp-form-group">
                        <label className="mcp-form-label">Environment Variables (Optional)</label>
                        <textarea
                          className="mcp-form-textarea"
                          rows={3}
                          placeholder="API_KEY=xyz&#10;DATABASE_URL=postgres://..."
                          value={envStr}
                          onChange={(e) => setEnvStr(e.target.value)}
                        />
                        <span className="mcp-form-hint">One KEY=VALUE pair per line</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="mcp-form-group">
                        <label className="mcp-form-label">Server Endpoint URL</label>
                        <input
                          type="url"
                          className="mcp-form-input"
                          placeholder="e.g. http://127.0.0.1:3001/sse or https://mcp.example.com"
                          value={url}
                          onChange={(e) => setUrl(e.target.value)}
                          required
                        />
                      </div>

                      <div className="mcp-form-group">
                        <label className="mcp-form-label">Custom HTTP Headers (Optional)</label>
                        <textarea
                          className="mcp-form-textarea"
                          rows={3}
                          placeholder="Authorization: Bearer token_xyz&#10;X-Custom-Key: value"
                          value={headersStr}
                          onChange={(e) => setHeadersStr(e.target.value)}
                        />
                        <span className="mcp-form-hint">One Header: Value per line</span>
                      </div>
                    </>
                  )}

                  <div className="mcp-form-footer">
                    <button
                      type="button"
                      className="mcp-dialog-btn mcp-dialog-btn--secondary"
                      onClick={() => setActiveTab('servers')}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="mcp-dialog-btn mcp-dialog-btn--primary"
                      disabled={isSaving}
                    >
                      {isSaving ? 'Connecting...' : 'Connect Server'}
                    </button>
                  </div>
                </form>
              )}

              {/* Mode 3: Raw JSON */}
              {addMode === 'json' && (
                <form onSubmit={handleSave} className="mcp-form">
                  <div className="mcp-form-group">
                    <label className="mcp-form-label">Server Name (if pasting single server config)</label>
                    <input
                      type="text"
                      className="mcp-form-input"
                      placeholder="e.g. github, fetch (leave empty if JSON has mcpServers root)"
                      value={serverName}
                      onChange={(e) => setServerName(e.target.value)}
                    />
                  </div>

                  <div className="mcp-form-group">
                    <label className="mcp-form-label">JSON Configuration</label>
                    <textarea
                      className="mcp-form-textarea mcp-form-textarea--code"
                      rows={8}
                      placeholder={`{\n  "command": "npx",\n  "args": ["-y", "@modelcontextprotocol/server-fetch"]\n}`}
                      value={rawJson}
                      onChange={(e) => setRawJson(e.target.value)}
                      required
                    />
                    <span className="mcp-form-hint">Paste standard Claude Desktop or Cursor MCP JSON snippets directly.</span>
                  </div>

                  <div className="mcp-form-footer">
                    <button
                      type="button"
                      className="mcp-dialog-btn mcp-dialog-btn--secondary"
                      onClick={() => setActiveTab('servers')}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="mcp-dialog-btn mcp-dialog-btn--primary"
                      disabled={isSaving || !rawJson.trim()}
                    >
                      {isSaving ? 'Adding...' : 'Add JSON Configuration'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
