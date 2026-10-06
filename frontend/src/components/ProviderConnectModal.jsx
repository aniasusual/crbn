import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import './ProviderConnectModal.css';

const FEATURED_PROVIDERS = [
  {
    id: 'anthropic',
    name: 'Anthropic',
    plan: 'Claude',
    modelsText: 'Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3.5 Haiku',
  },
  {
    id: 'openai-codex',
    name: 'ChatGPT / Codex',
    plan: 'ChatGPT / OpenAI',
    modelsText: 'GPT-4o, o3-mini, Codex, GPT-4.5',
  },
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    plan: 'GitHub Copilot',
    modelsText: 'Claude 3.5 Sonnet, GPT-4o, o1-preview via Copilot',
  },
  {
    id: 'google-gemini-cli',
    name: 'Google Code Assist',
    plan: 'Google Cloud Code Assist',
    modelsText: 'Gemini 2.5 Flash, Gemini 2.5 Pro, Gemini 1.5 Pro',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    plan: 'Cursor',
    modelsText: 'Multi-model inference routing allowance',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    plan: 'OpenRouter (PKCE Direct)',
    modelsText: 'Access to 300+ models with direct sign-in',
  },
  {
    id: 'xai-oauth',
    name: 'xAI Grok',
    plan: 'xAI Grok',
    modelsText: 'Grok 2, Grok 3, Grok 2 Vision',
  },
  {
    id: 'devin',
    name: 'Devin',
    plan: 'Devin',
    modelsText: 'Cognition Devin inference pipeline',
  },
];

