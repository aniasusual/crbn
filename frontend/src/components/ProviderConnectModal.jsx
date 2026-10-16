import { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import { API_BASE_URL } from '../config';
import './ProviderConnectModal.css';

const DEFAULT_PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', plan: 'Claude Pro / Max', modelsText: 'Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3.5 Haiku' },
  { id: 'openai-codex', name: 'ChatGPT Plus/Pro (Codex)', plan: 'ChatGPT Plus / Pro / Team', modelsText: 'GPT-4o, o1, o3-mini, Codex' },
  { id: 'openai-codex-device', name: 'ChatGPT Plus/Pro (Device Sign-In)', plan: 'Headless / Device Code', modelsText: 'GPT-4o, o1, o3-mini via Device Auth' },
  { id: 'github-copilot', name: 'GitHub Copilot', plan: 'Copilot Individual / Business / Enterprise', modelsText: 'Claude 3.7 Sonnet, GPT-4o, o3-mini via Copilot' },
  { id: 'google-gemini-cli', name: 'Google Cloud Code Assist', plan: 'Google Cloud / Gemini CLI', modelsText: 'Gemini 2.5 Pro, Gemini 2.5 Flash' },
  { id: 'cursor', name: 'Cursor', plan: 'Cursor Pro / Business', modelsText: 'Multi-model inference routing allowance' },
  { id: 'xai-oauth', name: 'xAI Grok', plan: 'SuperGrok / X Premium+', modelsText: 'Grok 2, Grok 3, Grok Vision' },
  { id: 'openrouter', name: 'OpenRouter (PKCE)', plan: 'OpenRouter Account', modelsText: 'Direct PKCE sign-in to 300+ models' },
  { id: 'zai-coding-plan', name: 'Z.AI (GLM Coding Plan)', plan: 'Z.AI Subscription', modelsText: 'GLM-4, GLM-4-Plus coding models' },
  { id: 'alibaba-coding-plan', name: 'Alibaba Coding Plan', plan: 'ModelStudio / DashScope', modelsText: 'Qwen 2.5 Coder, Qwen Max' },
  { id: 'alibaba-token-plan', name: 'QwenCloud Token Plan', plan: 'Token Plan Individual / Pro', modelsText: 'Qwen 2.5 Coder, Qwen Turbo, Qwen Plus' },
  { id: 'kimi-code', name: 'Moonshot Kimi Code', plan: 'Moonshot Kimi Plan', modelsText: 'Kimi k1.5, Moonshot Chat' },
  { id: 'gitlab-duo', name: 'GitLab Duo', plan: 'GitLab Duo Pro / Enterprise', modelsText: 'GitLab Duo code suggestions and chat' },
  { id: 'gitlab-duo-agent', name: 'GitLab Duo Agent', plan: 'GitLab Duo Workflow Agent', modelsText: 'Agentic multi-step coding workflow' },
  { id: 'devin', name: 'Devin', plan: 'Cognition Devin Plan', modelsText: 'Devin agent pipeline' },
  { id: 'factory-droid', name: 'Factory Droid', plan: 'Factory Code Companion', modelsText: 'Factory reasoning & droid coding models' },
  { id: 'muse-code', name: 'Muse Code', plan: 'Meta Muse Code Subscription', modelsText: 'Muse coding and refactoring models' },
  { id: 'stencil', name: 'Stencil', plan: 'Stencil Invite / Subscription', modelsText: 'Stencil collaborative coding models' },
  { id: 'google-antigravity', name: 'Google Antigravity', plan: 'Antigravity Internal / Enterprise', modelsText: 'Antigravity coding & inference agents' },
  { id: 'perplexity', name: 'Perplexity AI', plan: 'Perplexity Pro / Max', modelsText: 'Sonar, Sonar Deep Research' },
  { id: 'cloudflare-ai-gateway', name: 'Cloudflare AI Gateway', plan: 'Cloudflare Workers AI', modelsText: 'Unified Cloudflare gateway routing' },
  { id: 'kilo', name: 'Kilo Gateway', plan: 'Kilo Account', modelsText: 'Kilo model routing & inference' },
  { id: 'xiaomi', name: 'Xiaomi MiMo', plan: 'Xiaomi MiMo Platform', modelsText: 'MiMo v2.5 models' },
];

