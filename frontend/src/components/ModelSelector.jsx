import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import './ModelSelector.css';

const INITIAL_RENDER_COUNT = 60;
const RENDER_BATCH_SIZE = 60;

function getFriendlyOAuthTitle(providerId, loginName) {
  if (providerId === 'anthropic') return 'Claude';
  if (providerId === 'openai-codex') return 'ChatGPT';
  if (providerId === 'github-copilot') return 'GitHub Copilot';
  if (providerId === 'google-gemini-cli') return 'Google Cloud Code Assist';
  if (providerId === 'google-antigravity') return 'Google Antigravity';
  if (providerId === 'cursor') return 'Cursor';
  if (providerId === 'devin') return 'Devin';
  if (providerId === 'gitlab-duo' || providerId === 'gitlab-duo-agent') return 'GitLab Duo';
  if (providerId === 'openrouter') return 'OpenRouter (PKCE)';
  if (providerId === 'zai-coding-plan') return 'Z.AI GLM';
  if (providerId === 'xai-oauth') return 'xAI Grok';
  return loginName || 'Connect Account';
}

export default function ModelSelector({
  isOpen,
  onClose,
  selectedModel,
  onSelectModel,
  _hardwareInfo,
  models = [],
  providers = [],
  onRefreshModels,
}) {
  const [selectedProvider, setSelectedProvider] = useState('all'); // 'all' | 'ready' | 'ollama' | <provider_id>
  const [providerSearch, setProviderSearch] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [renderLimit, setRenderLimit] = useState(INITIAL_RENDER_COUNT);

  // Provider Unlock Dialog State (modal overlay)
  const [unlockTargetModel, setUnlockTargetModel] = useState(null);
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [isSavingKey, setIsSavingKey] = useState(false);
  const [actionError, setActionError] = useState(null);
  const [actionSuccess, setActionSuccess] = useState(null);
  const [providerCatalog, setProviderCatalog] = useState(providers || []);
  const [oauthSession, setOauthSession] = useState(null);
  const [isStartingOAuth, setIsStartingOAuth] = useState(false);
  const [showApiKeyFallback, setShowApiKeyFallback] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Keep provider catalog synchronized with backend discovery
  useEffect(() => {
    if (providers && providers.length > 0) {
      setProviderCatalog(providers);
    } else {
      fetch(`${API_BASE_URL}/api/system/models-and-hardware`)
        .then((res) => res.json())
        .then((data) => {
          if (data.providers) setProviderCatalog(data.providers);
        })
        .catch(() => {});
    }
  }, [providers]);
  const modelListRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (unlockTargetModel) {
          setUnlockTargetModel(null);
          setApiKeyInput('');
          setActionError(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, unlockTargetModel, onClose]);

  const handleProviderChange = (pId) => {
    setSelectedProvider(pId);
    setRenderLimit(INITIAL_RENDER_COUNT);
    if (modelListRef.current) modelListRef.current.scrollTop = 0;
  };

  const handleSearchChange = (e) => {
    setSearchQuery(e.target.value);
    setRenderLimit(INITIAL_RENDER_COUNT);
    if (modelListRef.current) modelListRef.current.scrollTop = 0;
  };

  const handleSearchClear = () => {
    setSearchQuery('');
    setRenderLimit(INITIAL_RENDER_COUNT);
    if (modelListRef.current) modelListRef.current.scrollTop = 0;
  };

  // Aggregate providers list and statistics dynamically from models
  const providerStats = useMemo(() => {
    const map = new Map();
    for (const m of models) {
      const pid = m.provider;
      if (!map.has(pid)) {
        map.set(pid, {
          id: pid,
          label: m.provider_label || pid,
          env_var: m.env_var || null,
          has_auth: Boolean(m.has_auth || m.installed),
          total_count: 0,
          ready_count: 0,
        });
      }
      const entry = map.get(pid);
      entry.total_count++;
      if (m.has_auth || m.installed) {
        entry.ready_count++;
        entry.has_auth = true;
      }
    }

    const list = Array.from(map.values()).map((entry) => {
      const backendMeta = providerCatalog.find((p) => p.id === entry.id);
      return {
        ...entry,
        supports_oauth: Boolean(backendMeta?.supports_oauth),
        oauth_kind: backendMeta?.oauth_kind,
        login_name: backendMeta?.login_name,
        account_email: backendMeta?.account_email,
        account_id: backendMeta?.account_id,
        has_auth: entry.has_auth || Boolean(backendMeta?.has_auth),
      };
    });
    list.sort((a, b) => {
      if (a.has_auth !== b.has_auth) return a.has_auth ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return list;
  }, [models, providerCatalog]);

  const readyModelsCount = useMemo(() => {
    return models.filter((m) => m.has_auth || m.installed).length;
  }, [models]);

  // Filtered providers based on sidebar search
  const filteredProviders = useMemo(() => {
    if (!providerSearch.trim()) return providerStats;
    const q = providerSearch.toLowerCase().trim();
    return providerStats.filter(
      (p) => p.label.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)
    );
  }, [providerStats, providerSearch]);

  // Fast search and filter over all 5,602 models
  const filteredModels = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    return models.filter((m) => {
      if (selectedProvider === 'ready') {
        if (!m.has_auth && !m.installed) return false;
      } else if (selectedProvider === 'ollama') {
        if (m.provider !== 'ollama') return false;
      } else if (selectedProvider !== 'all') {
        if (m.provider !== selectedProvider) return false;
      }

      if (q) {
        const matchName = m.name?.toLowerCase().includes(q);
        const matchId = m.id?.toLowerCase().includes(q);
        const matchCanon = m.canonical_id?.toLowerCase().includes(q);
        const matchProvider = m.provider?.toLowerCase().includes(q) || m.provider_label?.toLowerCase().includes(q);
        const matchTags = m.tags?.some((t) => t.toLowerCase().includes(q));
        if (!matchName && !matchId && !matchCanon && !matchProvider && !matchTags) {
          return false;
        }
      }

      return true;
    });
  }, [models, selectedProvider, searchQuery]);

  // Sliced models for 60fps windowed DOM rendering
  const visibleModels = useMemo(() => {
    return filteredModels.slice(0, renderLimit);
  }, [filteredModels, renderLimit]);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.currentTarget;
    if (scrollHeight - scrollTop - clientHeight < 200) {
      if (renderLimit < filteredModels.length) {
        setRenderLimit((prev) => Math.min(prev + RENDER_BATCH_SIZE, filteredModels.length));
      }
    }
  };

  const handleSelect = useCallback((model) => {
    const targetId = model.canonical_id || model.id;
    onSelectModel(targetId);
    onClose();
  }, [onSelectModel, onClose]);

  const handleModelCardClick = (model) => {
    const isReady = Boolean(model.has_auth || model.installed);
    if (isReady) {
      handleSelect(model);
    } else {
      setUnlockTargetModel(model);
      setApiKeyInput('');
      setActionError(null);
    }
  };

  const handleSaveApiKey = async (e) => {
    e.preventDefault();
    if (!unlockTargetModel) return;

    const provider = unlockTargetModel.provider;
    const key = apiKeyInput.trim();
    if (!key) {
      setActionError(`Please enter a valid API key for ${unlockTargetModel.provider_label || provider}`);
      return;
    }

    setIsSavingKey(true);
    setActionError(null);
    setActionSuccess(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/api-key`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, api_key: key }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to save API key');
      }

      setActionSuccess(`Configured ${unlockTargetModel.provider_label || provider}`);

      if (onRefreshModels) {
        await onRefreshModels();
      }

      const chosenModel = unlockTargetModel;
      setUnlockTargetModel(null);
      handleSelect(chosenModel);
    } catch (err) {
      console.error('API key save error:', err);
      setActionError(`Error saving key: ${err.message}`);
    } finally {
      setIsSavingKey(false);
    }
  };

  // ──────────────────────────────────────────────
  // OAuth Handshake Operations
  // ──────────────────────────────────────────────

  const handleStartOAuth = async (providerId) => {
    setIsStartingOAuth(true);
    setActionError(null);
    setActionSuccess(null);
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/oauth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || 'Failed to start OAuth handshake');
      }
      const session = await response.json();
      setOauthSession(session);

      // Launch authorization page in system browser
      const targetUrl = session.launchUrl || session.authUrl;
      if (targetUrl) {
        if (typeof window !== 'undefined' && window.require) {
          try {
            const { shell } = window.require('electron');
            shell.openExternal(targetUrl);
          } catch {
            window.open(targetUrl, '_blank', 'noopener,noreferrer');
          }
        } else {
          window.open(targetUrl, '_blank', 'noopener,noreferrer');
        }
      }
    } catch (err) {
      setActionError(`OAuth error: ${err.message}`);
    } finally {
      setIsStartingOAuth(false);
    }
  };

  const handleCancelOAuth = async () => {
    if (!oauthSession) return;
    try {
      await fetch(`${API_BASE_URL}/api/auth/oauth/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: oauthSession.provider }),
      });
    } catch {}
    setOauthSession(null);
  };

  const handleDisconnectProvider = async (providerId) => {
    if (!window.confirm(`Disconnect ${providerId}? This removes saved credentials.`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/oauth/${encodeURIComponent(providerId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setActionSuccess(`Disconnected ${providerId}`);
        if (onRefreshModels) await onRefreshModels();
        setUnlockTargetModel(null);
        setOauthSession(null);
      }
    } catch (err) {
      setActionError(`Failed to disconnect: ${err.message}`);
    }
  };

  // Poll active OAuth handshake until completion or cancellation
  useEffect(() => {
    if (
      !oauthSession ||
      oauthSession.status === 'completed' ||
      oauthSession.status === 'failed' ||
      oauthSession.status === 'cancelled'
    ) {
      return;
    }

    const provider = oauthSession.provider;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/oauth/status/${encodeURIComponent(provider)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            setOauthSession(data.session);
            if (data.session.status === 'completed') {
              setActionSuccess(`Successfully connected ${provider}!`);
              if (onRefreshModels) await onRefreshModels();
              if (unlockTargetModel) {
                const target = unlockTargetModel;
                setTimeout(() => {
                  setUnlockTargetModel(null);
                  setOauthSession(null);
                  handleSelect(target);
                }, 900);
              }
            } else if (data.session.status === 'failed') {
              setActionError(data.session.error || 'Authentication handshake failed');
            }
          }
        }
      } catch (err) {
        console.warn('OAuth status poll error:', err);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [oauthSession, unlockTargetModel, onRefreshModels, handleSelect]);

  if (!isOpen) return null;

  const currentProviderInfo =
    selectedProvider !== 'all' && selectedProvider !== 'ready' && selectedProvider !== 'ollama'
      ? providerStats.find((p) => p.id === selectedProvider)
      : null;

  return (
    <div className="notion-modal__backdrop" onClick={onClose}>
      <div className="notion-modal__window" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="notion-modal__header">
          <div className="notion-modal__header-info">
            <div className="notion-modal__title-row">
              <h2 className="notion-modal__title">
                Models <span className="notion-modal__title-serif">studio</span>
              </h2>
              <span className="notion-modal__counter-pill">
                {models.length.toLocaleString()} models / {providerStats.length} providers
              </span>
            </div>
          </div>
          <button className="notion-modal__close-btn" onClick={onClose} aria-label="Close">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
          </button>
        </div>

        {/* Global Search Bar */}
        <div className="notion-modal__search-bar">
          <svg className="notion-modal__search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            className="notion-modal__search-input"
            placeholder="Search models and providers (e.g. claude, gpt, sonnet, gemini, llama)..."
            value={searchQuery}
            onChange={handleSearchChange}
            autoFocus
          />
          {searchQuery && (
            <button
              className="notion-modal__search-clear"
              onClick={handleSearchClear}
              title="Clear search"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          )}
        </div>

        {/* Feedback Banners */}
        {actionError && (
          <div className="notion-modal__banner notion-modal__banner--error">
            <span>{actionError}</span>
            <button onClick={() => setActionError(null)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}
        {actionSuccess && (
          <div className="notion-modal__banner notion-modal__banner--success">
            <span>{actionSuccess}</span>
            <button onClick={() => setActionSuccess(null)}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        )}

        {/* Two-Panel Layout */}
        <div className="notion-modal__panels">
          {/* Left Panel: Sidebar */}
          <aside className="notion-modal__sidebar">
            <div className="notion-modal__sidebar-header">
              <span className="notion-modal__sidebar-title">Providers</span>
              <span className="notion-modal__sidebar-badge">{providerStats.length}</span>
            </div>

            {/* Quick Filter Categories */}
            <div className="notion-modal__quick-filters">
              <button
                className={`notion-modal__quick-btn ${selectedProvider === 'all' ? 'active' : ''}`}
                onClick={() => handleProviderChange('all')}
              >
                <span>All</span>
                <span className="notion-modal__chip">{models.length.toLocaleString()}</span>
              </button>
              <button
                className={`notion-modal__quick-btn ${selectedProvider === 'ready' ? 'active' : ''}`}
                onClick={() => handleProviderChange('ready')}
              >
                <span className="notion-modal__ready-label">
                  <span className="notion-modal__status-dot" /> Configured
                </span>
                <span className="notion-modal__chip">{readyModelsCount}</span>
              </button>
              {providerStats.some((p) => p.id === 'ollama') && (
                <button
                  className={`notion-modal__quick-btn ${selectedProvider === 'ollama' ? 'active' : ''}`}
                  onClick={() => handleProviderChange('ollama')}
                >
                  <span>Local</span>
                  <span className="notion-modal__chip">
                    {providerStats.find((p) => p.id === 'ollama')?.total_count || 0}
                  </span>
                </button>
              )}
            </div>

            {/* Provider Search */}
            <div className="notion-modal__provider-search-box">
              <input
                type="text"
                className="notion-modal__provider-search-input"
                placeholder="Filter providers..."
                value={providerSearch}
                onChange={(e) => setProviderSearch(e.target.value)}
              />
            </div>

            {/* Scrollable Provider List */}
            <div className="notion-modal__provider-list">
              {filteredProviders.map((prov) => {
                const isSelectedProv = selectedProvider === prov.id;
                return (
                  <button
                    key={prov.id}
                    className={`notion-modal__provider-item ${isSelectedProv ? 'active' : ''}`}
                    onClick={() => handleProviderChange(prov.id)}
                  >
                    <div className="notion-modal__provider-item-left">
                      <span
                        className={`notion-modal__provider-dot ${
                          prov.has_auth ? 'notion-modal__provider-dot--ready' : ''
                        }`}
                      />
                      <span className="notion-modal__provider-name">{prov.label}</span>
                    </div>
                    <span className="notion-modal__provider-count">{prov.total_count}</span>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Right Panel: Model Stream */}
          <main className="notion-modal__main-panel">
            <div className="notion-modal__list-header">
              <span className="notion-modal__list-summary">
                {currentProviderInfo
                  ? currentProviderInfo.label
                  : selectedProvider === 'ready'
                  ? 'Configured Models'
                  : 'All Models'}
                <span className="notion-modal__dim-count">
                  {' '}({filteredModels.length.toLocaleString()})
                </span>
              </span>
              {currentProviderInfo && currentProviderInfo.has_auth && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {currentProviderInfo.account_email && (
                    <span style={{ fontSize: '11px', color: 'rgba(255,255,255,0.5)' }}>
                      {currentProviderInfo.account_email}
                    </span>
                  )}
                  <button
                    className="notion-btn notion-btn--tiny-disconnect"
                    onClick={() => handleDisconnectProvider(currentProviderInfo.id)}
                    title="Remove saved credentials"
                  >
                    Disconnect
                  </button>
                </div>
              )}
            </div>

            <div
              className="notion-modal__model-stream"
              ref={modelListRef}
              onScroll={handleScroll}
            >
              {visibleModels.length > 0 ? (
                <>
                  {visibleModels.map((model) => {
                    const isSelected =
                      selectedModel === model.id || selectedModel === model.canonical_id;
                    const isReady = Boolean(model.has_auth || model.installed);

                    return (
                      <div
                        key={`${model.provider}-${model.id}`}
                        className={`notion-model-card ${
                          isSelected ? 'notion-model-card--selected' : ''
                        }`}
                        onClick={() => handleModelCardClick(model)}
                      >
                        <div className="notion-model-card__body">
                          <div className="notion-model-card__title-row">
                            <span className="notion-model-card__title">{model.name}</span>
                            <span className="notion-model-card__provider-badge">
                              {model.provider_label || model.provider}
                            </span>
                            {model.supports_thinking && (
                              <span className="notion-model-card__badge">
                                Reasoning
                              </span>
                            )}
                            {model.supports_vision && (
                              <span className="notion-model-card__badge">
                                Vision
                              </span>
                            )}
                          </div>

                          <div className="notion-model-card__id-row">
                            <code>{model.canonical_id || `${model.provider}/${model.id}`}</code>
                          </div>

                          <div className="notion-model-card__specs">
                            <span>{model.context_length}</span>
                            {model.cost_input !== undefined && (
                              <>
                                <span>-</span>
                                <span>
                                  ${model.cost_input}/M in, ${model.cost_output}/M out
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Card Action Status */}
                        <div className="notion-model-card__actions">
                          {isSelected ? (
                            <div className="notion-model-card__active-pill">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12"></polyline>
                              </svg>
                              <span>Active</span>
                            </div>
                          ) : isReady ? (
                            <button
                              className="notion-btn notion-btn--select"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleSelect(model);
                              }}
                            >
                              Select
                            </button>
                          ) : (
                            <div className="notion-model-card__locked-indicator">
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                                <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                              </svg>
                              <span>Key required</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {renderLimit < filteredModels.length && (
                    <div className="notion-modal__load-more-row">
                      <button
                        className="notion-btn notion-btn--load-more"
                        onClick={() =>
                          setRenderLimit((prev) => Math.min(prev + RENDER_BATCH_SIZE, filteredModels.length))
                        }
                      >
                        Load more ({filteredModels.length - visibleModels.length} remaining)
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="notion-modal__empty-state">
                  <span className="notion-modal__empty-text">
                    No models found.
                  </span>
                </div>
              )}
            </div>
          </main>
        </div>

        {/* Focused Provider Unlock / OAuth Dialog */}
        {unlockTargetModel && (() => {
          const targetProviderMeta = providerStats.find((p) => p.id === unlockTargetModel.provider);
          const supportsOAuth = Boolean(targetProviderMeta?.supports_oauth);
          const oauthTitle = getFriendlyOAuthTitle(
            unlockTargetModel.provider,
            targetProviderMeta?.login_name || unlockTargetModel.provider_label
          );
          const isOAuthActive =
            oauthSession &&
            (oauthSession.status === 'awaiting_user' || oauthSession.status === 'exchanging');

          const extractUserCode = (text) => {
            if (!text) return null;
            const match = text.match(/\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/i);
            return match ? match[1] : null;
          };

          const deviceCode = oauthSession?.instructions ? extractUserCode(oauthSession.instructions) : null;

          return (
            <div
              className="notion-unlock-dialog__backdrop"
              onClick={() => {
                if (!isOAuthActive) {
                  setUnlockTargetModel(null);
                  setOauthSession(null);
                }
              }}
            >
              <div
                className="notion-unlock-dialog__card"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="notion-unlock-dialog__header">
                  <div className="notion-unlock-dialog__header-text">
                    <h3 className="notion-unlock-dialog__title">
                      Connect {unlockTargetModel.provider_label || unlockTargetModel.provider}
                    </h3>
                    <p className="notion-unlock-dialog__subtitle">
                      To use <strong>{unlockTargetModel.name}</strong>, connect your provider account.
                    </p>
                  </div>
                </div>

                {/* OAuth / Subscription Sign-in Section */}
                {supportsOAuth && (
                  <div className="notion-unlock-dialog__oauth-section">
                    <div className="notion-unlock-dialog__oauth-header">
                      <span className="notion-unlock-dialog__oauth-title">
                        Connect Account
                      </span>
                    </div>

                    <p className="notion-unlock-dialog__oauth-desc">
                      Sign in directly with your <strong>{oauthTitle}</strong> account without an API key.
                    </p>

                    {!oauthSession || oauthSession.status === 'cancelled' || oauthSession.status === 'failed' ? (
                      <button
                        type="button"
                        className="notion-unlock-dialog__oauth-btn"
                        onClick={() => handleStartOAuth(unlockTargetModel.provider)}
                        disabled={isStartingOAuth}
                      >
                        <span>{isStartingOAuth ? 'Starting...' : `Sign in with ${oauthTitle}`}</span>
                      </button>
                    ) : isOAuthActive ? (
                      <div className="notion-unlock-dialog__status-card">
                        <div className="notion-unlock-dialog__status-header">
                          <span className="notion-unlock-dialog__spinner" />
                          <span>Waiting for browser authorization...</span>
                        </div>

                        {deviceCode && (
                          <div className="notion-unlock-dialog__code-wrap">
                            <span className="notion-unlock-dialog__code-val">{deviceCode}</span>
                            <button
                              type="button"
                              className="notion-unlock-dialog__copy-code-btn"
                              onClick={() => {
                                navigator.clipboard.writeText(deviceCode);
                                setCopiedCode(true);
                                setTimeout(() => setCopiedCode(false), 2000);
                              }}
                            >
                              {copiedCode ? 'Copied!' : 'Copy Code'}
                            </button>
                          </div>
                        )}

                        {oauthSession.instructions && (
                          <p style={{ fontSize: '11.5px', color: 'rgba(255,255,255,0.6)', margin: 0 }}>
                            {oauthSession.instructions}
                          </p>
                        )}

                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {(oauthSession.launchUrl || oauthSession.authUrl) && (
                            <a
                              href={oauthSession.launchUrl || oauthSession.authUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="notion-unlock-dialog__browser-btn"
                            >
                              Open Browser Sign-in ↗
                            </a>
                          )}
                          <button
                            type="button"
                            className="notion-btn notion-btn--secondary"
                            style={{ fontSize: '12px', padding: '6px 12px' }}
                            onClick={handleCancelOAuth}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : oauthSession.status === 'completed' ? (
                      <div style={{ padding: '10px', background: 'rgba(34,197,94,0.15)', borderRadius: '6px', color: '#4ade80', fontSize: '12.5px', fontWeight: '500' }}>
                        Successfully connected. Selecting model...
                      </div>
                    ) : null}
                  </div>
                )}

                {supportsOAuth && (
                  <div className="notion-unlock-dialog__divider">
                    <span>or</span>
                  </div>
                )}

                {/* API Key Form */}
                {supportsOAuth && !showApiKeyFallback ? (
                  <div style={{ textAlign: 'center' }}>
                    <button
                      type="button"
                      className="notion-unlock-dialog__toggle-btn"
                      onClick={() => setShowApiKeyFallback(true)}
                    >
                      <span>Enter manual API key instead ▼</span>
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSaveApiKey} className="notion-unlock-dialog__form">
                    <div className="notion-unlock-dialog__field">
                      <div className="notion-unlock-dialog__field-header">
                        <label className="notion-unlock-dialog__label">API Key</label>
                        {unlockTargetModel.env_var && (
                          <span className="notion-unlock-dialog__env-tag">
                            <code>{unlockTargetModel.env_var}</code>
                          </span>
                        )}
                      </div>
                      <input
                        type="password"
                        className="notion-unlock-dialog__input"
                        placeholder={`Enter ${unlockTargetModel.env_var || 'API key'}`}
                        value={apiKeyInput}
                        onChange={(e) => setApiKeyInput(e.target.value)}
                        autoFocus={!supportsOAuth}
                      />
                    </div>

                    <p className="notion-unlock-dialog__vault-note">
                      Stored locally in your agent vault (<code>~/.omp/agent/agent.db</code>).
                    </p>

                    <div className="notion-unlock-dialog__actions">
                      <button
                        type="submit"
                        className="notion-btn notion-btn--primary"
                        disabled={isSavingKey || !apiKeyInput.trim()}
                      >
                        {isSavingKey ? 'Saving...' : 'Save API Key'}
                      </button>
                      <button
                        type="button"
                        className="notion-btn notion-btn--secondary"
                        onClick={() => {
                          setUnlockTargetModel(null);
                          setOauthSession(null);
                        }}
                      >
                        Close
                      </button>
                    </div>
                  </form>
                )}

                {actionError && (
                  <div className="notion-modal__banner notion-modal__banner--error" style={{ marginTop: '10px' }}>
                    <span>{actionError}</span>
                  </div>
                )}

                {actionSuccess && (
                  <div className="notion-modal__banner notion-modal__banner--success" style={{ marginTop: '10px' }}>
                    <span>{actionSuccess}</span>
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </div>
    </div>
  );
}
