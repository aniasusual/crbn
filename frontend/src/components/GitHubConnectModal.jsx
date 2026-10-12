import { useState, useEffect } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from '@headlessui/react';
import { API_BASE_URL } from '../config';
import './GitHubConnectModal.css';

const GitHubIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function GitHubConnectModal({
  isOpen,
  onClose,
  onConnected,
  onDisconnected,
}) {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState('cli'); // 'cli' | 'token'

  const fetchStatus = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/api/github/status`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
        if (!data.detected_cli && !data.connected) {
          setTab('token');
        }
      }
    } catch (err) {
      console.error('Failed to fetch GitHub status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      setError(null);
      setTokenInput('');
    }
  }, [isOpen]);


  const handleConnectCli = async () => {
    try {
      setConnecting(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/api/github/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'cli' }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to connect via GitHub CLI');
      }
      setStatus((prev) => ({
        ...prev,
        connected: true,
        user: data.user,
      }));
      onConnected?.(data.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  const handleConnectToken = async (e) => {
    e?.preventDefault();
    if (!tokenInput.trim()) {
      setError('Please enter a GitHub Personal Access Token');
      return;
    }
    try {
      setConnecting(true);
      setError(null);
      const res = await fetch(`${API_BASE_URL}/api/github/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'token', token: tokenInput.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Invalid GitHub token');
      }
      setStatus((prev) => ({
        ...prev,
        connected: true,
        user: data.user,
      }));
      setTokenInput('');
      onConnected?.(data.user);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect GitHub account from crbn?')) return;
    try {
      setConnecting(true);
      setError(null);
      await fetch(`${API_BASE_URL}/api/github/disconnect`, { method: 'POST' });
      setStatus((prev) => ({
        ...prev,
        connected: false,
        user: null,
      }));
      onDisconnected?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <Dialog open={Boolean(isOpen)} onClose={onClose} className="gh-conn-dialog-root">
      <DialogBackdrop transition className="gh-conn-dialog-backdrop" />

      <div className="gh-conn-dialog-wrap">
        <DialogPanel transition className="gh-conn-dialog-panel">
          {/* Modal Header */}
          <div className="gh-connect-header">
            <div className="gh-connect-header-left">
              <div className="gh-connect-logo-badge">
                <GitHubIcon />
              </div>
              <div>
                <DialogTitle className="gh-connect-title">GitHub Integration</DialogTitle>
              <p className="gh-connect-subtitle">
                Connect your account to build on existing repos and push code directly.
              </p>
            </div>
          </div>
          <button
            type="button"
            className="gh-connect-close-btn"
            onClick={onClose}
            aria-label="Close"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Error notification */}
        {error && (
          <div className="gh-connect-alert">
            <span>{error}</span>
          </div>
        )}

        {/* Loading state */}
        {loading ? (
          <div className="gh-connect-loading">
            <div className="gh-connect-spinner" />
            <span>Checking GitHub connection...</span>
          </div>
        ) : status?.connected && status?.user ? (
          /* Connected State */
          <div className="gh-connect-connected-view">
            <div className="gh-connect-user-card">
              <img
                src={status.user.avatar_url}
                alt={status.user.login}
                className="gh-connect-avatar"
              />
              <div className="gh-connect-user-info">
                <div className="gh-connect-user-name-row">
                  <span className="gh-connect-user-name">{status.user.name || status.user.login}</span>
                  <span className="gh-connect-badge-active">
                    <CheckIcon /> Connected
                  </span>
                </div>
                <span className="gh-connect-user-login">@{status.user.login}</span>
                {status.user.html_url && (
                  <a
                    href={status.user.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gh-connect-profile-link"
                  >
                    View profile on GitHub <ExternalLinkIcon />
                  </a>
                )}
              </div>
            </div>

            <div className="gh-connect-stats-row">
              <div className="gh-connect-stat-item">
                <span className="gh-connect-stat-num">{status.user.public_repos ?? '-'}</span>
                <span className="gh-connect-stat-label">Public Repos</span>
              </div>
              <div className="gh-connect-stat-item">
                <span className="gh-connect-stat-num">
                  {status.user.total_private_repos !== undefined ? status.user.total_private_repos : '-'}
                </span>
                <span className="gh-connect-stat-label">Private Repos</span>
              </div>
            </div>

            <div className="gh-connect-footer">
              <button
                type="button"
                className="gh-connect-disconnect-btn"
                onClick={handleDisconnect}
                disabled={connecting}
              >
                {connecting ? 'Disconnecting...' : 'Disconnect Account'}
              </button>
              <button type="button" className="gh-connect-done-btn" onClick={onClose}>
                Done
              </button>
            </div>
          </div>
        ) : (
          /* Connect Options View */
          <div className="gh-connect-body">
            {/* Tab switch between CLI and Personal Access Token */}
            <div className="gh-connect-tabs">
              {status?.detected_cli && (
                <button
                  type="button"
                  className={`gh-connect-tab ${tab === 'cli' ? 'gh-connect-tab--active' : ''}`}
                  onClick={() => setTab('cli')}
                >
                  GitHub CLI ({status.detected_cli_user ? `@${status.detected_cli_user}` : 'Detected'})
                </button>
              )}
              <button
                type="button"
                className={`gh-connect-tab ${tab === 'token' ? 'gh-connect-tab--active' : ''}`}
                onClick={() => setTab('token')}
              >
                Personal Access Token
              </button>
            </div>

            {tab === 'cli' && status?.detected_cli ? (
              <div className="gh-connect-cli-box">
                <div className="gh-connect-cli-info">
                  <div className="gh-connect-cli-badge">Instant Connect</div>
                  <h3 className="gh-connect-cli-title">
                    Logged in via GitHub CLI as <strong>@{status.detected_cli_user}</strong>
                  </h3>
                  <p className="gh-connect-cli-desc">
                    crbn detected your active GitHub CLI credentials. Connect in one click without generating a token manually.
                  </p>
                </div>
                <button
                  type="button"
                  className="gh-connect-primary-btn"
                  onClick={handleConnectCli}
                  disabled={connecting}
                >
                  {connecting ? 'Connecting...' : `Connect as @${status.detected_cli_user}`}
                </button>
              </div>
            ) : (
              <form onSubmit={handleConnectToken} className="gh-connect-token-form">
                <div className="gh-connect-field">
                  <div className="gh-connect-field-header">
                    <label className="gh-connect-label">Personal Access Token</label>
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo,read:user,user:email&description=crbn-app"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gh-connect-token-link"
                    >
                      Generate token on GitHub <ExternalLinkIcon />
                    </a>
                  </div>
                  <div className="gh-connect-input-wrap">
                    <input
                      type={showToken ? 'text' : 'password'}
                      className="gh-connect-input"
                      placeholder="ghp_... or github_pat_..."
                      value={tokenInput}
                      onChange={(e) => setTokenInput(e.target.value)}
                      autoFocus
                      autoComplete="off"
                      spellCheck="false"
                    />
                    <button
                      type="button"
                      className="gh-connect-toggle-btn"
                      onClick={() => setShowToken(!showToken)}
                    >
                      {showToken ? 'Hide' : 'Show'}
                    </button>
                  </div>
                  <p className="gh-connect-help-text">
                    Requires <code>repo</code> scope to view repositories, clone projects, and push changes.
                  </p>
                </div>

                <div className="gh-connect-footer">
                  <button type="button" className="gh-connect-cancel-btn" onClick={onClose}>
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="gh-connect-primary-btn"
                    disabled={connecting || !tokenInput.trim()}
                  >
                    {connecting ? 'Connecting...' : 'Connect GitHub'}
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
