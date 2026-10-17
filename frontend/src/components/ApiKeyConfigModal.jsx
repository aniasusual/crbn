import { useState, useMemo, useEffect, useCallback } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import { API_BASE_URL } from '../config';
import './ApiKeyConfigModal.css';

export default function ApiKeyConfigModal({
  isOpen,
  onClose,
  providers = [],
  onRefreshModels,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [keyInputs, setKeyInputs] = useState({});
  const [editingProviders, setEditingProviders] = useState({});
  const [savingState, setSavingState] = useState({});
  const [localOverrides, setLocalOverrides] = useState({});
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  // Tabs: 'keys' (Standard cloud providers) | 'omniroute' (OmniRoute Gateway)
  const [activeTab, setActiveTab] = useState('keys');

  // OmniRoute Gateway State
  const [omniUrl, setOmniUrl] = useState('http://localhost:20128/v1');
  const [omniKey, setOmniKey] = useState('');
  const [omniConfig, setOmniConfig] = useState(null);
  const [isEditingOmni, setIsEditingOmni] = useState(false);
  const [isOmniLoading, setIsOmniLoading] = useState(false);
  const [isOmniSaving, setIsOmniSaving] = useState(false);

  const fetchOmniRoute = useCallback(async () => {
    setIsOmniLoading(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/gateway/omniroute`);
      if (res.ok) {
        const data = await res.json();
        setOmniConfig(data);
        if (data.baseUrl) {
          setOmniUrl(data.baseUrl);
        }
      }
    } catch (err) {
      console.warn('Failed to fetch OmniRoute config:', err);
    } finally {
      setIsOmniLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchOmniRoute();
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [isOpen, fetchOmniRoute]);

  const handleConnectOmniRoute = async () => {
    const url = omniUrl.trim();
    if (!url) {
      setErrorMsg('OmniRoute Base URL is required.');
      return;
    }

    setIsOmniSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/gateway`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'omniroute',
          base_url: url,
          api_key: omniKey.trim() || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to connect to OmniRoute gateway.');
      }

      setSuccessMsg(data.message || `Connected to OmniRoute! ${data.modelCount} models discovered.`);
      setOmniKey('');
      setIsEditingOmni(false);
      await fetchOmniRoute();
      if (onRefreshModels) await onRefreshModels();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsOmniSaving(false);
    }
  };

  const handleDisconnectOmniRoute = async () => {
    if (!window.confirm('Disconnect OmniRoute gateway? Models from this gateway will be removed.')) return;

    setIsOmniSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/gateway/omniroute`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to disconnect OmniRoute.');
      }

      setSuccessMsg('Disconnected OmniRoute gateway.');
      setIsEditingOmni(false);
      setOmniKey('');
      await fetchOmniRoute();
      if (onRefreshModels) await onRefreshModels();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsOmniSaving(false);
    }
  };

  // Filter providers that accept API keys with instant local override support
  const apiKeyProviders = useMemo(() => {
    return providers
      .filter((p) => p.id !== 'ollama' && p.id !== 'local' && p.id !== 'web')
      .map((p) => {
        const override = localOverrides[p.id];
        if (override !== undefined) {
          return {
            ...p,
            has_api_key: override.has_api_key,
            api_key_preview: override.api_key_preview,
          };
        }
        return p;
      });
  }, [providers, localOverrides]);

  // Search filter
  const filteredProviders = useMemo(() => {
    if (!searchQuery.trim()) return apiKeyProviders;
    const q = searchQuery.toLowerCase().trim();
    return apiKeyProviders.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.env_var && p.env_var.toLowerCase().includes(q))
    );
  }, [apiKeyProviders, searchQuery]);

  const handleSaveKey = async (providerId) => {
    const key = (keyInputs[providerId] || '').trim();
    if (!key) return;

    setSavingState((prev) => ({ ...prev, [providerId]: true }));
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          api_key: key,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to save API key');
      }

      const preview = key.length > 8 ? `${key.slice(0, 6)}••••${key.slice(-4)}` : '••••••••';
      setLocalOverrides((prev) => ({
        ...prev,
        [providerId]: { has_api_key: true, api_key_preview: preview },
      }));
      setSuccessMsg(`Saved API key for ${providerId}.`);
      setKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
      setEditingProviders((prev) => ({ ...prev, [providerId]: false }));

      if (onRefreshModels) await onRefreshModels();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setSavingState((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const handleDeleteKey = async (providerId) => {
    if (!window.confirm(`Remove API key for ${providerId}? Models from this provider will be locked.`)) return;

    setSavingState((prev) => ({ ...prev, [providerId]: true }));
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/api-key/${encodeURIComponent(providerId)}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to remove API key');
      }

      setLocalOverrides((prev) => ({
        ...prev,
        [providerId]: { has_api_key: false, api_key_preview: undefined },
      }));
      setSuccessMsg(`Removed API key for ${providerId}.`);
      setEditingProviders((prev) => ({ ...prev, [providerId]: false }));
      if (onRefreshModels) await onRefreshModels();
    } finally {
      setSavingState((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  const toggleEdit = (providerId) => {
    setEditingProviders((prev) => ({ ...prev, [providerId]: !prev[providerId] }));
    setKeyInputs((prev) => ({ ...prev, [providerId]: '' }));
  };

  return (
    <Dialog open={Boolean(isOpen)} onClose={onClose} className="apikey-dialog-root">
      <DialogBackdrop transition className="apikey-dialog-backdrop" />

      <div className="apikey-dialog-wrapper">
        <DialogPanel transition className="apikey-dialog-panel">
          {/* Header */}
          <div className="apikey-dialog-header">
            <div>
              <DialogTitle className="apikey-dialog-title">Configure API Keys</DialogTitle>
              <Description className="apikey-dialog-description">
                Save provider API keys locally in your encrypted workspace vault.
              </Description>
            </div>
            <button
              type="button"
              className="apikey-dialog-close"
              onClick={onClose}
              aria-label="Close"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="apikey-dialog-tabs">
            <button
              type="button"
              className={`apikey-tab-btn ${activeTab === 'keys' ? 'apikey-tab-btn--active' : ''}`}
              onClick={() => {
                setActiveTab('keys');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2l-2 2m-1.5 1.5L12 11l4 4 5.5-5.5a2.12 2.12 0 0 0 0-3L21 2z" />
                <path d="M15.5 7.5L14 9" />
                <path d="M3 21l3-3m0 0l2 2 4-4-2-2-4 4z" />
              </svg>
              <span>Standard Providers</span>
            </button>

            <button
              type="button"
              className={`apikey-tab-btn ${activeTab === 'omniroute' ? 'apikey-tab-btn--active' : ''}`}
              onClick={() => {
                setActiveTab('omniroute');
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="6" cy="19" r="3" />
                <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
                <circle cx="18" cy="5" r="3" />
              </svg>
              <span>OmniRoute Gateway</span>
              {omniConfig?.configured && (
                <span className="apikey-tab-badge">Active</span>
              )}
            </button>
          </div>

          {activeTab === 'keys' ? (
            <>
              {/* Search Bar */}
              <div className="apikey-dialog-search-area">
                <div className="apikey-search-container">
                  <svg className="apikey-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="11" cy="11" r="8"></circle>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                  </svg>
                  <input
                    type="text"
                    className="apikey-search-input"
                    placeholder="Search provider (e.g. Anthropic, OpenAI, DeepSeek, Groq)..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      className="apikey-search-clear"
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search"
                    >
                      ✕
                    </button>
                  )}
                </div>
              </div>

              {/* Providers List */}
              <div className="apikey-dialog-scroll-area">
                <div className="apikey-dialog-list">
                  {filteredProviders.map((p) => {
                    const isConfigured = Boolean(p.has_api_key);
                    const isEditing = Boolean(editingProviders[p.id]);
                    const isSaving = Boolean(savingState[p.id]);
                    const inputValue = keyInputs[p.id] || '';

                    return (
                      <div
                        key={p.id}
                        className={`apikey-item-card ${isConfigured ? 'apikey-item-card--configured' : ''}`}
                      >
                        <div className="apikey-item-main">
                          <div className="apikey-item-header">
                            <div className="apikey-item-title-row">
                              <span className="apikey-item-name">{p.label || p.id}</span>
                              {p.env_var && (
                                <code className="apikey-item-env-badge">{p.env_var}</code>
                              )}
                              {isConfigured ? (
                                <span className="apikey-badge apikey-badge-success">
                                  <span className="apikey-status-dot" />
                                  Configured
                                </span>
                              ) : (
                                <span className="apikey-badge apikey-badge-muted">
                                  Not configured
                                </span>
                              )}
                            </div>

                            <div className="apikey-item-models-count">
                              {p.model_count} models available
                            </div>
                          </div>

                          {/* Configured State: View Key & Actions */}
                          {isConfigured && !isEditing ? (
                            <div className="apikey-configured-row">
                              <div className="apikey-preview-box">
                                <span className="apikey-preview-label">Saved Key:</span>
                                <code className="apikey-preview-code">
                                  {p.api_key_preview || '••••••••••••••••'}
                                </code>
                              </div>
                              <div className="apikey-action-buttons">
                                <button
                                  type="button"
                                  className="apikey-btn apikey-btn-outline apikey-btn-sm"
                                  onClick={() => toggleEdit(p.id)}
                                >
                                  Update Key
                                </button>
                                <button
                                  type="button"
                                  className="apikey-btn apikey-btn-destructive apikey-btn-sm"
                                  onClick={() => handleDeleteKey(p.id)}
                                  disabled={isSaving}
                                >
                                  Remove
                                </button>
                              </div>
                            </div>
                          ) : (
                            /* Input State (Not configured or Editing) */
                            <div className="apikey-input-row">
                              <input
                                type="password"
                                 className="apikey-input"
                                placeholder={
                                  isEditing
                                    ? `Enter new ${p.env_var || 'API key'} to update...`
                                    : `Enter ${p.env_var || 'API key'} (e.g. sk-...)...`
                                }
                                value={inputValue}
                                onChange={(e) =>
                                  setKeyInputs((prev) => ({ ...prev, [p.id]: e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSaveKey(p.id);
                                  }
                                }}
                                autoFocus={isEditing}
                              />
                              <div className="apikey-action-buttons">
                                <button
                                  type="button"
                                  className="apikey-btn apikey-btn-primary apikey-btn-sm"
                                  onClick={() => handleSaveKey(p.id)}
                                  disabled={isSaving || !inputValue.trim()}
                                >
                                  {isSaving ? 'Saving...' : 'Save Key'}
                                </button>
                                {isEditing && (
                                  <button
                                    type="button"
                                    className="apikey-btn apikey-btn-outline apikey-btn-sm"
                                    onClick={() => toggleEdit(p.id)}
                                  >
                                    Cancel
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {filteredProviders.length === 0 && (
                    <div className="apikey-empty-state">
                      No providers found matching &ldquo;{searchQuery}&rdquo;
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            /* OmniRoute Gateway Tab */
            <div className="apikey-dialog-scroll-area">
              <div className="apikey-dialog-list">
                <div className={`apikey-item-card ${omniConfig?.configured ? 'apikey-item-card--configured' : ''}`}>
                  <div className="apikey-item-main">
                    <div className="apikey-item-header">
                      <div className="apikey-item-title-row">
                        <span className="apikey-item-name">OmniRoute Gateway</span>
                        <code className="apikey-item-env-badge">OMNIROUTE_API_KEY</code>
                        {omniConfig?.configured ? (
                          <span className="apikey-badge apikey-badge-success">
                            <span className="apikey-status-dot" />
                            Connected
                          </span>
                        ) : (
                          <span className="apikey-badge apikey-badge-muted">
                            Not connected
                          </span>
                        )}
                      </div>
                      <div className="apikey-item-models-count">
                        {omniConfig?.modelCount ? `${omniConfig.modelCount} models discovered` : 'OpenAI-compatible multi-provider gateway'}
                      </div>
                    </div>

                    {/* Configured State: View URL, Key & Actions */}
                    {omniConfig?.configured && !isEditingOmni ? (
                      <div className="apikey-configured-row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '0.625rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <div className="apikey-preview-box">
                              <span className="apikey-preview-label">Endpoint:</span>
                              <code className="apikey-preview-code">{omniConfig.baseUrl}</code>
                            </div>
                            <div className="apikey-preview-box">
                              <span className="apikey-preview-label">Saved Key:</span>
                              <code className="apikey-preview-code">{omniConfig.apiKeyPreview || 'None (Open Gateway)'}</code>
                            </div>
                          </div>
                          <div className="apikey-action-buttons">
                            <button
                              type="button"
                              className="apikey-btn apikey-btn-outline apikey-btn-sm"
                              onClick={() => {
                                setIsEditingOmni(true);
                                setOmniUrl(omniConfig.baseUrl || 'http://localhost:20128/v1');
                              }}
                            >
                              Update
                            </button>
                            <button
                              type="button"
                              className="apikey-btn apikey-btn-destructive apikey-btn-sm"
                              onClick={handleDisconnectOmniRoute}
                              disabled={isOmniSaving}
                            >
                              {isOmniSaving ? 'Removing...' : 'Remove'}
                            </button>
                          </div>
                        </div>

                        {omniConfig.models && omniConfig.models.length > 0 && (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', maxHeight: '7.5rem', overflowY: 'auto' }}>
                            {omniConfig.models.map((m) => (
                              <code
                                key={m.id}
                                className="apikey-preview-code"
                                style={{ fontSize: '0.75rem', padding: '0.125rem 0.4375rem' }}
                                title={m.id}
                              >
                                {m.id}
                              </code>
                            ))}
                          </div>
                        )}
                      </div>
                    ) : (
                      /* Input State: Base URL and Key */
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', paddingTop: '0.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <input
                            type="text"
                            className="apikey-input"
                            placeholder="Base URL (default: http://localhost:20128/v1)..."
                            value={omniUrl}
                            onChange={(e) => setOmniUrl(e.target.value)}
                          />
                          <button
                            type="button"
                            className="apikey-btn apikey-btn-outline apikey-btn-sm"
                            onClick={() => setOmniUrl('http://localhost:20128/v1')}
                          >
                            Default
                          </button>
                        </div>
                        <div className="apikey-input-row" style={{ paddingTop: 0 }}>
                          <input
                            type="password"
                            className="apikey-input"
                            placeholder="Bearer Token (optional for open local instances)..."
                            value={omniKey}
                            onChange={(e) => setOmniKey(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                e.preventDefault();
                                handleConnectOmniRoute();
                              }
                            }}
                          />
                          <div className="apikey-action-buttons">
                            <button
                              type="button"
                              className="apikey-btn apikey-btn-primary apikey-btn-sm"
                              onClick={handleConnectOmniRoute}
                              disabled={isOmniSaving || !omniUrl.trim()}
                            >
                              {isOmniSaving ? 'Connecting...' : omniConfig?.configured ? 'Update' : 'Connect'}
                            </button>
                            {isEditingOmni && (
                              <button
                                type="button"
                                className="apikey-btn apikey-btn-outline apikey-btn-sm"
                                onClick={() => setIsEditingOmni(false)}
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </DialogPanel>
      </div>
    </Dialog>
  );
}
