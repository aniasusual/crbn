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
  useEffect(() => {
    if (isOpen) {
      setErrorMsg(null);
      setSuccessMsg(null);
    }
  }, [isOpen]);

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
                              {isConfigured && (
                                <span className="apikey-badge apikey-badge-success">
                                  <span className="apikey-status-dot" />
                                  Configured
                                </span>
                              )}
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
        </DialogPanel>
      </div>
    </Dialog>
  );
}
