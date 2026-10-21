import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import { API_BASE_URL } from '../config';
import ProviderConnectModal from './ProviderConnectModal';
import ApiKeyConfigModal from './ApiKeyConfigModal';
import './ModelSelector.css';

const INITIAL_RENDER_COUNT = 60;
const RENDER_BATCH_SIZE = 60;
const ZapIcon = ({ size = 14, className = '', style = {} }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.2"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    style={style}
  >
    <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
  </svg>
);

const KeyIcon = ({ size = 14, className = '', style = {} }) => (
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
    style={style}
  >
    <path d="M21 2l-2 2m-1.5 1.5L12 11l4 4 5.5-5.5a2.12 2.12 0 0 0 0-3L21 2z" />
    <path d="M15.5 7.5L14 9" />
    <path d="M3 21l3-3m0 0l2 2 4-4-2-2-4 4z" />
  </svg>
);

const LockIcon = ({ size = 16, className = '', style = {} }) => (
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
    style={style}
  >
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);

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
  const [selectedProvider, setSelectedProvider] = useState('ready'); // 'all' | 'ready' | 'ollama' | <provider_id>
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
  const [isFullOAuthModalOpen, setIsFullOAuthModalOpen] = useState(false);
  const [isFullApiKeyModalOpen, setIsFullApiKeyModalOpen] = useState(false);

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

  // Reset to 'ready' (Configured) by default whenever the dialog opens
  useEffect(() => {
    if (isOpen) {
      setSelectedProvider('ready');
      setSearchQuery('');
      setProviderSearch('');
      setRenderLimit(INITIAL_RENDER_COUNT);
      if (modelListRef.current) {
        modelListRef.current.scrollTop = 0;
      }
    }
  }, [isOpen]);
  const modelListRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        if (unlockTargetModel) {
          e.stopPropagation();
          setUnlockTargetModel(null);
          setApiKeyInput('');
          setActionError(null);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [isOpen, unlockTargetModel]);

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
    const targetId = model.canonical_id || `${model.provider}/${model.id}`;
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

  const currentProviderInfo =
    selectedProvider !== 'all' && selectedProvider !== 'ready' && selectedProvider !== 'ollama'
      ? providerStats.find((p) => p.id === selectedProvider)
      : null;

  return (
    <>
      <Dialog open={Boolean(isOpen)} onClose={onClose} className="models-dialog-root">
        <DialogBackdrop transition className="models-dialog-backdrop" />

        <div className="models-dialog-wrapper">
          <DialogPanel transition className="models-dialog-panel">
            {/* Header */}
            <div className="models-dialog-header">
              <div className="models-dialog-header-text">
                <div className="models-dialog-title-row">
                  <DialogTitle className="models-dialog-title">
                    Models <span className="models-dialog-title-serif">studio</span>
                  </DialogTitle>
                  <span className="models-dialog-counter-pill">
                    {models.length.toLocaleString()} models &middot; {providerStats.length} providers
                  </span>
                </div>
                <Description className="models-dialog-description">
                  Explore, filter, and activate models across local and cloud providers.
                </Description>
              </div>
              <button
                type="button"
                className="models-dialog-close"
                onClick={onClose}
                aria-label="Close"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>

            {/* Global Search Bar */}
            <div className="models-dialog-search-wrap">
              <div className="models-input-icon-container">
                <svg className="models-input-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <input
                  type="text"
                  className="models-search-input"
                  placeholder="Search models and providers (e.g. claude, gpt, sonnet, gemini, llama)..."
                  value={searchQuery}
                  onChange={handleSearchChange}
                  autoFocus
                />
                {searchQuery && (
                  <button
                    type="button"
                    className="models-search-clear"
                    onClick={handleSearchClear}
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            {/* Feedback Banners */}
            {actionError && (
              <div className="models-alert models-alert-destructive">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <line x1="12" y1="8" x2="12" y2="12"></line>
                  <line x1="12" y1="16" x2="12.01" y2="16"></line>
                </svg>
                <span>{actionError}</span>
                <button
                  type="button"
                  className="models-alert-dismiss"
                  onClick={() => setActionError(null)}
                  aria-label="Dismiss error"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            )}
            {actionSuccess && (
              <div className="models-alert models-alert-success">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                  <polyline points="22 4 12 14.01 9 11.01"></polyline>
                </svg>
                <span>{actionSuccess}</span>
                <button
                  type="button"
                  className="models-alert-dismiss"
                  onClick={() => setActionSuccess(null)}
                  aria-label="Dismiss message"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                  </svg>
                </button>
              </div>
            )}

            {/* Gateway Banner: Option 1 (When no models are configured) */}
            {readyModelsCount === 0 && (
              <div className="models-gateway-banner">
                <div className="models-gateway-header">
                  <div className="models-gateway-title-row">
                    <span className="models-gateway-sparkle">
                      <ZapIcon size={15} />
                    </span>
                    <span className="models-gateway-title">Connect a Provider to Unlock Models</span>
                    <span className="models-gateway-badge">Action Required</span>
                  </div>
                  <p className="models-gateway-desc">
                    You must connect at least one provider via <strong>OAuth</strong> or enter an <strong>API Key</strong> before selecting a model.
                  </p>
                </div>

                <div className="models-gateway-cards">
                  <button
                    type="button"
                    className="models-gateway-card models-gateway-card--oauth"
                    onClick={() => setIsFullOAuthModalOpen(true)}
                  >
                    <div className="models-gateway-card-body">
                      <div className="models-gateway-card-top">
                        <span className="models-gateway-card-badge">OAuth</span>
                        <span className="models-gateway-card-tag">Instant Sign-In</span>
                      </div>
                      <div className="models-gateway-card-heading">
                        <span className="models-gateway-card-icon">
                          <ZapIcon size={14} />
                        </span>
                        <span className="models-gateway-card-name">Connect via OAuth</span>
                      </div>
                      <span className="models-gateway-card-hint">Claude, ChatGPT, Copilot (No key needed)</span>
                    </div>
                    <span className="models-gateway-card-action">Connect Account →</span>
                  </button>

                  <div className="models-gateway-divider">
                    <span className="models-gateway-divider-line" />
                    <span className="models-gateway-divider-badge">OR</span>
                    <span className="models-gateway-divider-line" />
                  </div>

                  <button
                    type="button"
                    className="models-gateway-card models-gateway-card--apikey"
                    onClick={() => setIsFullApiKeyModalOpen(true)}
                  >
                    <div className="models-gateway-card-body">
                      <div className="models-gateway-card-top">
                        <span className="models-gateway-card-badge">API Key</span>
                        <span className="models-gateway-card-tag">Custom Keys</span>
                      </div>
                      <div className="models-gateway-card-heading">
                        <span className="models-gateway-card-icon">
                          <KeyIcon size={14} />
                        </span>
                        <span className="models-gateway-card-name">Configure API Keys</span>
                      </div>
                      <span className="models-gateway-card-hint">OpenAI, Anthropic, Gemini, DeepSeek, Groq...</span>
                    </div>
                  </button>
                </div>
              </div>
            )}

            {/* Two-Panel Layout */}
            <div className="models-dialog-panels">
              {/* Left Panel: Sidebar */}
              <aside className="models-sidebar">
                <div className="models-sidebar-header">
                  <span className="models-sidebar-title">Providers</span>
                  <span className="models-sidebar-badge">{providerStats.length}</span>
                </div>

                {/* Direct Config Modals Access */}
                <div className="models-quick-nav">
                  <button
                    type="button"
                    className="models-quick-nav-btn"
                    onClick={() => setIsFullApiKeyModalOpen(true)}
                  >
                    <span className="models-quick-nav-btn-left">
                      <KeyIcon size={13} />
                      <span>Configure API Keys</span>
                    </span>
                    <span className="models-quick-nav-arrow">↗</span>
                  </button>
                  <button
                    type="button"
                    className="models-quick-nav-btn"
                    onClick={() => setIsFullOAuthModalOpen(true)}
                  >
                    <span className="models-quick-nav-btn-left">
                      <ZapIcon size={13} />
                      <span>Connect via OAuth</span>
                    </span>
                    <span className="models-quick-nav-arrow">↗</span>
                  </button>
                </div>

                {/* Quick Filter Categories */}
                <div className="models-filter-tabs">
                  <button
                    type="button"
                    className={`models-filter-tab ${selectedProvider === 'ready' ? 'active' : ''}`}
                    onClick={() => handleProviderChange('ready')}
                  >
                    <span className="models-ready-label">
                      <span className="models-status-dot" /> Configured
                    </span>
                    <span className="models-filter-chip">{readyModelsCount}</span>
                  </button>
                  <button
                    type="button"
                    className={`models-filter-tab ${selectedProvider === 'all' ? 'active' : ''}`}
                    onClick={() => handleProviderChange('all')}
                  >
                    <span>All</span>
                    <span className="models-filter-chip">{models.length.toLocaleString()}</span>
                  </button>
                  {providerStats.some((p) => p.id === 'ollama') && (
                    <button
                      type="button"
                      className={`models-filter-tab ${selectedProvider === 'ollama' ? 'active' : ''}`}
                      onClick={() => handleProviderChange('ollama')}
                    >
                      <span>Local</span>
                      <span className="models-filter-chip">
                        {providerStats.find((p) => p.id === 'ollama')?.total_count || 0}
                      </span>
                    </button>
                  )}
                </div>

                {/* Provider Search */}
                <div className="models-provider-search-wrap">
                  <div className="models-provider-search-box">
                    <svg className="models-provider-search-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="11" cy="11" r="8"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <input
                      type="text"
                      className="models-provider-search-input"
                      placeholder="Filter providers..."
                      value={providerSearch}
                      onChange={(e) => setProviderSearch(e.target.value)}
                    />
                    {providerSearch && (
                      <button
                        type="button"
                        className="models-provider-search-clear"
                        onClick={() => setProviderSearch('')}
                        aria-label="Clear filter"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                </div>

                {/* Scrollable Provider List */}
                <div className="models-provider-list">
                  {filteredProviders.map((prov) => {
                    const isSelectedProv = selectedProvider === prov.id;
                    return (
                      <button
                        key={prov.id}
                        type="button"
                        className={`models-provider-item ${isSelectedProv ? 'active' : ''}`}
                        onClick={() => handleProviderChange(prov.id)}
                      >
                        <div className="models-provider-item-left">
                          <span
                            className={`models-provider-dot ${
                              prov.has_auth ? 'models-provider-dot--ready' : ''
                            }`}
                          />
                          <span className="models-provider-name">{prov.label}</span>
                        </div>
                        <span className="models-provider-count">{prov.total_count}</span>
                      </button>
                    );
                  })}
                </div>
              </aside>

              {/* Right Panel: Model Stream */}
              <main className="models-main-panel">
                <div className="models-main-header">
                  <div className="models-main-header-info">
                    <span className="models-main-heading">
                      {currentProviderInfo
                        ? currentProviderInfo.label
                        : selectedProvider === 'ready'
                        ? 'Configured Models'
                        : 'All Models'}
                    </span>
                    <span className="models-main-count">
                      ({filteredModels.length.toLocaleString()})
                    </span>
                  </div>
                  {currentProviderInfo && currentProviderInfo.has_auth && (
                    <div className="models-main-actions">
                      {currentProviderInfo.account_email && (
                        <span className="models-account-email">
                          {currentProviderInfo.account_email}
                        </span>
                      )}
                      <button
                        type="button"
                        className="models-btn models-btn-destructive-outline models-btn-xs"
                        onClick={() => handleDisconnectProvider(currentProviderInfo.id)}
                        title="Remove saved credentials"
                      >
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>

                <div
                  className="models-stream-list"
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
                            className={`models-card ${
                              isSelected ? 'models-card--selected' : ''
                            }`}
                            onClick={() => handleModelCardClick(model)}
                          >
                            <div className="models-card-body">
                              <div className="models-card-title-row">
                                <span className="models-card-name">{model.name}</span>
                                <span className="models-badge models-badge-secondary">
                                  {model.provider_label || model.provider}
                                </span>
                                {model.supports_thinking && (
                                  <span className="models-badge models-badge-accent">
                                    Reasoning
                                  </span>
                                )}
                                {model.supports_vision && (
                                  <span className="models-badge models-badge-secondary">
                                    Vision
                                  </span>
                                )}
                              </div>

                              <div className="models-card-id-row">
                                <code>{model.canonical_id || `${model.provider}/${model.id}`}</code>
                              </div>

                              <div className="models-card-specs">
                                <span>{model.context_length}</span>
                                 {model.cost_input !== undefined && (
                                  <>
                                    <span>&middot;</span>
                                    <span>
                                      ${model.cost_input}/M in, ${model.cost_output}/M out
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            {/* Card Action Status */}
                            <div className="models-card-actions">
                              {isSelected ? (
                                <span className="models-badge models-badge-success">
                                  <span className="models-status-dot" />
                                  Active
                                </span>
                              ) : isReady ? (
                                <button
                                  type="button"
                                  className="models-btn models-btn-primary models-btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleSelect(model);
                                  }}
                                >
                                  Select
                                </button>
                              ) : (
                                <div className="models-locked-pill">
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
                        <div className="models-load-more-wrap">
                          <button
                            type="button"
                            className="models-btn models-btn-outline models-btn-load-more"
                            onClick={() =>
                              setRenderLimit((prev) => Math.min(prev + RENDER_BATCH_SIZE, filteredModels.length))
                            }
                          >
                            Load more ({filteredModels.length - visibleModels.length} remaining)
                          </button>
                        </div>
                      )}
                    </>
                  ) : selectedProvider === 'ready' && readyModelsCount === 0 ? (
                    <div className="models-empty-state models-empty-state--ready">
                      <div className="models-empty-icon-wrap">
                        <LockIcon size={26} />
                      </div>
                      <span className="models-empty-title">No Configured Models Yet</span>
                      <p className="models-empty-desc">
                        Connect an account via OAuth or add an API Key to enable model inference.
                      </p>
                      <div className="models-empty-actions">
                        <button
                          type="button"
                          className="models-btn models-btn-primary"
                          onClick={() => setIsFullOAuthModalOpen(true)}
                        >
                          <ZapIcon size={13} style={{ marginRight: 6 }} />
                          Connect via OAuth
                        </button>
                        <button
                          type="button"
                          className="models-btn models-btn-secondary"
                          onClick={() => setIsFullApiKeyModalOpen(true)}
                        >
                          <KeyIcon size={13} style={{ marginRight: 6 }} />
                          Configure API Keys
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="models-empty-state">
                      <span className="models-empty-text">
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
                  className="models-unlock-backdrop"
                  onClick={() => {
                    if (!isOAuthActive) {
                      setUnlockTargetModel(null);
                      setOauthSession(null);
                    }
                  }}
                >
                  <div
                    className="models-unlock-card"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="models-unlock-header">
                      <div className="models-unlock-header-text">
                        <h3 className="models-unlock-title">
                          Connect {unlockTargetModel.provider_label || unlockTargetModel.provider}
                        </h3>
                        <p className="models-unlock-description">
                          To use <strong>{unlockTargetModel.name}</strong>, connect your provider account.
                        </p>
                      </div>
                      <button
                        type="button"
                        className="models-dialog-close"
                        onClick={() => {
                          if (!isOAuthActive) {
                            setUnlockTargetModel(null);
                            setOauthSession(null);
                          }
                        }}
                        aria-label="Close"
                      >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    </div>

                    {/* OAuth / Subscription Sign-in Section */}
                    {supportsOAuth && (
                      <div className="models-unlock-section">
                        <div className="models-unlock-section-header">
                          <span className="models-unlock-section-title">
                            Connect Account
                          </span>
                          <span className="models-badge models-badge-secondary">OAuth</span>
                        </div>

                        <p className="models-unlock-section-desc">
                          Sign in directly with your <strong>{oauthTitle}</strong> account without an API key.
                        </p>

                        {!oauthSession || oauthSession.status === 'cancelled' || oauthSession.status === 'failed' ? (
                          <button
                            type="button"
                            className="models-btn models-btn-primary"
                            style={{ width: '100%' }}
                            onClick={() => handleStartOAuth(unlockTargetModel.provider)}
                            disabled={isStartingOAuth}
                          >
                            <span>{isStartingOAuth ? 'Starting...' : `Sign in with ${oauthTitle}`}</span>
                          </button>
                        ) : isOAuthActive ? (
                          <div className="models-unlock-status-card">
                            <div className="models-unlock-status-header">
                              <span className="models-spinner" />
                              <span>Waiting for browser authorization...</span>
                            </div>

                            {deviceCode && (
                              <div className="models-code-box">
                                <span className="models-code-value">{deviceCode}</span>
                                <button
                                  type="button"
                                  className="models-btn models-btn-outline models-btn-xs"
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
                              <p className="models-unlock-instructions">
                                {oauthSession.instructions}
                              </p>
                            )}

                            <div className="models-unlock-actions-row">
                              {(oauthSession.launchUrl || oauthSession.authUrl) && (
                                <a
                                  href={oauthSession.launchUrl || oauthSession.authUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="models-btn models-btn-primary models-btn-sm"
                                  style={{ textDecoration: 'none' }}
                                >
                                  Open Browser Sign-in ↗
                                </a>
                              )}
                              <button
                                type="button"
                                className="models-btn models-btn-outline models-btn-sm"
                                onClick={handleCancelOAuth}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : oauthSession.status === 'completed' ? (
                          <div className="models-alert models-alert-success" style={{ margin: 0 }}>
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                              <polyline points="22 4 12 14.01 9 11.01"></polyline>
                            </svg>
                            <span>Successfully connected. Selecting model...</span>
                          </div>
                        ) : null}
                      </div>
                    )}

                    {supportsOAuth && (
                      <div className="models-unlock-divider">
                        <span>or</span>
                      </div>
                    )}

                    {/* API Key Form */}
                    {supportsOAuth && !showApiKeyFallback ? (
                      <div style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          className="models-unlock-toggle-btn"
                          onClick={() => setShowApiKeyFallback(true)}
                        >
                          <span>Enter manual API key instead ▼</span>
                        </button>
                      </div>
                    ) : (
                      <form onSubmit={handleSaveApiKey} className="models-unlock-form">
                        <div className="models-unlock-field">
                          <div className="models-unlock-field-header">
                            <label className="models-unlock-label">API Key</label>
                            {unlockTargetModel.env_var && (
                              <span className="models-badge models-badge-secondary">
                                <code>{unlockTargetModel.env_var}</code>
                              </span>
                            )}
                          </div>
                          <input
                            type="password"
                            className="models-input"
                            placeholder={`Enter ${unlockTargetModel.env_var || 'API key'}`}
                            value={apiKeyInput}
                            onChange={(e) => setApiKeyInput(e.target.value)}
                            autoFocus={!supportsOAuth}
                          />
                        </div>

                        <p className="models-unlock-vault-note">
                          Stored locally in your encrypted agent vault (<code>~/.omp/agent/agent.db</code>).
                        </p>

                        <div className="models-unlock-actions">
                          <button
                            type="button"
                            className="models-btn models-btn-outline models-btn-sm"
                            onClick={() => {
                              setUnlockTargetModel(null);
                              setOauthSession(null);
                            }}
                          >
                            Close
                          </button>
                          <button
                            type="submit"
                            className="models-btn models-btn-primary models-btn-sm"
                            disabled={isSavingKey || !apiKeyInput.trim()}
                          >
                            {isSavingKey ? 'Saving...' : 'Save API Key'}
                          </button>
                        </div>
                      </form>
                    )}

                    {actionError && (
                      <div className="models-alert models-alert-destructive" style={{ margin: '0.5rem 0 0 0' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <circle cx="12" cy="12" r="10"></circle>
                          <line x1="12" y1="8" x2="12" y2="12"></line>
                          <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                        <span>{actionError}</span>
                      </div>
                    )}

                    {actionSuccess && (
                      <div className="models-alert models-alert-success" style={{ margin: '0.5rem 0 0 0' }}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                          <polyline points="22 4 12 14.01 9 11.01"></polyline>
                        </svg>
                        <span>{actionSuccess}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}
          </DialogPanel>
        </div>
      </Dialog>

      {/* Full Dedicated Modals */}
      <ProviderConnectModal
        isOpen={isFullOAuthModalOpen}
        onClose={() => setIsFullOAuthModalOpen(false)}
        providers={providers}
        onRefreshModels={onRefreshModels}
        variant="full"
      />
      <ApiKeyConfigModal
        isOpen={isFullApiKeyModalOpen}
        onClose={() => setIsFullApiKeyModalOpen(false)}
        providers={providers}
        onRefreshModels={onRefreshModels}
      />
    </>
  );
}
