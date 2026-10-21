import { useState, useEffect, useCallback } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import { API_BASE_URL } from '../config';
import './OmniRouteModal.css';

const RouteIcon = ({ size = 20 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="19" r="3" />
    <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
    <circle cx="18" cy="5" r="3" />
  </svg>
);

const CloseIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export default function OmniRouteModal({
  isOpen,
  onClose,
  onRefreshModels,
}) {
  const [omniUrl, setOmniUrl] = useState('http://localhost:20128/v1');
  const [omniKey, setOmniKey] = useState('');
  const [omniConfig, setOmniConfig] = useState(null);
  const [isEditingOmni, setIsEditingOmni] = useState(false);
  const [isOmniLoading, setIsOmniLoading] = useState(false);
  const [isOmniSaving, setIsOmniSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);

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

  const handleConnectOmniRoute = async (e) => {
    e?.preventDefault();
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

  return (
    <Dialog open={Boolean(isOpen)} onClose={onClose} className="omni-dialog-root">
      <DialogBackdrop transition className="omni-dialog-backdrop" />

      <div className="omni-dialog-wrapper">
        <DialogPanel transition className="omni-dialog-panel">
          {/* Header */}
          <div className="omni-dialog-header">
            <div className="omni-dialog-header-left">
              <div className="omni-dialog-logo-badge">
                <RouteIcon size={18} />
              </div>
              <div className="omni-dialog-header-text">
                <DialogTitle className="omni-dialog-title">OmniRoute Gateway</DialogTitle>
                <Description className="omni-dialog-description">
                  Connect your local or remote OmniRoute proxy to unlock auto-combos and multi-model failover.
                </Description>
              </div>
            </div>
            <button
              type="button"
              className="omni-dialog-close"
              onClick={onClose}
              aria-label="Close"
            >
              <CloseIcon size={14} />
            </button>
          </div>

          {/* Alerts */}
          {errorMsg && (
            <div className="omni-alert omni-alert-destructive">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="omni-alert omni-alert-success">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <span>{successMsg}</span>
            </div>
          )}

          {/* Body */}
          <div className="omni-dialog-body">
            {omniConfig?.configured && !isEditingOmni ? (
              /* Connected View */
              <div className="omni-connected-card">
                <div className="omni-connected-header">
                  <div className="omni-connected-title-row">
                    <span className="omni-connected-title">Active Gateway</span>
                    <span className="omni-badge omni-badge-success">
                      <span className="omni-status-dot" />
                      Connected
                    </span>
                    {omniConfig.modelCount > 0 && (
                      <span className="omni-badge omni-badge-secondary">
                        {omniConfig.modelCount} {omniConfig.modelCount === 1 ? 'model' : 'models'}
                      </span>
                    )}
                  </div>
                  <div className="omni-connected-actions">
                    <button
                      type="button"
                      className="omni-btn omni-btn-outline omni-btn-sm"
                      onClick={() => {
                        setIsEditingOmni(true);
                        setOmniUrl(omniConfig.baseUrl || 'http://localhost:20128/v1');
                      }}
                    >
                      Update
                    </button>
                    <button
                      type="button"
                      className="omni-btn omni-btn-destructive omni-btn-sm"
                      onClick={handleDisconnectOmniRoute}
                      disabled={isOmniSaving}
                    >
                      {isOmniSaving ? 'Removing...' : 'Disconnect'}
                    </button>
                  </div>
                </div>

                <div className="omni-meta-grid">
                  <div className="omni-meta-box">
                    <span className="omni-meta-label">Endpoint URL:</span>
                    <code className="omni-meta-code">{omniConfig.baseUrl}</code>
                  </div>
                  <div className="omni-meta-box">
                    <span className="omni-meta-label">Authentication:</span>
                    <code className="omni-meta-code">{omniConfig.apiKeyPreview || 'None (Open Gateway)'}</code>
                  </div>
                </div>

                {omniConfig.models && omniConfig.models.length > 0 && (
                  <div className="omni-models-section">
                    <span className="omni-models-heading">Discovered Models & Combos</span>
                    <div className="omni-models-chip-grid">
                      {omniConfig.models.map((m) => (
                        <code
                          key={m.id}
                          className="omni-model-chip"
                          title={m.id}
                        >
                          {m.id}
                        </code>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Connect Form */
              <form onSubmit={handleConnectOmniRoute} className="omni-connect-form">
                <div className="omni-field">
                  <div className="omni-field-header">
                    <label className="omni-label">Gateway Base URL</label>
                    <button
                      type="button"
                      className="omni-link-btn"
                      onClick={() => setOmniUrl('http://localhost:20128/v1')}
                    >
                      Set default (http://localhost:20128/v1)
                    </button>
                  </div>
                  <input
                    type="text"
                    className="omni-input"
                    placeholder="http://localhost:20128/v1"
                    value={omniUrl}
                    onChange={(e) => setOmniUrl(e.target.value)}
                    autoFocus
                  />
                  <p className="omni-help-text">
                    By default, OmniRoute runs locally on <code>http://localhost:20128/v1</code> with open access.
                  </p>
                </div>

                <div className="omni-field">
                  <div className="omni-field-header">
                    <label className="omni-label">Bearer Token (Optional)</label>
                    <span className="omni-field-hint">Leave blank for open local instances</span>
                  </div>
                  <input
                    type="password"
                    className="omni-input"
                    placeholder="Enter API token if your instance is password-protected..."
                    value={omniKey}
                    onChange={(e) => setOmniKey(e.target.value)}
                  />
                </div>

                <div className="omni-form-footer">
                  {isEditingOmni && (
                    <button
                      type="button"
                      className="omni-btn omni-btn-outline"
                      onClick={() => setIsEditingOmni(false)}
                    >
                      Cancel
                    </button>
                  )}
                  <button
                    type="submit"
                    className="omni-btn omni-btn-primary"
                    disabled={isOmniSaving || !omniUrl.trim()}
                  >
                    {isOmniSaving ? 'Connecting...' : omniConfig?.configured ? 'Update Gateway' : 'Connect Gateway'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