export default function ProviderConnectModal({
  isOpen,
  onClose,
  providers = [],
  onRefreshModels,
}) {
  const [activeSession, setActiveSession] = useState(null);
  const [connectingProvider, setConnectingProvider] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [gcpProjectId, setGcpProjectId] = useState('');

  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Poll in-flight OAuth session
  useEffect(() => {
    if (
      !activeSession ||
      activeSession.status === 'completed' ||
      activeSession.status === 'failed' ||
      activeSession.status === 'cancelled'
    ) {
      return;
    }

    const provider = activeSession.provider;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/auth/oauth/status/${encodeURIComponent(provider)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.session) {
            setActiveSession(data.session);
            if (data.session.status === 'completed') {
              setSuccessMsg(`Successfully connected ${provider}!`);
              setConnectingProvider(null);
              if (onRefreshModels) await onRefreshModels();
            } else if (data.session.status === 'failed') {
              setErrorMsg(data.session.error || 'Authentication failed');
              setConnectingProvider(null);
            }
          }
        }
      } catch (err) {
        console.warn('OAuth polling error:', err);
      }
    }, 1200);

    return () => clearInterval(interval);
  }, [activeSession, onRefreshModels]);

  const handleStartOAuth = async (providerId, customProjectId) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setConnectingProvider(providerId);

    try {
      const payload = { provider: providerId };
      const effectiveGcpId = (customProjectId || gcpProjectId).trim();
      if (providerId === 'google-gemini-cli' && effectiveGcpId) {
        payload.projectId = effectiveGcpId;
      }

      const res = await fetch(`${API_BASE_URL}/api/auth/oauth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const session = await res.json();
      setActiveSession(session);

      // Launch URL in browser
      const url = session.launchUrl || session.authUrl;
      if (url) {
        if (typeof window !== 'undefined' && window.require) {
          try {
            const { shell } = window.require('electron');
            shell.openExternal(url);
          } catch {
            window.open(url, '_blank', 'noopener,noreferrer');
          }
        } else {
          window.open(url, '_blank', 'noopener,noreferrer');
        }
      }
    } catch (err) {
      setErrorMsg(err.message);
      setConnectingProvider(null);
    }
  };

  const handleCancelOAuth = async (providerId) => {
    try {
      await fetch(`${API_BASE_URL}/api/auth/oauth/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: providerId }),
      });
    } catch {}
    setActiveSession(null);
    setConnectingProvider(null);
  };

  const handleDisconnect = async (providerId) => {
    if (!window.confirm(`Disconnect ${providerId}? Active models will be locked until reconnected.`)) return;
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/oauth/${encodeURIComponent(providerId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSuccessMsg(`Disconnected ${providerId}`);
        if (onRefreshModels) await onRefreshModels();
      }
    } catch (err) {
      setErrorMsg(`Failed to disconnect: ${err.message}`);
    }
  };


  const extractCode = (text) => {
    if (!text) return null;
    const match = text.match(/\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/i);
    return match ? match[1] : null;
  };

  if (!isOpen) return null;

  return (
    <div className="glass-connect-backdrop" onClick={onClose}>
      <div className="glass-connect-modal" onClick={(e) => e.stopPropagation()}>
        {/* Glow ambient background effect */}
        <div className="glass-connect-modal__glow" aria-hidden="true" />

        {/* Header */}
        <div className="glass-connect-modal__header">
          <div className="glass-connect-modal__header-left">
            <div className="glass-connect-modal__header-icon">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
              </svg>
            </div>
            <div>
              <h2 className="glass-connect-modal__title">Connect Providers</h2>
              <p className="glass-connect-modal__subtitle">
                Sign in with Claude, ChatGPT, Copilot and more without an API key.
              </p>
            </div>
          </div>
          <button className="glass-connect-modal__close-btn" onClick={onClose} aria-label="Close modal">
            ✕
          </button>
        </div>

        {/* Global Notifications */}
        {errorMsg && (
          <div className="glass-connect-banner glass-connect-banner--error">
            <span>{errorMsg}</span>
          </div>
        )}
        {successMsg && (
          <div className="glass-connect-banner glass-connect-banner--success">
            <span>{successMsg}</span>
          </div>
        )}

        {/* Provider List */}
        <div className="glass-connect-modal__list">
          {FEATURED_PROVIDERS.map((fp) => {
            const providerData = providers.find((p) => p.id === fp.id) || null;
            const isConnected = Boolean(providerData?.has_auth);
            const isConnecting =
              connectingProvider === fp.id ||
              (activeSession?.provider === fp.id &&
                (activeSession?.status === 'awaiting_user' || activeSession?.status === 'exchanging'));
            const deviceCode = activeSession?.instructions ? extractCode(activeSession.instructions) : null;

            return (
              <div
                key={fp.id}
                className={`glass-connect-card ${isConnected ? 'glass-connect-card--connected' : ''} ${
                  isConnecting ? 'glass-connect-card--active' : ''
                }`}
              >
                <div className="glass-connect-card__main">
                  <div
                    className={`glass-connect-card__badge-dot ${
                      isConnected ? 'glass-connect-card__badge-dot--active' : ''
                    }`}
                  />

                  <div className="glass-connect-card__info">
                    <div className="glass-connect-card__title-row">
                      <span className="glass-connect-card__name">{fp.name}</span>
                      {isConnected && (
                        <span className="glass-connect-card__live-status">
                          <span className="glass-connect-card__pulse-dot" />
                          <span>Active</span>
                        </span>
                      )}
                    </div>
                    <div className="glass-connect-card__plan-desc">{fp.plan}</div>
                    <div className="glass-connect-card__models">{fp.modelsText}</div>

                    {isConnected && providerData?.account_email && (
                      <div className="glass-connect-card__email">
                        Logged in as: <code>{providerData.account_email}</code>
                      </div>
                    )}
                  </div>

                  <div className="glass-connect-card__actions">
                    {isConnected ? (
                      <button
                        type="button"
                        className="glass-connect-btn glass-connect-btn--disconnect"
                        onClick={() => handleDisconnect(fp.id)}
                      >
                        Disconnect
                      </button>
                    ) : isConnecting ? (
                      <button
                        type="button"
                        className="glass-connect-btn glass-connect-btn--cancel"
                        onClick={() => handleCancelOAuth(fp.id)}
                      >
                        Cancel
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="glass-connect-btn glass-connect-btn--connect"
                        onClick={() => handleStartOAuth(fp.id)}
                      >
                        <span>Connect</span>
                        <span className="glass-connect-btn__arrow">→</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* In-Flight Authorization Tray */}
                {isConnecting && activeSession && (
                  <div className="glass-connect-card__tray">
                    <div className="glass-connect-tray__header">
                      <span className="glass-connect-tray__spinner" />
                      <span>Waiting for authorization in your browser...</span>
                    </div>

                    {deviceCode && (
                      <div className="glass-connect-tray__code-box">
                        <span className="glass-connect-tray__code">{deviceCode}</span>
                        <button
                          type="button"
                          className="glass-connect-tray__copy-btn"
                          onClick={() => {
                            navigator.clipboard.writeText(deviceCode);
                            setCopiedCode(true);
                            setTimeout(() => setCopiedCode(false), 2000);
                          }}
                        >
                          {copiedCode ? 'Copied' : 'Copy Code'}
                        </button>
                      </div>
                    )}

                    {activeSession.instructions && (
                      <p className="glass-connect-tray__instructions">{activeSession.instructions}</p>
                    )}

                    <div className="glass-connect-tray__links">
                      {(activeSession.launchUrl || activeSession.authUrl) && (
                        <a
                          href={activeSession.launchUrl || activeSession.authUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="glass-connect-tray__link"
                        >
                          Reopen Sign-In Page ↗
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Inline GCP Project ID Drawer */}
                {fp.id === 'google-gemini-cli' && (errorMsg?.includes('GOOGLE_CLOUD_PROJECT') || activeSession?.error?.includes('GOOGLE_CLOUD_PROJECT')) && (
                  <div className="glass-connect-card__gcp-box">
                    <div className="glass-connect-gcp-title">Google Cloud Project Required</div>
                    <div className="glass-connect-gcp-desc">
                      Your Google account needs a GCP Project ID from console.cloud.google.com. Enter it below to authorize.
                    </div>
                    <div className="glass-connect-gcp-row">
                      <input
                        type="text"
                        className="glass-connect-gcp-input"
                        placeholder="GCP Project ID (e.g. my-app-12345)"
                        value={gcpProjectId}
                        onChange={(e) => setGcpProjectId(e.target.value)}
                      />
                      <button
                        type="button"
                        className="glass-connect-btn glass-connect-btn--connect"
                        onClick={() => handleStartOAuth('google-gemini-cli', gcpProjectId)}
                        disabled={!gcpProjectId.trim()}
                      >
                        <span>Authorize Project</span>
                        <span className="glass-connect-btn__arrow">→</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

      </div>
    </div>
  );
}