function extractCode(text) {
  if (!text) return null;
  const match = text.match(/\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/i);
  return match ? match[1] : null;
}

export default function ProviderConnectModal({
  isOpen,
  onClose,
  providers = [],
  onRefreshModels,
}) {
  const [oauthProviders, setOauthProviders] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeSession, setActiveSession] = useState(null);
  const [connectingProvider, setConnectingProvider] = useState(null);
  const [pasteCodeInput, setPasteCodeInput] = useState('');
  const [manualInputToggles, setManualInputToggles] = useState({});
  const [isSubmittingPrompt, setIsSubmittingPrompt] = useState(false);
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [gcpProjectId, setGcpProjectId] = useState('');

  // Fetch full dynamic OAuth providers directory from backend
  useEffect(() => {
    if (!isOpen) return;
    let isCancelled = false;

    fetch(`${API_BASE_URL}/api/auth/oauth/providers`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        if (!isCancelled && Array.isArray(data) && data.length > 0) {
          setOauthProviders(data);
        }
      })
      .catch((err) => {
        console.warn('Failed to load dynamic OAuth providers, using defaults:', err);
      });

    return () => {
      isCancelled = true;
    };
  }, [isOpen]);

  // Combined providers list: merges backend dynamic providers with default metadata
  const providerList = useMemo(() => {
    const map = new Map();

    for (const dp of DEFAULT_PROVIDERS) {
      map.set(dp.id, { ...dp });
    }

    for (const bp of oauthProviders) {
      const existing = map.get(bp.id) || {};
      map.set(bp.id, {
        id: bp.id,
        name: bp.name || existing.name || bp.id,
        plan: bp.plan || existing.plan || (bp.kind === 'device-code' ? 'Device Sign-In' : 'Direct Sign-In'),
        modelsText: bp.modelsText || existing.modelsText || `${bp.name || bp.id} models`,
        pasteCodeFlow: Boolean(bp.pasteCodeFlow),
        kind: bp.kind,
        connected: Boolean(bp.connected),
        account: bp.account || null,
      });
    }

    return Array.from(map.values());
  }, [oauthProviders]);

  // Filter providers by search
  const filteredProviders = useMemo(() => {
    if (!searchQuery.trim()) return providerList;
    const q = searchQuery.toLowerCase().trim();
    return providerList.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.plan && p.plan.toLowerCase().includes(q)) ||
        (p.modelsText && p.modelsText.toLowerCase().includes(q))
    );
  }, [providerList, searchQuery]);

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
              setSuccessMsg(`Connected ${provider} successfully.`);
              setConnectingProvider(null);
              setPasteCodeInput('');
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
    setPasteCodeInput('');

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

  const handleSubmitPrompt = async (providerId) => {
    const allowEmpty = activeSession?.promptAllowEmpty;
    if (!allowEmpty && !pasteCodeInput.trim()) return;

    setIsSubmittingPrompt(true);
    setErrorMsg(null);

    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/oauth/prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: providerId,
          response: pasteCodeInput.trim(),
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to submit authorization response');
      }

      setSuccessMsg('Response submitted.');
      setPasteCodeInput('');
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setIsSubmittingPrompt(false);
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
    setPasteCodeInput('');
  };

  const handleDisconnect = async (providerId) => {
    if (!window.confirm(`Disconnect ${providerId}? This removes stored credentials.`)) return;
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/auth/oauth/${encodeURIComponent(providerId)}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSuccessMsg(`Disconnected ${providerId}`);
        setOauthProviders((prev) =>
          prev.map((p) => (p.id === providerId ? { ...p, connected: false, account: null } : p))
        );
        if (onRefreshModels) await onRefreshModels();
      }
    } catch (err) {
      setErrorMsg(`Failed to disconnect: ${err.message}`);
    }
  };

  const toggleManualInput = (providerId) => {
    setManualInputToggles((prev) => ({
      ...prev,
      [providerId]: !prev[providerId],
    }));
  };

  return (
    <Dialog open={Boolean(isOpen)} onClose={onClose} className="shadcn-dialog-root">
      <DialogBackdrop transition className="shadcn-dialog-backdrop" />

      <div className="shadcn-dialog-wrapper">
        <DialogPanel transition className="shadcn-dialog-panel">
          {/* Dialog Header */}
          <div className="shadcn-dialog-header">
            <div className="shadcn-dialog-header-text">
              <DialogTitle className="shadcn-dialog-title">Connect Providers</DialogTitle>
              <Description className="shadcn-dialog-description">
                Configure official OAuth and subscriptions for your model catalog.
              </Description>
            </div>
            <button
              type="button"
              className="shadcn-dialog-close"
              onClick={onClose}
              aria-label="Close"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>

          {/* Search Input */}
          <div className="shadcn-dialog-search-wrap">
            <div className="shadcn-input-icon-container">
              <svg className="shadcn-input-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <input
                type="text"
                className="shadcn-input"
                placeholder="Search providers or models..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              {searchQuery && (
                <button
                  type="button"
                  className="shadcn-input-clear"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                >
                  ✕
                </button>
              )}
            </div>
          </div>

          {/* Alerts / Banners */}
          {errorMsg && (
            <div className="shadcn-alert shadcn-alert-destructive">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
              <span>{errorMsg}</span>
            </div>
          )}
          {successMsg && (
            <div className="shadcn-alert shadcn-alert-success">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                <polyline points="22 4 12 14.01 9 11.01"></polyline>
              </svg>
              <span>{successMsg}</span>
            </div>
          )}

          {/* Scrollable Provider List */}
          <div className="shadcn-dialog-scroll-area">
            <div className="shadcn-dialog-list">
              {filteredProviders.map((fp) => {
                const providerData = providers.find((p) => p.id === fp.id) || null;
                const isConnected = Boolean(fp.connected || providerData?.has_auth);
                const isConnecting =
                  connectingProvider === fp.id ||
                  (activeSession?.provider === fp.id &&
                    (activeSession?.status === 'awaiting_user' || activeSession?.status === 'exchanging'));

                const isRequiredPrompt =
                  isConnecting &&
                  Boolean(activeSession?.awaitingPrompt || activeSession?.promptMessage);

                const isManualFallbackOpen = Boolean(manualInputToggles[fp.id]);
                const shouldShowInput = isConnecting && (isRequiredPrompt || isManualFallbackOpen);

                const deviceCode = activeSession?.deviceCode || extractCode(activeSession?.instructions);
                const accountEmail = fp.account?.email || providerData?.account_email;

                return (
                  <div
                    key={fp.id}
                    className={`shadcn-item-card ${isConnected ? 'shadcn-item-card--connected' : ''} ${
                      isConnecting ? 'shadcn-item-card--active' : ''
                    }`}
                  >
                    <div className="shadcn-item-card-header">
                      {/* Left: Info */}
                      <div className="shadcn-item-info">
                        <div className="shadcn-item-title-row">
                          <span className="shadcn-item-name">{fp.name}</span>
                          <span className="shadcn-badge shadcn-badge-secondary">{fp.plan}</span>
                          {isConnected && (
                            <span className="shadcn-badge shadcn-badge-success">
                              <span className="shadcn-status-dot" />
                              Connected
                            </span>
                          )}
                        </div>

                        <div className="shadcn-item-description">
                          {fp.modelsText}
                        </div>

                        {isConnected && accountEmail && (
                          <div className="shadcn-item-account">
                            <span className="shadcn-item-account-label">Account:</span>
                            <code className="shadcn-item-account-code">{accountEmail}</code>
                            {fp.account?.orgName && (
                              <span className="shadcn-item-account-org">({fp.account.orgName})</span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Right: Actions */}
                      <div className="shadcn-item-actions">
                        {isConnected ? (
                          <button
                            type="button"
                            className="shadcn-btn shadcn-btn-destructive-outline"
                            onClick={() => handleDisconnect(fp.id)}
                          >
                            Disconnect
                          </button>
                        ) : isConnecting ? (
                          <button
                            type="button"
                            className="shadcn-btn shadcn-btn-outline"
                            onClick={() => handleCancelOAuth(fp.id)}
                          >
                            Cancel
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="shadcn-btn shadcn-btn-primary"
                            onClick={() => handleStartOAuth(fp.id)}
                          >
                            Connect
                          </button>
                        )}
                      </div>
                    </div>

                    {/* In-Flight Tray / Prompt */}
                    {isConnecting && activeSession && (
                      <div className="shadcn-tray">
                        <div className="shadcn-tray-status">
                          <span className="shadcn-spinner" />
                          <span>
                            {activeSession.promptMessage
                              ? activeSession.promptMessage
                              : 'Waiting for authorization in browser...'}
                          </span>
                        </div>

                        {deviceCode && (
                          <div className="shadcn-device-code-box">
                            <span className="shadcn-device-code-label">Enter code in browser:</span>
                            <div className="shadcn-device-code-inner">
                              <span className="shadcn-device-code">{deviceCode}</span>
                              <button
                                type="button"
                                className="shadcn-btn shadcn-btn-secondary shadcn-btn-xs"
                                onClick={() => {
                                  navigator.clipboard.writeText(deviceCode);
                                  setCopiedCode(true);
                                  setTimeout(() => setCopiedCode(false), 2000);
                                }}
                              >
                                {copiedCode ? 'Copied' : 'Copy'}
                              </button>
                            </div>
                          </div>
                        )}

                        {shouldShowInput && (
                          <div className="shadcn-prompt-box">
                            <label className="shadcn-prompt-label">
                              {activeSession.promptMessage || 'Paste authorization code or redirect URL:'}
                            </label>
                            <div className="shadcn-prompt-row">
                              <input
                                type="text"
                                className="shadcn-input shadcn-input-sm"
                                placeholder={
                                  activeSession.promptPlaceholder ||
                                  (activeSession.promptAllowEmpty
                                    ? 'Leave blank or enter value...'
                                    : 'Paste code or redirect URL here...')
                                }
                                value={pasteCodeInput}
                                onChange={(e) => setPasteCodeInput(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    handleSubmitPrompt(fp.id);
                                  }
                                }}
                                autoFocus
                              />
                              <button
                                type="button"
                                className="shadcn-btn shadcn-btn-primary shadcn-btn-sm"
                                onClick={() => handleSubmitPrompt(fp.id)}
                                disabled={isSubmittingPrompt || (!activeSession?.promptAllowEmpty && !pasteCodeInput.trim())}
                              >
                                {isSubmittingPrompt ? 'Submitting...' : 'Submit'}
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="shadcn-tray-footer">
                          {(activeSession.launchUrl || activeSession.authUrl) && (
                            <a
                              href={activeSession.launchUrl || activeSession.authUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="shadcn-link"
                            >
                              Reopen Browser Sign-In ↗
                            </a>
                          )}

                          {!isRequiredPrompt && (
                            <button
                              type="button"
                              className="shadcn-link-button"
                              onClick={() => toggleManualInput(fp.id)}
                            >
                              {isManualFallbackOpen ? 'Hide manual input' : 'Paste code or URL manually'}
                            </button>
                          )}
                        </div>
                      </div>
                    )}

                    {/* GCP Project ID Box */}
                    {fp.id === 'google-gemini-cli' && (errorMsg?.includes('GOOGLE_CLOUD_PROJECT') || activeSession?.error?.includes('GOOGLE_CLOUD_PROJECT')) && (
                      <div className="shadcn-gcp-box">
                        <div className="shadcn-gcp-title">Google Cloud Project Required</div>
                        <p className="shadcn-gcp-desc">
                          Your account requires a GCP Project ID. Enter it below to authorize.
                        </p>
                        <div className="shadcn-prompt-row">
                          <input
                            type="text"
                            className="shadcn-input shadcn-input-sm"
                            placeholder="GCP Project ID (e.g. my-app-12345)"
                            value={gcpProjectId}
                            onChange={(e) => setGcpProjectId(e.target.value)}
                          />
                          <button
                            type="button"
                            className="shadcn-btn shadcn-btn-primary shadcn-btn-sm"
                            onClick={() => handleStartOAuth('google-gemini-cli', gcpProjectId)}
                            disabled={!gcpProjectId.trim()}
                          >
                            Authorize
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredProviders.length === 0 && (
                <div className="shadcn-empty-state">
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
