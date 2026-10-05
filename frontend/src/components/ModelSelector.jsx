import React, { useState, useMemo, useRef } from 'react';
import { API_BASE_URL } from '../config';
import './ModelSelector.css';

const INITIAL_RENDER_COUNT = 60;
const RENDER_BATCH_SIZE = 60;

export default function ModelSelector({
  isOpen,
  onClose,
  selectedModel,
  onSelectModel,
  _hardwareInfo,
  models = [],
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

  const modelListRef = useRef(null);

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

    const list = Array.from(map.values());
    list.sort((a, b) => {
      if (a.has_auth !== b.has_auth) return a.has_auth ? -1 : 1;
      return a.label.localeCompare(b.label);
    });
    return list;
  }, [models]);

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

  const handleSelect = (model) => {
    const targetId = model.canonical_id || model.id;
    onSelectModel(targetId);
    onClose();
  };

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

  const handleRemoveApiKey = async (provider) => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/api-key/${encodeURIComponent(provider)}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        setActionSuccess(`Disconnected ${provider}`);
        if (onRefreshModels) await onRefreshModels();
      }
    } catch (err) {
      setActionError(`Failed to disconnect: ${err.message}`);
    }
  };

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
                <button
                  className="notion-btn notion-btn--tiny-disconnect"
                  onClick={() => handleRemoveApiKey(currentProviderInfo.id)}
                  title="Remove saved API key"
                >
                  Disconnect
                </button>
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

        {/* Focused Provider Unlock Dialog */}
        {unlockTargetModel && (
          <div
            className="notion-unlock-dialog__backdrop"
            onClick={() => setUnlockTargetModel(null)}
          >
            <div
              className="notion-unlock-dialog__card"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="notion-unlock-dialog__header">
                <div className="notion-unlock-dialog__header-text">
                  <h3 className="notion-unlock-dialog__title">
                    Configure {unlockTargetModel.provider_label || unlockTargetModel.provider}
                  </h3>
                  <p className="notion-unlock-dialog__subtitle">
                    Enter your API key to use <strong>{unlockTargetModel.name}</strong>. This unlocks all models under {unlockTargetModel.provider_label || unlockTargetModel.provider}.
                  </p>
                </div>
              </div>

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
                    autoFocus
                  />
                </div>

                <p className="notion-unlock-dialog__vault-note">
                  Stored locally in your agent vault (<code>~/.omp/agent/agent.db</code>).
                </p>

                {actionError && (
                  <div className="notion-modal__banner notion-modal__banner--error">
                    <span>{actionError}</span>
                  </div>
                )}

                <div className="notion-unlock-dialog__actions">
                  <button
                    type="submit"
                    className="notion-btn notion-btn--primary"
                    disabled={isSavingKey || !apiKeyInput.trim()}
                  >
                    {isSavingKey ? 'Saving...' : 'Save and Select'}
                  </button>
                  <button
                    type="button"
                    className="notion-btn notion-btn--secondary"
                    onClick={() => setUnlockTargetModel(null)}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
