import { useState, useEffect, useId, useMemo, useCallback } from 'react';
import ModelSelector from './ModelSelector';
import ProviderConnectModal from './ProviderConnectModal';
import GitHubConnectModal from './GitHubConnectModal';
import McpConnectModal from './McpConnectModal';
import PluginsModal from './PluginsModal';
import AttachmentRibbon from './AttachmentRibbon';
import { AsciiEffect } from '@/components/ui/ascii-effect';
import { GrainGradient } from '@/components/ui/grain-gradient';
import InteractiveListPreview from '@/components/ui/interactive-list-preview';
import { SilkAurora } from '@/components/ui/silk-aurora';
import { useMediaAttachments } from '../hooks/useMediaAttachments';
import { API_BASE_URL } from '../config';
import './WelcomeView.css';

const GitHubIcon = ({ size = 16 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
  </svg>
);

const StarIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
  </svg>
);

const BranchIcon = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const LockIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
    <path d="M7 11V7a5 5 0 0 1 10 0v4" />
  </svg>
);
const ForkIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="18" r="3" />
    <circle cx="6" cy="6" r="3" />
    <circle cx="18" cy="6" r="3" />
    <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9" />
    <path d="M12 12v3" />
  </svg>
);

const FolderIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
  </svg>
);


export default function WelcomeView({
  onSubmit,
  onConnectAndBuild,
  onOpenProject,
  onImportLocalProject,
  onDeleteProject,
  isExiting = false,
  isTransitioning = false,
  hardwareInfo,
  models = [],
  providers = [],
  selectedModel,
  onSelectModel,
  onRefreshModels,
  prompt: controlledPrompt,
  onPromptChange,
}) {
  const [localPrompt, setLocalPrompt] = useState('');
  const prompt = controlledPrompt !== undefined ? controlledPrompt : localPrompt;
  const setPrompt = onPromptChange || setLocalPrompt;

  const [isNaming, setIsNaming] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const [isConnectModalOpen, setIsConnectModalOpen] = useState(false);
  const [isGitHubConnectModalOpen, setIsGitHubConnectModalOpen] = useState(false);
  const [isMcpModalOpen, setIsMcpModalOpen] = useState(false);
  const [mcpCount, setMcpCount] = useState(0);
  const [isPluginsModalOpen, setIsPluginsModalOpen] = useState(false);
  const [pluginsCount, setPluginsCount] = useState(0);
  const [welcomeMode, setWelcomeMode] = useState('build');

  const [justConnectedProvider, setJustConnectedProvider] = useState(null);

  const hasAnyConfiguredAuth = useMemo(() => {
    return (
      models.some((m) => Boolean(m.has_auth || m.installed)) ||
      providers.some((p) => Boolean(p.has_auth || p.connected))
    );
  }, [models, providers]);
  const isAnyModalOpen =
    isModelSelectorOpen ||
    isConnectModalOpen ||
    isGitHubConnectModalOpen ||
    isMcpModalOpen ||
    isPluginsModalOpen;

  const fetchGlobalMcp = useCallback(() => {
    fetch(`${API_BASE_URL}/api/projects/_global/mcp`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.servers)) {
          const active = data.servers.filter((s) => !s.disabled).length;
          setMcpCount(active);
        }
      })
      .catch(() => {});
  }, []);

  const fetchGlobalPlugins = useCallback(() => {
    fetch(`${API_BASE_URL}/api/projects/_global/plugins`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.plugins)) {
          const active = data.plugins.filter((p) => p.enabled && !p.shadowed).length;
          setPluginsCount(active);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchGlobalMcp();
    fetchGlobalPlugins();
  }, [fetchGlobalMcp, fetchGlobalPlugins]);

  // GitHub Integration State
  const [githubStatus, setGithubStatus] = useState(null);
  const [githubRepos, setGithubRepos] = useState([]);
  const [isLoadingGithubRepos, setIsLoadingGithubRepos] = useState(false);
  const [activeWelcomeTab, setActiveWelcomeTab] = useState('timelines'); // 'timelines' | 'github'
  const [repoSearch, setRepoSearch] = useState('');
  const [repoVisibilityFilter, setRepoVisibilityFilter] = useState('all'); // 'all' | 'public' | 'private'
  const [selectedRepo, setSelectedRepo] = useState(null);
  const [repoBranches, setRepoBranches] = useState([]);
  const [selectedBranch, setSelectedBranch] = useState('main');
  const [isLoadingBranches, setIsLoadingBranches] = useState(false);
  const [shouldForkThirdParty, setShouldForkThirdParty] = useState(true);

  const isCurrentUserRepo = Boolean(
    githubStatus?.user &&
    selectedRepo &&
    selectedRepo.owner?.toLowerCase() === githubStatus.user.login?.toLowerCase()
  );
  const isThirdPartyRepo = Boolean(selectedRepo && !isCurrentUserRepo);
  const isCustomRepoQuery = Boolean(repoSearch.trim().includes('/') || repoSearch.trim().includes('github.com'));

  const handleOpenFolder = async () => {
    try {
      let usedIpc = false;
      if (window.crbnDesktop?.selectDirectory) {
        usedIpc = true;
        try {
          const chosen = await window.crbnDesktop.selectDirectory();
          if (chosen) {
            onImportLocalProject?.(chosen);
          }
          return;
        } catch (ipcErr) {
          console.warn('[WelcomeView] Desktop native folder picker unavailable in current Electron process:', ipcErr);
        }
      }

      // Fallback if running Electron main process hasn't restarted or if running in web
      const entered = window.prompt(
        usedIpc
          ? 'Native dialog is loading or needs an Electron restart. Enter folder path directly:'
          : 'Enter path to local project folder:'
      );
      if (entered && entered.trim()) {
        onImportLocalProject?.(entered.trim());
      }
    } catch (err) {
      console.error('Failed to open local directory:', err);
    }
  };

  const handleFetchAndSelectCustomRepo = async (query) => {
    let raw = query.trim();
    raw = raw.replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '');
    const parts = raw.split('/').filter(Boolean);
    if (parts.length < 2) {
      alert('Please enter a valid repository format, e.g. owner/repo');
      return;
    }
    const fullName = `${parts[0]}/${parts[1]}`;
    try {
      setIsLoadingBranches(true);
      const res = await fetch(`${API_BASE_URL}/api/github/repo-info?repo=${encodeURIComponent(fullName)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `Repository "${fullName}" not found or inaccessible`);
      }
      const data = await res.json();
      handleSelectRepo(data);
      setRepoSearch('');
    } catch (err) {
      alert(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoadingBranches(false);
    }
  };

  const textareaId = useId();

  const {
    attachments,
    isDragging,
    fileInputRef,
    openFilePicker,
    removeAttachment,
    clearAttachments,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handlePaste,
    addFiles,
  } = useMediaAttachments();

  const [projects, setProjects] = useState([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [timelineSearch, setTimelineSearch] = useState('');

  // Fetch local projects
  const fetchProjects = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects`);
      if (response.ok) {
        const data = await response.json();
        setProjects(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Failed to fetch projects', err);
    } finally {
      setIsLoadingProjects(false);
    }
  };

  // Fetch GitHub connection status
  const fetchGithubStatus = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/github/status`);
      if (res.ok) {
        const data = await res.json();
        setGithubStatus(data);
        if (data.connected) {
          fetchGithubRepos();
        }
      }
    } catch (err) {
      console.error('Failed to fetch GitHub status:', err);
    }
  };

  // Fetch user's GitHub repositories
  const fetchGithubRepos = async () => {
    try {
      setIsLoadingGithubRepos(true);
      const res = await fetch(`${API_BASE_URL}/api/github/repos`);
      if (res.ok) {
        const data = await res.json();
        setGithubRepos(Array.isArray(data.repos) ? data.repos : []);
      }
    } catch (err) {
      console.error('Failed to fetch GitHub repos:', err);
    } finally {
      setIsLoadingGithubRepos(false);
    }
  };
  // Fetch branches when selected repo changes
  useEffect(() => {
    if (!selectedRepo) {
      setRepoBranches([]);
      setSelectedBranch('main');
      return;
    }

    const defaultB = selectedRepo.default_branch || 'main';
    setSelectedBranch(defaultB);
    setRepoBranches([defaultB]);

    let isMounted = true;
    setIsLoadingBranches(true);
    fetch(`${API_BASE_URL}/api/github/repo-branches?repo=${encodeURIComponent(selectedRepo.full_name)}`)
      .then((res) => (res.ok ? res.json() : { branches: [defaultB] }))
      .then((data) => {
        if (!isMounted) return;
        const list = Array.isArray(data.branches) && data.branches.length > 0
          ? data.branches
          : [defaultB];
        setRepoBranches(list);
        if (list.includes(defaultB)) {
          setSelectedBranch(defaultB);
        } else {
          setSelectedBranch(list[0]);
        }
      })
      .catch((err) => {
        console.warn('Failed to load branches:', err);
      })
      .finally(() => {
        if (isMounted) setIsLoadingBranches(false);
      });

    return () => {
      isMounted = false;
    };
  }, [selectedRepo]);


  useEffect(() => {
    fetchProjects();
    fetchGithubStatus();
  }, []);

  const filteredProjects = useMemo(() => {
    if (!timelineSearch.trim()) return projects;
    const q = timelineSearch.toLowerCase().trim();
    return projects.filter((p) => {
      const nameMatch = p.name?.toLowerCase().includes(q);
      const modelMatch = p.model?.toLowerCase().includes(q);
      return Boolean(nameMatch || modelMatch);
    });
  }, [projects, timelineSearch]);

  const timelineItems = useMemo(() => {
    return filteredProjects.map((p) => {
      const modelName = p.model ? p.model.split('/').pop() || 'gemini-3.8-flash' : 'gemini-3.8-flash';
      const statusLabel = p.status === 'running' && p.port ? `LIVE :${p.port}` : 'LOCAL';
      const dateLabel = p.last_opened
        ? new Date(p.last_opened).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : 'Recent';

      return {
        client: p.name,
        platform: modelName.toUpperCase(),
        services: `${statusLabel} · ${dateLabel}`,
        data: p,
      };
    });
  }, [filteredProjects]);

  // Filtered GitHub Repositories
  const filteredGithubRepos = useMemo(() => {
    let list = githubRepos;
    if (repoVisibilityFilter === 'public') {
      list = list.filter((r) => !r.private);
    } else if (repoVisibilityFilter === 'private') {
      list = list.filter((r) => r.private);
    }

    if (!repoSearch.trim()) return list;
    const q = repoSearch.toLowerCase().trim();
    return list.filter((r) => {
      const nameMatch = r.name?.toLowerCase().includes(q) || r.full_name?.toLowerCase().includes(q);
      const descMatch = r.description?.toLowerCase().includes(q);
      const langMatch = r.language?.toLowerCase().includes(q);
      return Boolean(nameMatch || descMatch || langMatch);
    });
  }, [githubRepos, repoSearch, repoVisibilityFilter]);

  const handleSelectRepo = useCallback((repo) => {
    setSelectedRepo(repo);
    setShouldForkThirdParty(true);
    // Scroll composer into view
    window.scrollTo({ top: 0, behavior: 'smooth' });
    const textarea = document.getElementById(textareaId);
    if (textarea) textarea.focus();
  }, [textareaId]);

  // Formatted GitHub Repository Items for Interactive Timeline List
  const githubRepoItems = useMemo(() => {
    return filteredGithubRepos.map((repo) => {
      const isSelected = selectedRepo?.full_name === repo.full_name;
      return {
        key: `repo-${repo.id || repo.full_name}`,
        client: (
          <div className="degrees-github-list-repo-title">
            {repo.private ? (
              <span className="degrees-github-list-lock" title="Private repository">
                <LockIcon />
              </span>
            ) : null}
            <span className="degrees-github-list-repo-name" title={repo.name}>
              {repo.name}
            </span>
            <span className="degrees-github-list-repo-owner" title={`/${repo.owner}`}>
              /{repo.owner}
            </span>
            <span
              className={`degrees-github-vis-badge ${
                repo.private ? 'degrees-github-vis-badge--private' : ''
              }`}
            >
              {repo.private ? 'Private' : 'Public'}
            </span>
          </div>
        ),
        platform: (
          <div className="degrees-github-list-repo-meta">
            {repo.language && (
              <span className="degrees-github-lang">
                <span className="degrees-github-lang-dot" />
                {repo.language}
              </span>
            )}
            {repo.stargazers_count > 0 && (
              <span className="degrees-github-stars">
                <StarIcon /> {repo.stargazers_count}
              </span>
            )}
            <span className="degrees-github-branch">
              <BranchIcon /> {repo.default_branch || 'main'}
            </span>
          </div>
        ),
        services: (
          <span
            className="degrees-github-list-repo-desc"
            title={repo.description || 'No description provided'}
          >
            {repo.description || 'No description provided'}
          </span>
        ),
        actions: (
          <button
            type="button"
            className={`degrees-repo-select-btn ${
              isSelected ? 'degrees-repo-select-btn--active' : ''
            }`}
            onClick={(e) => {
              e.stopPropagation();
              handleSelectRepo(repo);
            }}
          >
            {isSelected ? 'Target Active' : 'Select & Build'}
          </button>
        ),
        selected: isSelected,
        data: repo,
      };
    });
  }, [filteredGithubRepos, selectedRepo, handleSelectRepo]);

  const currentModelObj = models.find(
    (m) => m.id === selectedModel || m.canonical_id === selectedModel
  ) || (selectedModel ? { name: selectedModel, compatibility_label: 'Optimal' } : null);

  const handleDeleteProject = async (arg1, arg2) => {
    const e = (arg1 && typeof arg1 === 'object' && 'stopPropagation' in arg1) ? arg1 : ((arg2 && typeof arg2 === 'object' && 'stopPropagation' in arg2) ? arg2 : null);
    const name = typeof arg1 === 'string' ? arg1 : (typeof arg2 === 'string' ? arg2 : '');
    if (e) e.stopPropagation();
    if (!name) return;
    if (!window.confirm(`Delete project "${name}"? This removes its files.`)) return;
    try {
      await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(name)}`, { method: 'DELETE' });
      onDeleteProject?.(name);
      fetchProjects();
    } catch (err) {
      console.error('Failed to delete project', err);
    }
  };

  const handleOpenInFinder = async (arg1, arg2) => {
    const e = (arg1 && typeof arg1 === 'object' && 'stopPropagation' in arg1) ? arg1 : ((arg2 && typeof arg2 === 'object' && 'stopPropagation' in arg2) ? arg2 : null);
    const name = typeof arg1 === 'string' ? arg1 : (typeof arg2 === 'string' ? arg2 : '');
    if (e) e.stopPropagation();
    if (!name) return;
    try {
      await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(name)}/open-in-finder`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to open project in finder', err);
    }
  };

  // Submit Handler: routes to selected repo build or standard project creation
  const handleInitialSubmit = async (e) => {
    e.preventDefault();
    const value = prompt.trim();
    if (!value && attachments.length === 0 && !selectedRepo) return;

    // Guard: ensure the user has configured at least one authenticated model
    const hasAnyAuth = models.some((m) => Boolean(m.has_auth || m.installed));
    if (!hasAnyAuth) {
      setIsModelSelectorOpen(true);
      return;
    }
    // Case 1: Building on a selected GitHub repository
    if (selectedRepo) {
      const images = attachments
        .filter((a) => a.type === 'image')
        .map((a) => ({ data: a.data || a.base64, mimeType: a.mimeType, name: a.name }));
      const videos = attachments
        .filter((a) => a.type === 'video')
        .map((a) => ({
          name: a.name,
          data: a.data || a.base64,
          mimeType: a.mimeType,
          size: a.size,
          thumbnailUrl: a.thumbnailUrl,
        }));
      const files = attachments
        .filter((a) => a.type === 'file')
        .map((a) => ({ name: a.name, data: a.data, content: a.content, size: a.size, mimeType: a.mimeType }));
      if (onConnectAndBuild) {
        onConnectAndBuild(
          selectedRepo,
          prompt.trim(),
          { images, videos, files },
          selectedBranch,
          welcomeMode,
          { fork: isThirdPartyRepo && shouldForkThirdParty }
        );
      } else {
        onSubmit(prompt.trim(), selectedRepo.name, { images, files }, welcomeMode);
      }
      clearAttachments();
      return;
    }

    // Case 2: Standard scratch project creation
    setIsNaming(true);
    setIsGeneratingName(true);

    try {
      const baseWord = value ? value.split(' ').slice(0, 4).join('-') : 'app';
      const response = await fetch(
        `${API_BASE_URL}/api/projects/suggest-name?base=${encodeURIComponent(baseWord)}`
      );
      if (response.ok) {
        const data = await response.json();
        setProjectName(data.suggested_name || 'app');
      } else {
        setProjectName('app');
      }
    } catch (err) {
      console.error('Failed to get suggested name', err);
      setProjectName('app');
    } finally {
      setIsGeneratingName(false);
    }
  };

  const handleFinalSubmit = (e) => {
    e.preventDefault();
    if (!projectName.trim()) return;

    const images = attachments
      .filter((a) => a.type === 'image')
      .map((a) => ({ data: a.data || a.base64, mimeType: a.mimeType, name: a.name }));
    const videos = attachments
      .filter((a) => a.type === 'video')
      .map((a) => ({
        name: a.name,
        data: a.data || a.base64,
        mimeType: a.mimeType,
        size: a.size,
        thumbnailUrl: a.thumbnailUrl,
      }));
    const files = attachments
      .filter((a) => a.type === 'file')
      .map((a) => ({ name: a.name, data: a.data, content: a.content, size: a.size, mimeType: a.mimeType }));
    onSubmit(prompt, projectName.trim(), { images, videos, files }, welcomeMode);
    clearAttachments();
  };


  const exiting = isExiting || isTransitioning;

  return (
    <div className={`degrees-welcome ${exiting ? 'degrees-welcome--exiting' : ''} ${isNaming ? 'degrees-welcome--naming' : ''}`}>
      {!isNaming ? (
        <>
          {/* Left 30%: ASCII Art Panel */}
          <aside className="degrees-welcome__left" aria-label="Visual Art">
            <div className="degrees-welcome__ascii-frame">
              <AsciiEffect
                variant="flow"
                imageSrc="./images/pisa.jpg"
                fontSize={7}
                flowSpeed={0.22}
                flowStrength={12}
                mouseRadius={180}
                mouseStrength={32}
                mouseWaveSpeed={2.6}
                mouseEasing={1.0}
                paused={isAnyModalOpen}
              />
            </div>
          </aside>

          {/* Right 55%: Main Welcome Content */}
          <main className="degrees-welcome__right">
            <div className="degrees-welcome__right-bg" aria-hidden="true">
              <GrainGradient
                colorLight="#fed7aa"
                colorMid="#ea580c"
                colorDark="#080402"
                angle={180}
                position={0}
                curve={0.48}
                softness={0.13}
                scale={1}
                grain={0.32}
                grainSize={1}
                seed={1}
                speed={isAnyModalOpen ? 0 : 0.8}
                className="h-full w-full"
              />
            </div>
            <div className="degrees-welcome__right-inner">
              {/* Top Bar with GitHub Connect & Model Auth */}
              <div className="degrees-welcome__top-bar">
                <button
                  type="button"
                  className="degrees-open-folder-btn"
                  onClick={handleOpenFolder}
                  title="Open an existing local project folder or cloned repository on your computer"
                >
                  <FolderIcon size={13} />
                  <span>Open Folder</span>
                </button>
                {githubStatus?.connected && githubStatus?.user ? (
                  <button
                    type="button"
                    className="degrees-github-pill"
                    onClick={() => setIsGitHubConnectModalOpen(true)}
                    title={`Connected as @${githubStatus.user.login} — Click to manage`}
                  >
                    <img
                      src={githubStatus.user.avatar_url}
                      alt={githubStatus.user.login}
                      className="degrees-github-avatar"
                    />
                    <span className="degrees-github-login">@{githubStatus.user.login}</span>
                    <span className="degrees-github-dot" />
                  </button>
                ) : (
                  <button
                    type="button"
                    className="degrees-github-connect-btn"
                    onClick={() => setIsGitHubConnectModalOpen(true)}
                    title="Connect GitHub account"
                  >
                    <GitHubIcon size={14} />
                    <span>Connect GitHub</span>
                  </button>
                )}
              </div>
            <header className="degrees-welcome__header">
              <div className="degrees-logo-container">
                <img
                  src="./logo-white.png"
                  alt="crbn"
                  className="degrees-logo-img"
                />
              </div>

              <p className="degrees-welcome__subtitle">
                A creative studio for full-stack software. Describe your concept or connect any GitHub repo; we'll compose, build, and run it.
              </p>
            </header>

            {/* Direction banner for users without an API key OR newly connected status */}
            {justConnectedProvider ? (
              <div
                className="degrees-welcome__oauth-direction degrees-welcome__oauth-direction--connected"
                title={`Connected to ${justConnectedProvider.name || justConnectedProvider.id}`}
              >
                <div className="degrees-welcome__oauth-direction-left">
                  <span className="degrees-welcome__oauth-connected-dot" />
                  <span className="degrees-welcome__oauth-text">
                    Connected to <strong style={{ color: '#ffffff', fontWeight: 600 }}>{justConnectedProvider.name || justConnectedProvider.id}</strong>
                  </span>
                </div>
                <span className="degrees-welcome__oauth-badge-btn degrees-welcome__oauth-badge-btn--connected">
                  <span>Connected</span>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ display: 'inline-block', marginLeft: 4, verticalAlign: '-1px' }}>
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              </div>
            ) : !hasAnyConfiguredAuth ? (
              <div
                className="degrees-welcome__oauth-direction"
                onClick={() => setIsConnectModalOpen(true)}
                title="Connect Claude, ChatGPT, Copilot and more"
              >
                <div className="degrees-welcome__oauth-direction-left">
                  <span className="degrees-welcome__oauth-text">
                    No API key? No problem — connect Claude, ChatGPT, Copilot and more
                  </span>
                </div>
                <span className="degrees-welcome__oauth-badge-btn">Connect account →</span>
              </div>
            ) : null}

            {/* Main Creative Input Box (Timeline Composer) */}
            <form
              className="degrees-welcome__form"
              onSubmit={handleInitialSubmit}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onPaste={handlePaste}
            >
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept="image/*,video/*,.mp4,.webm,.mov,.mkv,.avi,.m4v,.pdf,.txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.py,.html,.css"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files) addFiles(Array.from(e.target.files));
                }}
              />

              <div
                className={`degrees-composer ${
                  isDragging ? 'degrees-composer--dragging' : ''
                } ${selectedRepo ? 'degrees-composer--has-target' : ''}`}
              >
                {/* Selected GitHub Repo Target Ribbon */}
                {selectedRepo && (
                  <div className="degrees-composer__target-ribbon">
                    <div className="degrees-composer__target-left">
                      <span className="degrees-composer__target-badge">
                        <GitHubIcon size={12} />
                        <span>Target Repo</span>
                      </span>
                      <span className="degrees-composer__target-name" title={selectedRepo.full_name}>
                        {selectedRepo.full_name}
                      </span>
                      <div className="degrees-composer__target-branch-wrap" title="Select branch to build on">
                        <BranchIcon />
                        {isLoadingBranches ? (
                          <span className="degrees-composer__target-branch-loading">...</span>
                        ) : repoBranches.length > 1 ? (
                          <select
                            className="degrees-composer__target-branch-select"
                            value={selectedBranch}
                            onChange={(e) => setSelectedBranch(e.target.value)}
                          >
                            {repoBranches.map((b) => (
                              <option key={b} value={b}>
                                {b}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="degrees-composer__target-branch-text">{selectedBranch}</span>
                        )}
                      </div>
                      <span
                        className={`degrees-composer__target-vis ${
                          selectedRepo.private ? 'degrees-composer__target-vis--private' : ''
                        }`}
                      >
                        {selectedRepo.private ? 'Private' : 'Public'}
                      </span>
                      {isThirdPartyRepo && (
                        <div className="degrees-composer__fork-toggle-wrap">
                          <button
                            type="button"
                            className={`degrees-composer__fork-chip ${shouldForkThirdParty ? 'degrees-composer__fork-chip--active' : ''}`}
                            onClick={() => setShouldForkThirdParty(true)}
                            title={`Fork to @${githubStatus?.user?.login || 'account'} so you can push commits and create PRs`}
                          >
                            <ForkIcon size={10} />
                            <span>Fork to @{githubStatus?.user?.login || 'account'}</span>
                          </button>
                          <button
                            type="button"
                            className={`degrees-composer__fork-chip ${!shouldForkThirdParty ? 'degrees-composer__fork-chip--active' : ''}`}
                            onClick={() => setShouldForkThirdParty(false)}
                            title="Clone detached (read-only origin). You can publish as a new repository later."
                          >
                            <span>Clone detached</span>
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      type="button"
                      className="degrees-composer__deselect-btn"
                      onClick={() => setSelectedRepo(null)}
                      title="Deselect repository (build new from scratch)"
                      aria-label="Clear target repository"
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                      </svg>
                      <span>Clear target</span>
                    </button>
                  </div>
                )}

                {/* Uploaded Attachments Preview */}
                {attachments && attachments.length > 0 && (
                  <div className="degrees-composer__attachments">
                    <AttachmentRibbon attachments={attachments} onRemove={removeAttachment} />
                  </div>
                )}

                <textarea
                  id={textareaId}
                  className="degrees-composer__textarea"
                  placeholder={
                    selectedRepo
                      ? `What would you like to build or change in ${selectedRepo.name}? Describe changes, features, or fixes...`
                      : welcomeMode === 'plan'
                      ? "Describe what you'd like to plan (working tree will be read-only)..."
                      : "Describe an application, interface, or creative tool you'd like to build..."
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleInitialSubmit(e);
                    }
                  }}
                  autoFocus
                  spellCheck={false}
                  rows={3}
                />

                {/* Bottom Action Ribbon */}
                <div className="degrees-composer__toolbar">
                  <div className="degrees-composer__toolbar-left">
                    <button
                      type="button"
                      className="degrees-toolbar-btn"
                      onClick={openFilePicker}
                      title="Attach media, mockups, or source files"
                      aria-label="Attach files"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                      </svg>
                    </button>

                    <button
                      type="button"
                      className="degrees-model-pill"
                      onClick={() => setIsModelSelectorOpen(true)}
                      title="Select foundation model"
                    >
                      <span className="degrees-model-pill__icon">✦</span>
                      <span className="degrees-model-pill__name">
                        {currentModelObj?.name || selectedModel || 'Select a model...'}
                      </span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </button>

                    <button
                      type="button"
                      className={`degrees-mcp-btn ${mcpCount > 0 ? 'degrees-mcp-btn--active' : ''}`}
                      onClick={() => setIsMcpModalOpen(true)}
                      title="Connect Model Context Protocol (MCP) servers"
                      aria-label="Connect MCP servers"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22v-5"/>
                        <path d="M9 8V2"/>
                        <path d="M15 8V2"/>
                        <path d="M18 8v5a6 6 0 0 1-12 0V8z"/>
                      </svg>
                      <span>MCP</span>
                      {mcpCount > 0 && (
                        <span className="degrees-mcp-badge">{mcpCount}</span>
                      )}
                    </button>

                    <button
                      type="button"
                      className={`degrees-plugin-btn ${pluginsCount > 0 ? 'degrees-plugin-btn--active' : ''}`}
                      onClick={() => setIsPluginsModalOpen(true)}
                      title="Manage Extensions & Plugins"
                      aria-label="Manage Extensions & Plugins"
                    >
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                        <line x1="7" y1="7" x2="7.01" y2="7"/>
                      </svg>
                      <span>Plugins</span>
                      {pluginsCount > 0 && (
                        <span className="degrees-plugin-badge">{pluginsCount}</span>
                      )}
                    </button>

                    <div className="degrees-mode-segmented" role="radiogroup" aria-label="Mode">
                      <button
                        type="button"
                        className={`degrees-mode-seg-btn ${welcomeMode === 'build' ? 'degrees-mode-seg-btn--active' : ''}`}
                        onClick={() => setWelcomeMode('build')}
                        title="Build Mode: Agent directly edits and creates files"
                        aria-checked={welcomeMode === 'build'}
                        role="radio"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
                        </svg>
                        <span>Build</span>
                      </button>
                      <button
                        type="button"
                        className={`degrees-mode-seg-btn ${welcomeMode === 'plan' ? 'degrees-mode-seg-btn--active-plan' : ''}`}
                        onClick={() => setWelcomeMode('plan')}
                        title="Plan Mode: Working tree is read-only. Agent explores and designs an execution plan"
                        aria-checked={welcomeMode === 'plan'}
                        role="radio"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                        </svg>
                        <span>Plan</span>
                      </button>
                    </div>
                  </div>

                  <div className="degrees-composer__toolbar-right">
                    <button
                      type="submit"
                      className="degrees-cta-btn"
                      disabled={!prompt.trim() && attachments.length === 0 && !selectedRepo}
                    >
                      <span>{selectedRepo ? 'Build on repo' : (welcomeMode === 'plan' ? 'Start planning' : 'Start building')}</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </form>

            {/* Segmented Section: Recent Timelines vs GitHub Repositories */}
            <section className="degrees-timelines">
              <div className="degrees-timelines__header">
                {/* Segmented Switcher */}
                <div className="degrees-welcome-nav-tabs">
                  <button
                    type="button"
                    className={`degrees-welcome-nav-tab ${
                      activeWelcomeTab === 'timelines' ? 'degrees-welcome-nav-tab--active' : ''
                    }`}
                    onClick={() => setActiveWelcomeTab('timelines')}
                  >
                    <span>Recent Timelines</span>
                    {projects.length > 0 && (
                      <span className="degrees-welcome-tab-badge">{projects.length}</span>
                    )}
                  </button>

                  <button
                    type="button"
                    className={`degrees-welcome-nav-tab ${
                      activeWelcomeTab === 'github' ? 'degrees-welcome-nav-tab--active' : ''
                    }`}
                    onClick={() => {
                      setActiveWelcomeTab('github');
                      if (!githubStatus?.connected) {
                        setIsGitHubConnectModalOpen(true);
                      } else if (githubRepos.length === 0) {
                        fetchGithubRepos();
                      }
                    }}
                  >
                    <GitHubIcon size={13} />
                    <span>GitHub Repositories</span>
                    {githubStatus?.connected && githubRepos.length > 0 && (
                      <span className="degrees-welcome-tab-badge">{githubRepos.length}</span>
                    )}
                  </button>
                </div>

                {/* Search Bar on Right */}
                <div className="degrees-timelines__header-right">
                  {activeWelcomeTab === 'timelines' ? (
                    <div className="degrees-timelines__search-box">
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="degrees-timelines__search-icon"
                      >
                        <circle cx="11" cy="11" r="8"></circle>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                      </svg>
                      <input
                        type="text"
                        className="degrees-timelines__search-input"
                        placeholder="Search timelines..."
                        value={timelineSearch}
                        onChange={(e) => setTimelineSearch(e.target.value)}
                        spellCheck={false}
                      />
                      {timelineSearch && (
                        <button
                          type="button"
                          className="degrees-timelines__search-clear"
                          onClick={() => setTimelineSearch('')}
                          title="Clear search"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="degrees-github-search-group">
                      {/* Visibility Filters */}
                      <div className="degrees-github-filters">
                        <button
                          type="button"
                          className={`degrees-filter-chip ${
                            repoVisibilityFilter === 'all' ? 'degrees-filter-chip--active' : ''
                          }`}
                          onClick={() => setRepoVisibilityFilter('all')}
                        >
                          All
                        </button>
                        <button
                          type="button"
                          className={`degrees-filter-chip ${
                            repoVisibilityFilter === 'public' ? 'degrees-filter-chip--active' : ''
                          }`}
                          onClick={() => setRepoVisibilityFilter('public')}
                        >
                          Public
                        </button>
                        <button
                          type="button"
                          className={`degrees-filter-chip ${
                            repoVisibilityFilter === 'private' ? 'degrees-filter-chip--active' : ''
                          }`}
                          onClick={() => setRepoVisibilityFilter('private')}
                        >
                          Private
                        </button>
                      </div>

                      <div className="degrees-timelines__search-box">
                        <input
                          type="text"
                          className="degrees-timelines__search-input"
                          placeholder="Filter repositories..."
                          value={repoSearch}
                          onChange={(e) => setRepoSearch(e.target.value)}
                          spellCheck={false}
                        />
                        {repoSearch && (
                          <button
                            type="button"
                            className="degrees-timelines__search-clear"
                            onClick={() => setRepoSearch('')}
                            title="Clear search"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* TAB 1: Recent Timelines View */}
              {activeWelcomeTab === 'timelines' ? (
                isLoadingProjects ? (
                  <div className="degrees-timelines__loading">
                    <div className="degrees-spinner" />
                    <span>Loading workspaces...</span>
                  </div>
                ) : filteredProjects.length > 0 ? (
                  <div className="degrees-timelines__interactive-wrap">
                    <InteractiveListPreview
                      items={timelineItems}
                      onItemClick={(item) => onOpenProject(item.data || item)}
                      onOpenFinder={handleOpenInFinder}
                      onDeleteProject={handleDeleteProject}
                    />
                  </div>
                ) : (
                  <div className="degrees-timelines__empty">
                    {timelineSearch.trim() ? (
                      <div className="degrees-timelines__empty-search">
                        <span>No workspaces matching &ldquo;{timelineSearch}&rdquo;</span>
                        <button
                          type="button"
                          className="degrees-timelines__clear-btn"
                          onClick={() => setTimelineSearch('')}
                        >
                          Clear search
                        </button>
                      </div>
                    ) : (
                      <p>No workspaces created yet. Enter an idea above or connect a GitHub repository to start building.</p>
                    )}
                  </div>
                )
              ) : (
                /* TAB 2: GitHub Repositories View */
                !githubStatus?.connected ? (
                  <div className="degrees-github-connect-cta">
                    <div className="degrees-github-cta-icon">
                      <GitHubIcon size={32} />
                    </div>
                    <h3 className="degrees-github-cta-title">Connect your GitHub account</h3>
                    <p className="degrees-github-cta-desc">
                      Link GitHub to see all your public and private repositories, start building directly on existing codebases, and push commits seamlessly.
                    </p>
                    <button
                      type="button"
                      className="degrees-github-cta-btn"
                      onClick={() => setIsGitHubConnectModalOpen(true)}
                    >
                      <GitHubIcon size={16} />
                      <span>Connect GitHub Account</span>
                    </button>
                  </div>
                ) : isLoadingGithubRepos ? (
                  <div className="degrees-timelines__loading">
                    <div className="degrees-spinner" />
                    <span>Loading your repositories from GitHub...</span>
                  </div>
                ) : filteredGithubRepos.length > 0 ? (
                  <div className="degrees-timelines__interactive-wrap">
                    {isCustomRepoQuery && (
                      <div className="degrees-github-custom-clone-card">
                        <div className="degrees-github-custom-clone-left">
                          <span className="degrees-github-custom-clone-badge">Custom Repo</span>
                          <span className="degrees-github-custom-clone-name">
                            {repoSearch.trim().replace(/^https?:\/\/github\.com\//, '')}
                          </span>
                          <span className="degrees-github-custom-clone-hint">Clone any public GitHub repository</span>
                        </div>
                        <button
                          type="button"
                          className="degrees-repo-select-btn degrees-repo-select-btn--active"
                          onClick={() => handleFetchAndSelectCustomRepo(repoSearch)}
                        >
                          Clone & Build
                        </button>
                      </div>
                    )}
                    <InteractiveListPreview
                      items={githubRepoItems}
                      colWidths={['32%', '22%', '26%', '20%']}
                      onItemClick={(item) => handleSelectRepo(item.data || item)}
                    />
                  </div>
                ) : (
                  <div className="degrees-timelines__empty">
                    {repoSearch.trim() ? (
                      <div className="degrees-timelines__empty-search">
                        <span>No connected repositories matching &ldquo;{repoSearch}&rdquo;</span>
                        <div style={{ display: 'flex', gap: '8px', marginTop: '10px', justifyContent: 'center' }}>
                          <button
                            type="button"
                            className="degrees-repo-select-btn degrees-repo-select-btn--active"
                            onClick={() => handleFetchAndSelectCustomRepo(repoSearch)}
                          >
                            Clone &ldquo;{repoSearch.trim().replace(/^https?:\/\/github\.com\//, '')}&rdquo; from GitHub
                          </button>
                          <button
                            type="button"
                            className="degrees-timelines__clear-btn"
                            onClick={() => setRepoSearch('')}
                          >
                            Clear search
                          </button>
                        </div>
                      </div>
                    ) : (
                      <p>No repositories found matching your filter criteria.</p>
                    )}
                  </div>
                )
              )}
            </section>
            </div>
          </main>
        </>
      ) : (
          /* Naming Step */
          <div className="degrees-naming-screen">
            <div className="degrees-naming-bg" aria-hidden="true">
              <SilkAurora
                title="Maison Lumiere"
                subtitle="Private Preview"
                description="Quiet motion, warm sheen, and a velvet base for refined product launches."
                baseColor="#060505"
                midColor="#19130f"
                sheenColor="#ffe2a9"
                accentColor="#c58d5d"
                intensity={0.9}
                speed={0.75}
              />
            </div>
            <div className="degrees-naming-card">
            <div className="degrees-logo-container degrees-logo-container--naming">
              <img
                src="./logo-white.png"
                alt="crbn"
                className="degrees-logo-img degrees-logo-img--small"
              />
            </div>

            <h1 className="degrees-welcome__title">
              Name your <span className="degrees-welcome__title-serif">workspace</span>
            </h1>
            <p className="degrees-welcome__subtitle">
              Choose a directory name for your project in <code>~/.80degrees/projects</code>.
            </p>

            <form className="degrees-welcome__form degrees-naming-form" onSubmit={handleFinalSubmit}>
              <div className="degrees-naming-console">
                <div className="degrees-naming-field">
                  <span className="degrees-naming-icon">
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                    </svg>
                  </span>
                  <input
                    type="text"
                    className="degrees-naming-input"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    disabled={isGeneratingName}
                    placeholder="e.g. creative-studio"
                    autoFocus
                    spellCheck={false}
                  />
                  {isGeneratingName && (
                    <span className="degrees-naming-loading">Generating suggestion...</span>
                  )}
                </div>

                <div className="degrees-naming-actions">
                  <button
                    type="button"
                    className="degrees-btn-secondary"
                    onClick={() => setIsNaming(false)}
                  >
                    Back
                  </button>
                  <button
                    type="submit"
                    className="degrees-cta-btn"
                    disabled={isGeneratingName || !projectName.trim()}
                  >
                    <span>Create Workspace</span>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12"></line>
                      <polyline points="12 5 19 12 12 19"></polyline>
                    </svg>
                  </button>
                </div>
              </div>
            </form>
          </div>
          </div>
        )}

      {/* Model Selector Modal */}
      <ModelSelector
        isOpen={isModelSelectorOpen}
        onClose={() => setIsModelSelectorOpen(false)}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        hardwareInfo={hardwareInfo}
        models={models}
        providers={providers}
        onRefreshModels={onRefreshModels}
      />

      {/* Glassmorphic Provider Connect Modal */}
      <ProviderConnectModal
        isOpen={isConnectModalOpen}
        onClose={() => setIsConnectModalOpen(false)}
        providers={providers}
        onRefreshModels={onRefreshModels}
        variant="welcome"
        onConnected={(info) => {
          setJustConnectedProvider(info);
        }}
      />

      {/* GitHub Connect Modal */}
      <GitHubConnectModal
        isOpen={isGitHubConnectModalOpen}
        onClose={() => setIsGitHubConnectModalOpen(false)}
        onConnected={(user) => {
          setGithubStatus({ connected: true, user });
          fetchGithubRepos();
        }}
        onDisconnected={() => {
          setGithubStatus({ connected: false, user: null });
          setGithubRepos([]);
          setSelectedRepo(null);
        }}
      />

      {/* MCP Connect Modal */}
      <McpConnectModal
        isOpen={isMcpModalOpen}
        onClose={() => {
          setIsMcpModalOpen(false);
          fetchGlobalMcp();
        }}
        projectName=""
        onReloadMcp={fetchGlobalMcp}
      />

      {/* Plugins & Extensions Modal */}
      <PluginsModal
        isOpen={isPluginsModalOpen}
        onClose={() => {
          setIsPluginsModalOpen(false);
          fetchGlobalPlugins();
        }}
        projectName=""
        onReloadPlugins={fetchGlobalPlugins}
      />
    </div>
  );
}
