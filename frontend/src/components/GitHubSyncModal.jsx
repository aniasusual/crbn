import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import GitHubConnectModal from './GitHubConnectModal';
import './GitHubSyncModal.css';

const GitHubIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

const BranchIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const ArrowUpIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="19" x2="12" y2="5" />
    <polyline points="5 12 12 5 19 12" />
  </svg>
);

const ArrowDownIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="12" y1="5" x2="12" y2="19" />
    <polyline points="19 12 12 19 5 12" />
  </svg>
);

const ExternalLinkIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
    <polyline points="15 3 21 3 21 9"></polyline>
    <line x1="10" y1="14" x2="21" y2="3"></line>
  </svg>
);

const CloseIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

const CheckIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const TreeIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="3" />
    <circle cx="6" cy="19" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <path d="M6 16v-1a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v1" />
  </svg>
);

export default function GitHubSyncModal({
  isOpen,
  onClose,
  projectName,
  activeBranch = 'main',
  isAgentRunning = false,
}) {
  const [authStatus, setAuthStatus] = useState(null);
  const [gitStatus, setGitStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionInProgress, setActionInProgress] = useState(false);
  const [progressMessage, setProgressMessage] = useState('');
  const [error, setError] = useState(null);
  const [successInfo, setSuccessInfo] = useState(null);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [showBranchesList, setShowBranchesList] = useState(false);

  // New Repo Form State
  const [newRepoName, setNewRepoName] = useState('');
  const [newRepoDesc, setNewRepoDesc] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);

  // Existing Repo Push State
  const [commitMessage, setCommitMessage] = useState('');
  const [customBranch, setCustomBranch] = useState('');
  const [useCustomBranch, setUseCustomBranch] = useState(false);
  // Existing Repo Destination State
  const [publishMode, setPublishMode] = useState('existing'); // 'existing' | 'new'
  const [userRepos, setUserRepos] = useState([]);
  const [targetExistingRepo, setTargetExistingRepo] = useState('');
  const [customRepoInput, setCustomRepoInput] = useState('');
  const [pushAllToExisting, setPushAllToExisting] = useState(false);
  const [isRetargeting, setIsRetargeting] = useState(false);

  const fetchStatus = useCallback(async () => {
    if (!projectName) return;
    try {
      setLoading(true);
      setError(null);

      // Check auth
      const authRes = await fetch(`${API_BASE_URL}/api/github/status`);
      const authData = authRes.ok ? await authRes.json() : null;
      setAuthStatus(authData);
      if (authData?.connected) {
        fetch(`${API_BASE_URL}/api/github/repos`)
          .then((r) => (r.ok ? r.json() : { repos: [] }))
          .then((d) => {
            const list = Array.isArray(d.repos) ? d.repos : [];
            setUserRepos(list);
            if (list.length > 0) {
              setTargetExistingRepo((prev) => prev || list[0].full_name);
            }
          })
          .catch(() => {});
      }

      // Check git status
      const gitRes = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/git-status`
      );
      const gitData = gitRes.ok ? await gitRes.json() : null;
      setGitStatus(gitData);

      // Default new repo name to project name
      setNewRepoName(projectName);
      setNewRepoDesc(`Built with crbn`);
    } catch (err) {
      console.error('[GitHubSyncModal] Failed to fetch status:', err);
      setError('Failed to fetch Git status');
    } finally {
      setLoading(false);
    }
  }, [projectName]);

  useEffect(() => {
    if (isOpen) {
      setSuccessInfo(null);
      setError(null);
      setShowBranchesList(false);
      fetchStatus();
    }
  }, [isOpen, fetchStatus]);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isOpen && !isConnectModalOpen) onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isConnectModalOpen, onClose]);
  // Handle Push to Existing Repository
  const handlePushToExisting = async (e) => {
    e?.preventDefault();
    const finalTarget = (targetExistingRepo === '__custom__' || !targetExistingRepo)
      ? customRepoInput.trim()
      : targetExistingRepo.trim();

    if (!finalTarget) {
      setError('Please select or enter a target GitHub repository');
      return;
    }

    try {
      setActionInProgress(true);
      setProgressMessage(`Pushing to ${finalTarget}...`);
      setError(null);

      const targetBranch = useCustomBranch && customBranch.trim()
        ? customBranch.trim()
        : (activeBranch || gitStatus?.active_branch || 'main');

      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/git-push`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            create_repo: false,
            target_repo: finalTarget,
            branch: targetBranch,
            commit_message: commitMessage.trim() || undefined,
            push_all: pushAllToExisting,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || `Failed to push to ${finalTarget}`);
      }

      setSuccessInfo({
        type: 'push',
        message: `Successfully pushed to ${data.github_repo} (${data.branch})`,
        repoUrl: data.github_url,
        branch: data.branch,
      });

      setCommitMessage('');
      setIsRetargeting(false);
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInProgress(false);
      setProgressMessage('');
    }
  };


  // Handle Publish / Create Repo & Push (pushes all branches on initial publish)
  const handlePublishRepo = async (e) => {
    e?.preventDefault();
    if (!newRepoName.trim()) {
      setError('Repository name is required');
      return;
    }

    try {
      setActionInProgress(true);
      setProgressMessage('Creating GitHub repository and pushing branches...');
      setError(null);

      const targetBranch = activeBranch || gitStatus?.active_branch || 'main';

      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/git-push`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            create_repo: true,
            repo_name: newRepoName.trim(),
            description: newRepoDesc.trim(),
            is_private: isPrivate,
            branch: targetBranch,
            commit_message: commitMessage.trim() || `Initial push to GitHub from crbn`,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to publish repository to GitHub');
      }

      setSuccessInfo({
        type: 'publish',
        message: `Successfully published to ${data.github_repo}!`,
        repoUrl: data.github_url,
        branch: data.branch,
      });

      // Refresh git status
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInProgress(false);
      setProgressMessage('');
    }
  };

  // Handle Push Changes to active branch
  const handlePush = async () => {
    try {
      setActionInProgress(true);
      setProgressMessage(`Pushing branch to GitHub...`);
      setError(null);

      const targetBranch = useCustomBranch && customBranch.trim()
        ? customBranch.trim()
        : (activeBranch || gitStatus?.active_branch || 'main');

      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/git-push`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            create_repo: false,
            branch: targetBranch,
            commit_message: commitMessage.trim() || undefined,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Git push failed');
      }

      setSuccessInfo({
        type: 'push',
        message: `Pushed commits to ${data.github_repo} (${data.branch})`,
        repoUrl: data.github_url,
        branch: data.branch,
      });

      setCommitMessage('');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInProgress(false);
      setProgressMessage('');
    }
  };

  // Handle Push All Branches to mirror the entire branch tree
  const handlePushAll = async () => {
    try {
      setActionInProgress(true);
      setProgressMessage('Pushing ALL branches to GitHub...');
      setError(null);

      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/git-push`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            create_repo: false,
            push_all: true,
            commit_message: commitMessage.trim() || undefined,
          }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Failed to push all branches');
      }

      setSuccessInfo({
        type: 'push_all',
        message: `Successfully pushed all branches to ${data.github_repo}!`,
        repoUrl: data.github_url,
      });

      setCommitMessage('');
      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInProgress(false);
      setProgressMessage('');
    }
  };

  // Handle Pull Changes
  const handlePull = async () => {
    try {
      setActionInProgress(true);
      setProgressMessage('Pulling latest updates from GitHub...');
      setError(null);

      const targetBranch = activeBranch || gitStatus?.active_branch || 'main';

      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/git-pull`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch: targetBranch }),
        }
      );

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || 'Git pull failed');
      }

      setSuccessInfo({
        type: 'pull',
        message: data.output || 'Pulled latest changes successfully.',
      });

      await fetchStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setActionInProgress(false);
      setProgressMessage('');
    }
  };

  if (!isOpen) return null;

  const currentBranchName = activeBranch || gitStatus?.active_branch || 'main';
  const parentBranchName = gitStatus?.parent_branch || (currentBranchName !== 'main' ? 'main' : null);
  const isLinked = Boolean(gitStatus?.has_remote && gitStatus?.github_repo);
  const branchDetails = gitStatus?.branch_details || [];

  return (
    <>
      <div className="gh-sync-backdrop" onClick={onClose}>
        <div className="gh-sync-modal" onClick={(e) => e.stopPropagation()}>
          <div className="gh-sync-glow" aria-hidden="true" />

          {/* Modal Header */}
          <div className="gh-sync-header">
            <div className="gh-sync-header-left">
              <div className="gh-sync-icon-badge">
                <GitHubIcon />
              </div>
              <div>
                <h2 className="gh-sync-title">
                  {isLinked ? 'Push to GitHub' : 'Publish to GitHub'}
                </h2>
                <div className="gh-sync-project-row">
                  <span className="gh-sync-project-name">{projectName}</span>
                  <span className="gh-sync-branch-badge">
                    <BranchIcon /> {currentBranchName}
                  </span>
                  {parentBranchName && parentBranchName !== currentBranchName && (
                    <span className="gh-sync-parent-hint">
                      branched from <strong>{parentBranchName}</strong>
                    </span>
                  )}
                </div>
              </div>
            </div>
            <button
              type="button"
              className="gh-sync-close-btn"
              onClick={onClose}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </div>

          {/* Notification Banners */}
          {error && (
            <div className="gh-sync-alert gh-sync-alert--error">
              <span>{error}</span>
            </div>
          )}

          {successInfo && (
            <div className="gh-sync-alert gh-sync-alert--success">
              <div className="gh-sync-success-content">
                <CheckIcon />
                <span>{successInfo.message}</span>
              </div>
              {successInfo.repoUrl && (
                <a
                  href={
                    successInfo.branch
                      ? `${successInfo.repoUrl}/tree/${successInfo.branch}`
                      : successInfo.repoUrl
                  }
                  target="_blank"
                  rel="noopener noreferrer"
                  className="gh-sync-external-link"
                >
                  View on GitHub <ExternalLinkIcon />
                </a>
              )}
            </div>
          )}

          {/* Loading Indicator */}
          {loading ? (
            <div className="gh-sync-loading">
              <div className="gh-sync-spinner" />
              <span>Checking repository status...</span>
            </div>
          ) : !authStatus?.connected ? (
            /* Prompt to Connect GitHub first */
            <div className="gh-sync-unauth-box">
              <div className="gh-sync-unauth-icon">
                <GitHubIcon />
              </div>
              <h3 className="gh-sync-unauth-title">GitHub Not Connected</h3>
              <p className="gh-sync-unauth-desc">
                Connect your GitHub account to publish this repository, create remote branches, and push code seamlessly.
              </p>
              <button
                type="button"
                className="gh-sync-primary-btn"
                onClick={() => setIsConnectModalOpen(true)}
              >
                Connect GitHub Account
              </button>
            </div>
          ) : !isLinked ? (
            /* CASE 1: Repo has not been pushed to GitHub yet -> Choice to push to existing or create new */
            <div className="gh-sync-publish-tabs-wrap">
              <div className="gh-sync-tabs">
                <button
                  type="button"
                  className={`gh-sync-tab-btn ${publishMode === 'existing' ? 'gh-sync-tab-btn--active' : ''}`}
                  onClick={() => setPublishMode('existing')}
                >
                  Push to Existing Repo
                </button>
                <button
                  type="button"
                  className={`gh-sync-tab-btn ${publishMode === 'new' ? 'gh-sync-tab-btn--active' : ''}`}
                  onClick={() => setPublishMode('new')}
                >
                  Create New Repo
                </button>
              </div>

              {publishMode === 'existing' ? (
                <form onSubmit={handlePushToExisting} className="gh-sync-publish-form">
                  <div className="gh-sync-info-banner">
                    <span className="gh-sync-info-title">Push to Existing Repository</span>
                    <span className="gh-sync-info-desc">
                      Select any existing repository from your GitHub account or specify owner/repo to push this project.
                    </span>
                  </div>

                  <div className="gh-sync-field">
                    <label className="gh-sync-label">Target Repository</label>
                    {userRepos.length > 0 && (
                      <select
                        className="gh-sync-select"
                        value={targetExistingRepo}
                        onChange={(e) => setTargetExistingRepo(e.target.value)}
                      >
                        <option value="">-- Choose from your repositories --</option>
                        {userRepos.map((r) => (
                          <option key={r.id} value={r.full_name}>
                            {r.full_name} {r.private ? '(private)' : ''}
                          </option>
                        ))}
                        <option value="__custom__">Type another repository name (owner/repo)...</option>
                      </select>
                    )}
                    {(targetExistingRepo === '__custom__' || userRepos.length === 0) && (
                      <input
                        type="text"
                        className="gh-sync-input"
                        style={{ marginTop: userRepos.length > 0 ? '8px' : '0' }}
                        placeholder="owner/repo-name (e.g. aniasusual/buildmeachess)"
                        value={customRepoInput}
                        onChange={(e) => setCustomRepoInput(e.target.value)}
                        required
                      />
                    )}
                  </div>

                  <div className="gh-sync-field">
                    <label className="gh-sync-label">Commit Message (Optional)</label>
                    <input
                      type="text"
                      className="gh-sync-input"
                      placeholder={`Initial push from crbn: ${currentBranchName}`}
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                    />
                  </div>

                  <div className="gh-sync-custom-branch-toggle">
                    <label className="gh-sync-checkbox-label">
                      <input
                        type="checkbox"
                        checked={useCustomBranch}
                        onChange={(e) => setUseCustomBranch(e.target.checked)}
                      />
                      <span>Push to a specific remote branch name</span>
                    </label>
                    {useCustomBranch && (
                      <input
                        type="text"
                        className="gh-sync-input gh-sync-input--branch"
                        placeholder="main or feature-branch"
                        value={customBranch}
                        onChange={(e) => setCustomBranch(e.target.value)}
                      />
                    )}
                  </div>

                  <div className="gh-sync-custom-branch-toggle">
                    <label className="gh-sync-checkbox-label">
                      <input
                        type="checkbox"
                        checked={pushAllToExisting}
                        onChange={(e) => setPushAllToExisting(e.target.checked)}
                      />
                      <span>Push all project branches</span>
                    </label>
                  </div>

                  <div className="gh-sync-footer">
                    <button
                      type="button"
                      className="gh-sync-cancel-btn"
                      onClick={onClose}
                      disabled={actionInProgress}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="gh-sync-primary-btn"
                      disabled={actionInProgress || isAgentRunning}
                    >
                      {actionInProgress ? (
                        <>
                          <div className="gh-sync-spinner-small" />
                          <span>{progressMessage || 'Pushing...'}</span>
                        </>
                      ) : (
                        <>
                          <ArrowUpIcon />
                          <span>Push to Repository</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              ) : (
                /* publishMode === 'new' -> Create New Repo Form */
                <form onSubmit={handlePublishRepo} className="gh-sync-publish-form">
                  <div className="gh-sync-info-banner">
                    <span className="gh-sync-info-title">Create New GitHub Repository</span>
                    <span className="gh-sync-info-desc">
                      Choose a repository name and privacy to create a fresh repository on your GitHub account.
                    </span>
                  </div>

                  <div className="gh-sync-field">
                    <label className="gh-sync-label">Repository Name</label>
                    <div className="gh-sync-input-prefix-wrap">
                      <span className="gh-sync-input-prefix">
                        {authStatus?.user?.login || 'user'} /
                      </span>
                      <input
                        type="text"
                        className="gh-sync-input gh-sync-input--prefixed"
                        value={newRepoName}
                        onChange={(e) => setNewRepoName(e.target.value)}
                        placeholder="my-cool-project"
                        required
                      />
                    </div>
                  </div>

                  <div className="gh-sync-field">
                    <label className="gh-sync-label">Description (Optional)</label>
                    <input
                      type="text"
                      className="gh-sync-input"
                      value={newRepoDesc}
                      onChange={(e) => setNewRepoDesc(e.target.value)}
                      placeholder="App built with crbn"
                    />
                  </div>

                  <div className="gh-sync-field">
                    <label className="gh-sync-label">Visibility</label>
                    <div className="gh-sync-radio-group">
                      <label
                        className={`gh-sync-radio-card ${isPrivate ? 'gh-sync-radio-card--active' : ''}`}
                        onClick={() => setIsPrivate(true)}
                      >
                        <div className="gh-sync-radio-header">
                          <span className="gh-sync-radio-title">Private</span>
                          {isPrivate && <span className="gh-sync-radio-check">✓</span>}
                        </div>
                        <span className="gh-sync-radio-desc">
                          Only you and collaborators can view and access this repository.
                        </span>
                      </label>

                      <label
                        className={`gh-sync-radio-card ${!isPrivate ? 'gh-sync-radio-card--active' : ''}`}
                        onClick={() => setIsPrivate(false)}
                      >
                        <div className="gh-sync-radio-header">
                          <span className="gh-sync-radio-title">Public</span>
                          {!isPrivate && <span className="gh-sync-radio-check">✓</span>}
                        </div>
                        <span className="gh-sync-radio-desc">
                          Anyone on the internet can view and clone this repository.
                        </span>
                      </label>
                    </div>
                  </div>

                  <div className="gh-sync-meta-note">
                    <span>
                      Initial push will publish active branch <strong>{currentBranchName}</strong> with all commits and checkpoints.
                    </span>
                  </div>

                  <div className="gh-sync-footer">
                    <button
                      type="button"
                      className="gh-sync-cancel-btn"
                      onClick={onClose}
                      disabled={actionInProgress}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="gh-sync-primary-btn"
                      disabled={actionInProgress || isAgentRunning || !newRepoName.trim()}
                    >
                      {actionInProgress ? (
                        <>
                          <div className="gh-sync-spinner-small" />
                          <span>{progressMessage || 'Publishing...'}</span>
                        </>
                      ) : (
                        <>
                          <ArrowUpIcon />
                          <span>Create & Push to GitHub</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}
            </div>
          ) : (
            /* CASE 2: Repo already linked to a GitHub remote */
            <div className="gh-sync-linked-view">
              {/* Linked Repo Banner */}
              <div className="gh-sync-remote-card">
                <div className="gh-sync-remote-left">
                  <span className="gh-sync-remote-label">Connected Remote</span>
                  <a
                    href={gitStatus.github_url || `https://github.com/${gitStatus.github_repo}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gh-sync-remote-url"
                  >
                    github.com/{gitStatus.github_repo} <ExternalLinkIcon />
                  </a>
                </div>
                <div className="gh-sync-remote-right">
                  <button
                    type="button"
                    className="gh-sync-retarget-btn"
                    onClick={() => setIsRetargeting((prev) => !prev)}
                    title="Push to another existing repository or change remote"
                  >
                    {isRetargeting ? 'Keep current' : 'Switch repository'}
                  </button>
                  <span className="gh-sync-status-badge">
                    <CheckIcon /> Synced
                  </span>
                </div>
              </div>

              {/* Retarget / Push to Another Repo Form */}
              {isRetargeting && (
                <form onSubmit={handlePushToExisting} className="gh-sync-retarget-box">
                  <div className="gh-sync-info-banner">
                    <span className="gh-sync-info-title">Push to Different Repository</span>
                    <span className="gh-sync-info-desc">
                      Choose any existing GitHub repository or type owner/repo. This project's remote origin will be updated and commits will be pushed there.
                    </span>
                  </div>

                  <div className="gh-sync-field">
                    <label className="gh-sync-label">Target Repository</label>
                    {userRepos.length > 0 && (
                      <select
                        className="gh-sync-select"
                        value={targetExistingRepo}
                        onChange={(e) => setTargetExistingRepo(e.target.value)}
                      >
                        <option value="">-- Choose from your repositories --</option>
                        {userRepos.map((r) => (
                          <option key={r.id} value={r.full_name}>
                            {r.full_name} {r.private ? '(private)' : ''}
                          </option>
                        ))}
                        <option value="__custom__">Type another repository name (owner/repo)...</option>
                      </select>
                    )}
                    {(targetExistingRepo === '__custom__' || userRepos.length === 0) && (
                      <input
                        type="text"
                        className="gh-sync-input"
                        style={{ marginTop: userRepos.length > 0 ? '8px' : '0' }}
                        placeholder="owner/repo-name (e.g. aniasusual/buildmeachess)"
                        value={customRepoInput}
                        onChange={(e) => setCustomRepoInput(e.target.value)}
                        required
                      />
                    )}
                  </div>

                  <div className="gh-sync-field">
                    <label className="gh-sync-label">Commit Message (Optional)</label>
                    <input
                      type="text"
                      className="gh-sync-input"
                      placeholder={`Update from crbn: ${currentBranchName}`}
                      value={commitMessage}
                      onChange={(e) => setCommitMessage(e.target.value)}
                    />
                  </div>

                  <div className="gh-sync-custom-branch-toggle">
                    <label className="gh-sync-checkbox-label">
                      <input
                        type="checkbox"
                        checked={useCustomBranch}
                        onChange={(e) => setUseCustomBranch(e.target.checked)}
                      />
                      <span>Push to a new remote branch name</span>
                    </label>
                    {useCustomBranch && (
                      <input
                        type="text"
                        className="gh-sync-input gh-sync-input--branch"
                        placeholder="feature-my-experiment"
                        value={customBranch}
                        onChange={(e) => setCustomBranch(e.target.value)}
                      />
                    )}
                  </div>

                  <div className="gh-sync-custom-branch-toggle">
                    <label className="gh-sync-checkbox-label">
                      <input
                        type="checkbox"
                        checked={pushAllToExisting}
                        onChange={(e) => setPushAllToExisting(e.target.checked)}
                      />
                      <span>Push all project branches to this repository</span>
                    </label>
                  </div>

                  <div className="gh-sync-footer">
                    <button
                      type="button"
                      className="gh-sync-cancel-btn"
                      onClick={() => setIsRetargeting(false)}
                      disabled={actionInProgress}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="gh-sync-primary-btn"
                      disabled={actionInProgress || isAgentRunning}
                    >
                      {actionInProgress ? (
                        <>
                          <div className="gh-sync-spinner-small" />
                          <span>{progressMessage || 'Pushing...'}</span>
                        </>
                      ) : (
                        <>
                          <ArrowUpIcon />
                          <span>Push & Link to Repository</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              )}

              {/* Branch Hierarchy Ribbon */}
              {branchDetails.length > 1 && (
                <div className="gh-sync-branch-tree-box">
                  <div
                    className="gh-sync-branch-tree-header"
                    onClick={() => setShowBranchesList((prev) => !prev)}
                  >
                    <div className="gh-sync-branch-tree-title">
                      <TreeIcon />
                      <span>Project Branches ({branchDetails.length})</span>
                    </div>
                    <span className="gh-sync-branch-tree-toggle">
                      {showBranchesList ? 'Hide details ▲' : 'View all branches ▼'}
                    </span>
                  </div>

                  {showBranchesList && (
                    <div className="gh-sync-branch-list">
                      {branchDetails.map((b) => (
                        <div
                          key={b.name}
                          className={`gh-sync-branch-row ${b.is_active ? 'gh-sync-branch-row--active' : ''}`}
                        >
                          <div className="gh-sync-branch-row-left">
                            <span className="gh-sync-branch-icon">
                              <BranchIcon />
                            </span>
                            <span className="gh-sync-branch-name">{b.name}</span>
                            {b.parent_branch && b.parent_branch !== b.name && (
                              <span className="gh-sync-branch-parent">
                                from {b.parent_branch}
                              </span>
                            )}
                          </div>
                          <div className="gh-sync-branch-row-right">
                            {b.is_active && (
                              <span className="gh-sync-active-tag">Active</span>
                            )}
                            <span
                              className={`gh-sync-tracking-tag ${
                                b.has_remote_tracking
                                  ? 'gh-sync-tracking-tag--synced'
                                  : 'gh-sync-tracking-tag--local'
                              }`}
                            >
                              {b.has_remote_tracking ? 'Remote' : 'Local only'}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Git Activity & Ahead/Behind Status */}
              <div className="gh-sync-stats-grid">
                <div className="gh-sync-stat-card">
                  <div className="gh-sync-stat-header">
                    <ArrowUpIcon />
                    <span>To Push</span>
                  </div>
                  <span className="gh-sync-stat-value">
                    {gitStatus.ahead_count} {gitStatus.ahead_count === 1 ? 'commit' : 'commits'}
                  </span>
                  <span className="gh-sync-stat-hint">Ahead of origin</span>
                </div>

                <div className="gh-sync-stat-card">
                  <div className="gh-sync-stat-header">
                    <ArrowDownIcon />
                    <span>To Pull</span>
                  </div>
                  <span className="gh-sync-stat-value">
                    {gitStatus.behind_count} {gitStatus.behind_count === 1 ? 'commit' : 'commits'}
                  </span>
                  <span className="gh-sync-stat-hint">Behind origin</span>
                </div>

                <div className="gh-sync-stat-card">
                  <div className="gh-sync-stat-header">
                    <BranchIcon />
                    <span>Working Tree</span>
                  </div>
                  <span className="gh-sync-stat-value">
                    {gitStatus.uncommitted_count}{' '}
                    {gitStatus.uncommitted_count === 1 ? 'file' : 'files'}
                  </span>
                  <span className="gh-sync-stat-hint">
                    {gitStatus.uncommitted_count > 0 ? 'Pending changes' : 'Clean'}
                  </span>
                </div>
              </div>

              {/* Last Commit Info */}
              {gitStatus.last_commit && (
                <div className="gh-sync-last-commit">
                  <div className="gh-sync-commit-title-row">
                    <span className="gh-sync-commit-hash">{gitStatus.last_commit.hash}</span>
                    <span className="gh-sync-commit-date">
                      {gitStatus.last_commit.relative_date}
                    </span>
                  </div>
                  <span className="gh-sync-commit-msg">
                    {gitStatus.last_commit.message}
                  </span>
                </div>
              )}

              {/* Commit Message Input */}
              <div className="gh-sync-field">
                <label className="gh-sync-label">
                  Commit Message {gitStatus.uncommitted_count > 0 && '(Auto-commits working tree)'}
                </label>
                <input
                  type="text"
                  className="gh-sync-input"
                  placeholder={`Update from crbn: ${currentBranchName}`}
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                />
              </div>

              {/* Custom branch toggle */}
              <div className="gh-sync-custom-branch-toggle">
                <label className="gh-sync-checkbox-label">
                  <input
                    type="checkbox"
                    checked={useCustomBranch}
                    onChange={(e) => setUseCustomBranch(e.target.checked)}
                  />
                  <span>Push to a new remote branch name</span>
                </label>
                {useCustomBranch && (
                  <input
                    type="text"
                    className="gh-sync-input gh-sync-input--branch"
                    placeholder="feature-my-experiment"
                    value={customBranch}
                    onChange={(e) => setCustomBranch(e.target.value)}
                  />
                )}
              </div>

              {/* Smart Quick links with Parent Branch comparison */}
              <div className="gh-sync-links-row">
                {gitStatus.github_repo && (
                  <>
                    <a
                      href={`https://github.com/${gitStatus.github_repo}/compare/${parentBranchName || 'main'}...${currentBranchName}?expand=1`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gh-sync-quick-link"
                      title={`Create Pull Request targeting ${parentBranchName || 'main'}`}
                    >
                      Create PR into <strong>{parentBranchName || 'main'}</strong> <ExternalLinkIcon />
                    </a>
                    <a
                      href={`https://github.com/${gitStatus.github_repo}/tree/${currentBranchName}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="gh-sync-quick-link"
                    >
                      Branch on GitHub <ExternalLinkIcon />
                    </a>
                  </>
                )}
              </div>

              {/* Actions Footer */}
              <div className="gh-sync-footer">
                <button
                  type="button"
                  className="gh-sync-pull-btn"
                  onClick={handlePull}
                  disabled={actionInProgress || isAgentRunning}
                  title="Pull latest remote commits into this branch"
                >
                  <ArrowDownIcon />
                  <span>Pull</span>
                </button>

                {branchDetails.length > 1 && (
                  <button
                    type="button"
                    className="gh-sync-push-all-btn"
                    onClick={handlePushAll}
                    disabled={actionInProgress || isAgentRunning}
                    title="Push every branch in this project to GitHub (git push --all)"
                  >
                    <TreeIcon />
                    <span>Push All Branches</span>
                  </button>
                )}

                <button
                  type="button"
                  className="gh-sync-primary-btn"
                  onClick={handlePush}
                  disabled={actionInProgress || isAgentRunning}
                >
                  {actionInProgress ? (
                    <>
                      <div className="gh-sync-spinner-small" />
                      <span>{progressMessage || 'Pushing...'}</span>
                    </>
                  ) : (
                    <>
                      <ArrowUpIcon />
                      <span>
                        Push {useCustomBranch && customBranch ? customBranch : currentBranchName}
                      </span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Sub-modal to connect GitHub account if unauthenticated */}
      <GitHubConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        onConnected={() => {
          fetchStatus();
        }}
      />
    </>
  );
}
