import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle, Description } from '@headlessui/react';
import { API_BASE_URL } from '../config';
import './PluginsModal.css';

const CATEGORY_LABELS = {
  all: 'All Plugins',
  development: 'Development',
  security: 'Security',
  productivity: 'Productivity',
  database: 'Database',
  automation: 'Automation',
  testing: 'Testing',
  design: 'Design',
  deployment: 'Deployment',
  monitoring: 'Monitoring',
};

const DEFAULT_CATEGORIES = [
  'all',
  'development',
  'security',
  'productivity',
  'database',
  'automation',
  'testing',
  'design',
  'deployment',
];

function renderCategoryIcon(category) {
  switch (category) {
    case 'all':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="7" height="7" rx="1.5"/>
          <rect x="14" y="3" width="7" height="7" rx="1.5"/>
          <rect x="14" y="14" width="7" height="7" rx="1.5"/>
          <rect x="3" y="14" width="7" height="7" rx="1.5"/>
        </svg>
      );
    case 'development':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="16 18 22 12 16 6"/>
          <polyline points="8 6 2 12 8 18"/>
        </svg>
      );
    case 'security':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        </svg>
      );
    case 'productivity':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
        </svg>
      );
    case 'database':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3"/>
          <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/>
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>
        </svg>
      );
    case 'automation':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      );
    case 'testing':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 2v7.31L4.36 19.34A2 2 0 0 0 6 22h12a2 2 0 0 0 1.64-2.66L14 9.31V2"/>
          <path d="M8.5 2h7"/>
          <path d="M14 9.3a6.5 6.5 0 1 1-4 0"/>
        </svg>
      );
    case 'design':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <path d="m4.93 4.93 4.24 4.24"/>
          <path d="m14.83 9.17 4.24-4.24"/>
          <path d="m14.83 14.83 4.24 4.24"/>
          <path d="m9.17 14.83-4.24 4.24"/>
          <circle cx="12" cy="12" r="4"/>
        </svg>
      );
    case 'deployment':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <line x1="16.5" y1="9.4" x2="7.5" y2="4.21"/>
          <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
          <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
          <line x1="12" y1="22.08" x2="12" y2="12"/>
        </svg>
      );
    case 'monitoring':
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
        </svg>
      );
    default:
      return (
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
          <line x1="7" y1="7" x2="7.01" y2="7"/>
        </svg>
      );
  }
}
export default function PluginsModal({
  isOpen,
  onClose,
  projectName = null,
  onReloadPlugins = null,
}) {
  const [activeTab, setActiveTab] = useState('installed'); // 'installed' | 'discover' | 'custom'
  const [installedPlugins, setInstalledPlugins] = useState([]);
  const [discoverPlugins, setDiscoverPlugins] = useState([]);
  const [marketplaces, setMarketplaces] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');

  const [isLoading, setIsLoading] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const [actionLoading, setActionLoading] = useState({});
  const [errorMsg, setErrorMsg] = useState(null);
  const [successMsg, setSuccessMsg] = useState(null);
  const [gitInstalled, setGitInstalled] = useState(true);
  const [gitStatus, setGitStatus] = useState({ installed: true });
  const [gitInstalling, setGitInstalling] = useState(false);
  const gitPollIntervalRef = useRef(null);

  const checkGitStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/system/git-status`);
      if (res.ok) {
        const data = await res.json();
        setGitStatus(data);
        setGitInstalled(data.installed !== false);
        if (data.installed && gitPollIntervalRef.current) {
          clearInterval(gitPollIntervalRef.current);
          gitPollIntervalRef.current = null;
          setGitInstalling(false);
          setSuccessMsg(`Git is ready (${data.version || 'installed'}).`);
        }
      }
    } catch {}
  }, []);

  const handleInstallGit = async () => {
    try {
      setGitInstalling(true);
      setErrorMsg(null);
      const res = await fetch(`${API_BASE_URL}/api/system/install-git`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (data.installed) {
        setGitInstalled(true);
        setGitInstalling(false);
        setSuccessMsg(`Git is already installed (${data.version || ''}).`);
        return;
      }
      setSuccessMsg(data.message || 'Setting up Git automatically in the background...');
      clearInterval(gitPollIntervalRef.current);
      gitPollIntervalRef.current = setInterval(checkGitStatus, 1500);
      await checkGitStatus();
    } catch (err) {
      setGitInstalling(false);
      setErrorMsg(`Failed to trigger Git installer: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  useEffect(() => {
    return () => {
      clearInterval(gitPollIntervalRef.current);
    };
  }, []);

  // Custom install inputs
  const [customSpec, setCustomSpec] = useState('');
  const [customType, setCustomType] = useState('marketplace');
  const [customScope, setCustomScope] = useState('project');
  const [newMarketplaceSource, setNewMarketplaceSource] = useState('');

  const categoriesRef = useRef(null);
  const [isCategoryScrolling, setIsCategoryScrolling] = useState(false);
  const categoryScrollTimeoutRef = useRef(null);

  const handleCategoryScroll = useCallback(() => {
    setIsCategoryScrolling(true);
    clearTimeout(categoryScrollTimeoutRef.current);
    categoryScrollTimeoutRef.current = setTimeout(() => {
      setIsCategoryScrolling(false);
    }, 600);
  }, []);

  useEffect(() => {
    const el = categoriesRef.current;
    if (!el) return;

    const onWheel = (e) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollLeft += e.deltaY;
      }
      handleCategoryScroll();
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [activeTab, handleCategoryScroll]);

  const effectiveProject = projectName || '_global';
  const isGlobalScope = effectiveProject === '_global';

  // 1. Fetch installed plugins
  const fetchInstalledPlugins = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/plugins`);
      if (res.ok) {
        const data = await res.json();
        setInstalledPlugins(Array.isArray(data.plugins) ? data.plugins : []);
      }
    } catch (err) {
      console.warn('[PluginsModal] Failed to fetch installed plugins:', err);
    }
  }, [effectiveProject]);

  // 2. Fetch marketplace discover plugins
  const fetchDiscoverPlugins = useCallback(async () => {
    try {
      const url = effectiveProject
        ? `${API_BASE_URL}/api/marketplaces/discover?project=${encodeURIComponent(effectiveProject)}`
        : `${API_BASE_URL}/api/marketplaces/discover`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        setDiscoverPlugins(Array.isArray(data.plugins) ? data.plugins : []);
      }
    } catch (err) {
      console.warn('[PluginsModal] Failed to fetch discover plugins:', err);
    }
  }, [effectiveProject]);

  // 3. Fetch marketplaces
  const fetchMarketplaces = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/marketplaces`);
      if (res.ok) {
        const data = await res.json();
        setMarketplaces(Array.isArray(data.marketplaces) ? data.marketplaces : []);
      }
    } catch (err) {
      console.warn('[PluginsModal] Failed to fetch marketplaces:', err);
    }
  }, []);

  // Initial load
  useEffect(() => {
    if (!isOpen) return;
    setIsLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    Promise.all([fetchInstalledPlugins(), fetchDiscoverPlugins(), fetchMarketplaces(), checkGitStatus()])
      .catch((err) => setErrorMsg(String(err)))
      .finally(() => setIsLoading(false));
  }, [isOpen, fetchInstalledPlugins, fetchDiscoverPlugins, fetchMarketplaces, checkGitStatus]);

  // Auto-dismiss success message
  useEffect(() => {
    if (!successMsg) return;
    const timer = setTimeout(() => setSuccessMsg(null), 3000);
    return () => clearTimeout(timer);
  }, [successMsg]);

  // Handle hot-reload
  const handleReload = async () => {
    setIsReloading(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/plugins/reload`, {
        method: 'POST',
      });
      if (onReloadPlugins) {
        onReloadPlugins();
      }
      await Promise.all([fetchInstalledPlugins(), fetchDiscoverPlugins()]);
      setSuccessMsg('Plugins reloaded successfully');
    } catch (err) {
      setErrorMsg(`Failed to reload plugins: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsReloading(false);
    }
  };

  // Toggle enabled/disabled
  const handleToggle = async (plugin) => {
    const nextEnabled = !plugin.enabled;
    setActionLoading((prev) => ({ ...prev, [plugin.id]: true }));
    setErrorMsg(null);

    // Optimistic local update
    setInstalledPlugins((prev) =>
      prev.map((p) => (p.id === plugin.id ? { ...p, enabled: nextEnabled } : p))
    );

    try {
      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/plugins/${encodeURIComponent(plugin.id)}/toggle`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled: nextEnabled, scope: plugin.scope }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to toggle plugin');
      }
      if (onReloadPlugins) onReloadPlugins();
      setSuccessMsg(`${plugin.name} ${nextEnabled ? 'enabled' : 'disabled'}`);
    } catch (err) {
      // Revert on error
      setInstalledPlugins((prev) =>
        prev.map((p) => (p.id === plugin.id ? { ...p, enabled: !nextEnabled } : p))
      );
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading((prev) => ({ ...prev, [plugin.id]: false }));
    }
  };

  // Uninstall plugin
  const handleUninstall = async (plugin) => {
    if (!confirm(`Are you sure you want to uninstall ${plugin.name}?`)) return;
    setActionLoading((prev) => ({ ...prev, [plugin.id]: true }));
    setErrorMsg(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/plugins/${encodeURIComponent(plugin.id)}?scope=${encodeURIComponent(plugin.scope)}`,
        { method: 'DELETE' }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to uninstall plugin');
      }
      setInstalledPlugins((prev) => prev.filter((p) => p.id !== plugin.id));
      setDiscoverPlugins((prev) =>
        prev.map((p) =>
          p.id === plugin.id || p.name === plugin.name
            ? { ...p, installed: false, installedScope: undefined }
            : p
        )
      );
      await fetchDiscoverPlugins();
      if (onReloadPlugins) onReloadPlugins();
      setSuccessMsg(`Uninstalled ${plugin.name}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading((prev) => ({ ...prev, [plugin.id]: false }));
    }
  };

  // Upgrade plugin
  const handleUpgrade = async (plugin) => {
    setActionLoading((prev) => ({ ...prev, [plugin.id]: true }));
    setErrorMsg(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/plugins/${encodeURIComponent(plugin.id)}/upgrade`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scope: plugin.scope }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to upgrade plugin');
      }
      await fetchInstalledPlugins();
      if (onReloadPlugins) onReloadPlugins();
      setSuccessMsg(`Upgraded ${plugin.name}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading((prev) => ({ ...prev, [plugin.id]: false }));
    }
  };

  // Install from Discover card
  const handleInstallFromDiscover = async (item, targetScope = 'project') => {
    const key = `${item.id}:${targetScope}`;
    setActionLoading((prev) => ({ ...prev, [key]: true }));
    setErrorMsg(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/plugins/install`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spec: item.id,
            type: 'marketplace',
            scope: targetScope,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Installation failed');
      }
      setInstalledPlugins((prev) => [
        ...prev.filter((p) => p.id !== item.id && p.name !== item.name),
        {
          id: item.id,
          name: item.name,
          version: item.version || '0.0.0',
          marketplace: item.marketplace,
          scope: targetScope,
          enabled: true,
        },
      ]);
      setDiscoverPlugins((prev) =>
        prev.map((p) =>
          p.id === item.id || p.name === item.name
            ? { ...p, installed: true, installedScope: targetScope }
            : p
        )
      );
      await Promise.all([fetchInstalledPlugins(), fetchDiscoverPlugins()]);
      if (onReloadPlugins) onReloadPlugins();
      setSuccessMsg(`Installed ${item.name}`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading((prev) => ({ ...prev, [key]: false }));
    }
  };

  // Custom install submit
  const handleCustomInstall = async (e) => {
    e.preventDefault();
    if (!customSpec.trim()) return;
    setActionLoading((prev) => ({ ...prev, custom: true }));
    setErrorMsg(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}/api/projects/${encodeURIComponent(effectiveProject)}/plugins/install`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spec: customSpec.trim(),
            type: customType,
            scope: customScope,
          }),
        }
      );
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Installation failed');
      }
      setCustomSpec('');
      setActiveTab('installed');
      await Promise.all([fetchInstalledPlugins(), fetchDiscoverPlugins()]);
      if (onReloadPlugins) onReloadPlugins();
      setSuccessMsg('Plugin installed successfully');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading((prev) => ({ ...prev, custom: false }));
    }
  };

  // Add marketplace source submit
  const handleAddMarketplace = async (e) => {
    e.preventDefault();
    if (!newMarketplaceSource.trim()) return;
    setActionLoading((prev) => ({ ...prev, addMkt: true }));
    setErrorMsg(null);
    try {
      const res = await fetch(`${API_BASE_URL}/api/marketplaces`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: newMarketplaceSource.trim() }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || 'Failed to add marketplace');
      }
      setNewMarketplaceSource('');
      await Promise.all([fetchMarketplaces(), fetchDiscoverPlugins()]);
      setSuccessMsg('Marketplace catalog added successfully');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setActionLoading((prev) => ({ ...prev, addMkt: false }));
    }
  };

  // Filtered lists
  const installedLookup = useMemo(() => {
    const map = new Map();
    for (const p of installedPlugins) {
      if (p.id) map.set(p.id, p);
      if (p.name) map.set(p.name, p);
      if (p.name && p.marketplace) map.set(`${p.name}@${p.marketplace}`, p);
    }
    return map;
  }, [installedPlugins]);

  const filteredInstalled = useMemo(() => {
    if (!searchQuery.trim()) return installedPlugins;
    const q = searchQuery.toLowerCase();
    return installedPlugins.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q) ||
        (p.description && p.description.toLowerCase().includes(q))
    );
  }, [installedPlugins, searchQuery]);

  const categories = useMemo(() => {
    const set = new Set(DEFAULT_CATEGORIES);
    for (const p of discoverPlugins) {
      if (p.category) set.add(p.category.toLowerCase());
    }
    return Array.from(set);
  }, [discoverPlugins]);

  const filteredDiscover = useMemo(() => {
    return discoverPlugins.filter((p) => {
      const matchesSearch =
        !searchQuery.trim() ||
        p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        p.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (p.description && p.description.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchesCat =
        categoryFilter === 'all' ||
        (p.category && p.category.toLowerCase() === categoryFilter);

      return matchesSearch && matchesCat;
    });
  }, [discoverPlugins, searchQuery, categoryFilter]);

  return (
    <Dialog open={Boolean(isOpen)} onClose={onClose} className="plugins-dialog-root">
      <DialogBackdrop transition className="plugins-dialog-backdrop" />

      <div className="plugins-dialog-wrap">
        <DialogPanel transition className="plugins-dialog-panel">
          {/* Header */}
          <div className="plugins-dialog-header">
            <div className="plugins-dialog-header-left">
              <div className="plugins-dialog-header-icon">
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
                  <line x1="7" y1="7" x2="7.01" y2="7"/>
                </svg>
              </div>
              <div>
                <DialogTitle className="plugins-dialog-title">Plugins & Extensions</DialogTitle>
                <Description className="plugins-dialog-subtitle">
                  Extend agent capabilities with skills, subagents, and tools {isGlobalScope ? 'globally across projects' : 'for this project'}.
                </Description>
              </div>
            </div>

            <div className="plugins-dialog-header-right">
              <button
                type="button"
                className="plugins-dialog-reload-btn"
                onClick={handleReload}
                disabled={isReloading}
                title="Reload plugins and refresh agent runtime"
              >
                <svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={isReloading ? 'plugins-spin' : ''}
                >
                  <path d="M21 2v6h-6"/>
                  <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
                  <path d="M3 22v-6h6"/>
                  <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
                </svg>
                <span>{isReloading ? 'Reloading...' : 'Reload'}</span>
              </button>
              <button
                type="button"
                className="plugins-dialog-close-btn"
                onClick={onClose}
                aria-label="Close"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="plugins-dialog-tabs">
            <button
              type="button"
              className={`plugins-dialog-tab ${activeTab === 'installed' ? 'plugins-dialog-tab--active' : ''}`}
              onClick={() => setActiveTab('installed')}
            >
              <span>Installed</span>
              {installedPlugins.length > 0 && (
                <span className="plugins-dialog-tab-badge">{installedPlugins.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`plugins-dialog-tab ${activeTab === 'discover' ? 'plugins-dialog-tab--active' : ''}`}
              onClick={() => setActiveTab('discover')}
            >
              <span>Marketplace</span>
              {discoverPlugins.length > 0 && (
                <span className="plugins-dialog-tab-badge">{discoverPlugins.length}</span>
              )}
            </button>
            <button
              type="button"
              className={`plugins-dialog-tab ${activeTab === 'custom' ? 'plugins-dialog-tab--active' : ''}`}
              onClick={() => setActiveTab('custom')}
            >
              <span>+ Add / Custom</span>
            </button>
          </div>

          {/* Alerts / Banners */}
          {errorMsg && (
            <div className="plugins-dialog-banner plugins-dialog-banner--error">
              <span>{errorMsg}</span>
              <button
                type="button"
                onClick={() => setErrorMsg(null)}
                style={{ background: 'none', border: 'none', color: '#fca5a5', cursor: 'pointer', padding: 0 }}
              >
                ✕
              </button>
            </div>
          )}
          {successMsg && (
            <div className="plugins-dialog-banner plugins-dialog-banner--success">
              <span>{successMsg}</span>
            </div>
          )}
          {gitInstalled === false && (
            <div className="plugins-dialog-banner plugins-dialog-banner--error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>
                {gitInstalling
                  ? `Setting up Git... ${gitStatus.progress ? `${gitStatus.progress}%` : ''} ${gitStatus.message || ''}`
                  : 'Git is not installed on this system. Git is required to download and install plugins from GitHub.'}
              </span>
              <button
                type="button"
                className="plugin-action-btn plugin-action-btn--primary"
                style={{ marginLeft: 12, padding: '4px 10px', fontSize: 11, flexShrink: 0 }}
                onClick={handleInstallGit}
                disabled={gitInstalling}
              >
                {gitInstalling ? 'Installing...' : 'Install Git Automatically'}
              </button>
            </div>
          )}

          {/* Scrollable Content Body */}
          <div className="plugins-dialog-content">
            {/* TAB 1: INSTALLED PLUGINS */}
            {activeTab === 'installed' && (
              <div className="plugins-tab-body">
                {installedPlugins.length > 0 && (
                  <div className="plugins-tab-controls">
                    <div className="plugins-search-wrap">
                      <svg className="plugins-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="11" cy="11" r="8"/>
                        <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                      </svg>
                      <input
                        type="text"
                        className="plugins-search-input"
                        placeholder="Search installed plugins..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                      />
                      {searchQuery && (
                        <button
                          type="button"
                          className="plugins-search-clear"
                          onClick={() => setSearchQuery('')}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  </div>
                )}

                <div className="plugins-scroll-area">
                {isLoading && installedPlugins.length === 0 ? (
                  <div className="plugins-dialog-empty">Loading installed plugins...</div>
                ) : filteredInstalled.length === 0 ? (
                  <div className="plugins-dialog-empty">
                    <div className="plugins-dialog-empty-icon">
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                        <line x1="12" y1="22.08" x2="12" y2="12"/>
                      </svg>
                    </div>
                    <div className="plugins-dialog-empty-title">No plugins installed yet</div>
                    <p className="plugins-dialog-empty-desc">
                      Add plugins from the marketplace to equip the agent with custom workflows, domain skills, and security guardrails.
                    </p>
                    <button
                      type="button"
                      className="plugins-dialog-btn plugins-dialog-btn--primary"
                      onClick={() => setActiveTab('discover')}
                    >
                      Browse Marketplace
                    </button>
                  </div>
                ) : (
                  <div className="plugins-list">
                    {filteredInstalled.map((plugin) => (
                      <div
                        key={`${plugin.id}:${plugin.scope}`}
                        className={`plugin-card ${!plugin.enabled ? 'plugin-card--disabled' : ''}`}
                      >
                        <div className="plugin-card-header">
                          <div className="plugin-card-info">
                            <div className="plugin-card-title-row">
                              <span className="plugin-card-name">{plugin.name}</span>
                              <span className="plugin-card-version">v{plugin.version}</span>
                              <span className={`plugin-tag ${plugin.scope === 'project' ? 'plugin-tag--project' : 'plugin-tag--global'}`}>
                                {plugin.scope === 'project' ? 'Project' : 'User'}
                              </span>
                              {plugin.shadowed && (
                                <span className="plugin-tag plugin-tag--shadowed">
                                  Overrides User
                                </span>
                              )}
                              <span className={`plugin-tag ${plugin.enabled ? 'plugin-tag--active' : 'plugin-tag--disabled'}`}>
                                {plugin.enabled ? 'Enabled' : 'Disabled'}
                              </span>
                              {plugin.category && (
                                <span className={`plugin-category-badge plugin-category-badge--${plugin.category.toLowerCase()}`}>
                                  {plugin.category}
                                </span>
                              )}
                            </div>

                            {plugin.description && (
                              <p className="plugin-card-desc">{plugin.description}</p>
                            )}

                            {/* Capabilities */}
                            <div className="plugin-caps-row">
                              {plugin.capabilities.hasSkills && (
                                <span className="plugin-cap-chip" title="Contributes prompt skills">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="9" y1="18" x2="15" y2="18"/>
                                    <line x1="10" y1="22" x2="14" y2="22"/>
                                    <path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/>
                                  </svg>
                                  <span>Skills</span>
                                </span>
                              )}
                              {plugin.capabilities.hasTools && (
                                <span className="plugin-cap-chip" title="Contributes custom tools">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>
                                  </svg>
                                  <span>Tools</span>
                                </span>
                              )}
                              {plugin.capabilities.hasAgents && (
                                <span className="plugin-cap-chip" title="Contributes specialized task agents">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <rect x="3" y="11" width="18" height="10" rx="2"/>
                                    <circle cx="12" cy="5" r="2"/>
                                    <path d="M12 7v4"/>
                                    <line x1="8" y1="16" x2="8.01" y2="16"/>
                                    <line x1="16" y1="16" x2="16.01" y2="16"/>
                                  </svg>
                                  <span>Agents</span>
                                </span>
                              )}
                              {plugin.capabilities.hasCommands && (
                                <span className="plugin-cap-chip" title="Contributes slash commands">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="19" y1="4" x2="5" y2="20"/>
                                  </svg>
                                  <span>Commands</span>
                                </span>
                              )}
                              {plugin.capabilities.hasHooks && (
                                <span className="plugin-cap-chip" title="Contributes lifecycle hooks">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <line x1="6" y1="3" x2="6" y2="15"/>
                                    <circle cx="18" cy="6" r="3"/>
                                    <circle cx="6" cy="18" r="3"/>
                                    <path d="M18 9a9 9 0 0 1-9 9"/>
                                  </svg>
                                  <span>Hooks</span>
                                </span>
                              )}
                              {plugin.capabilities.hasMcp && (
                                <span className="plugin-cap-chip" title="Packages embedded MCP server">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 22v-5"/>
                                    <path d="M9 8V2"/>
                                    <path d="M15 8V2"/>
                                    <path d="M18 8v5a6 6 0 0 1-12 0V8z"/>
                                  </svg>
                                  <span>MCP</span>
                                </span>
                              )}
                              {plugin.capabilities.hasExtensions && (
                                <span className="plugin-cap-chip" title="Uses in-process ExtensionAPI">
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/>
                                  </svg>
                                  <span>Extension</span>
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Action Buttons */}
                          <div className="plugin-card-actions">
                            {plugin.hasUpdate && (
                              <button
                                type="button"
                                className="plugin-action-btn plugin-action-btn--update"
                                onClick={() => handleUpgrade(plugin)}
                                disabled={actionLoading[plugin.id]}
                                title={`Upgrade to ${plugin.updateVersion}`}
                              >
                                {actionLoading[plugin.id] ? 'Updating...' : `Update`}
                              </button>
                            )}

                            <button
                              type="button"
                              className="plugin-action-btn"
                              onClick={() => handleToggle(plugin)}
                              disabled={actionLoading[plugin.id]}
                            >
                              {plugin.enabled ? 'Disable' : 'Enable'}
                            </button>

                            <button
                              type="button"
                              className="plugin-action-btn plugin-action-btn--danger"
                              onClick={() => handleUninstall(plugin)}
                              disabled={actionLoading[plugin.id]}
                            >
                              Uninstall
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

            {/* TAB 2: MARKETPLACE DISCOVERY */}
            {activeTab === 'discover' && (
              <div className="plugins-tab-body">
                <div className="plugins-tab-controls">
                  <div className="plugins-search-wrap">
                    <svg className="plugins-search-icon" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="11" cy="11" r="8"/>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                    </svg>
                    <input
                      type="text"
                      className="plugins-search-input"
                      placeholder="Search marketplace plugins by name, category, or description..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        className="plugins-search-clear"
                        onClick={() => setSearchQuery('')}
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  {/* Categories */}
                  <div
                    ref={categoriesRef}
                    className={`plugins-category-pills ${isCategoryScrolling ? 'plugins-category-pills--scrolling' : ''}`}
                    onScroll={handleCategoryScroll}
                  >
                    {categories.map((cat) => {
                      const label = CATEGORY_LABELS[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
                      return (
                        <button
                          key={cat}
                          type="button"
                          className={`plugins-category-pill ${categoryFilter === cat ? 'plugins-category-pill--active' : ''}`}
                          onClick={() => setCategoryFilter(cat)}
                        >
                          <span className="plugins-category-pill-icon">{renderCategoryIcon(cat)}</span>
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="plugins-scroll-area">

                {isLoading && discoverPlugins.length === 0 ? (
                  <div className="plugins-dialog-empty">Loading marketplace catalog...</div>
                ) : filteredDiscover.length === 0 ? (
                  <div className="plugins-dialog-empty">
                    <div className="plugins-dialog-empty-title">No matching plugins found</div>
                    <p className="plugins-dialog-empty-desc">
                      Try another keyword or add a custom marketplace catalog under Add / Custom.
                    </p>
                  </div>
                ) : (
                  <div className="plugins-list">
                    {filteredDiscover.map((item) => {
                      const installedMatch =
                        installedLookup.get(item.id) ||
                        installedLookup.get(item.name) ||
                        (item.marketplace ? installedLookup.get(`${item.name}@${item.marketplace}`) : null);
                      const isInstalled = Boolean(item.installed || installedMatch);
                      const installedScope = item.installedScope || installedMatch?.scope || 'project';
                      const isInstallingProject = Boolean(actionLoading[`${item.id}:project`]);
                      const isInstallingGlobal = Boolean(actionLoading[`${item.id}:user`]);
                      return (
                        <div key={item.id} className="plugin-card">
                          <div className="plugin-card-header">
                            <div className="plugin-card-info">
                              <div className="plugin-card-title-row">
                                <span className="plugin-card-name">{item.name}</span>
                                {item.version && (
                                  <span className="plugin-card-version">v{item.version}</span>
                                )}
                                <span className="plugin-tag">
                                  @{item.marketplace}
                                </span>
                                {item.category && (
                                  <span className={`plugin-category-badge plugin-category-badge--${item.category.toLowerCase()}`}>
                                    {item.category}
                                  </span>
                                )}
                              </div>

                              {item.description && (
                                <p className="plugin-card-desc">{item.description}</p>
                              )}

                              {Array.isArray(item.tags) && item.tags.length > 0 && (
                                <div className="plugin-caps-row">
                                  {item.tags.map((tag) => (
                                    <span key={tag} className="plugin-cap-chip">
                                      #{tag}
                                    </span>
                                  ))}
                                </div>
                              )}
                            </div>

                            <div className="plugin-card-actions">
                              {isInstalled ? (
                                <div
                                  className="plugin-installed-pill"
                                  title={`Installed in ${installedScope === 'project' ? 'this project' : 'global user profile'}`}
                                >
                                  <svg
                                    className="plugin-installed-check"
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2.5"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  >
                                    <polyline points="20 6 9 17 4 12" />
                                  </svg>
                                  <span>Installed</span>
                                  <span className="plugin-installed-scope">
                                    {installedScope === 'project' ? 'Project' : 'User'}
                                  </span>
                                </div>
                              ) : (
                                <>
                                  <button
                                    type="button"
                                    className="plugin-action-btn plugin-action-btn--primary"
                                    onClick={() => handleInstallFromDiscover(item, 'project')}
                                    disabled={isInstallingProject || isInstallingGlobal}
                                  >
                                    {isInstallingProject ? 'Installing...' : 'Install'}
                                  </button>
                                  <button
                                    type="button"
                                    className="plugin-action-btn"
                                    onClick={() => handleInstallFromDiscover(item, 'user')}
                                    disabled={isInstallingProject || isInstallingGlobal}
                                    title="Install globally across all projects"
                                  >
                                    {isInstallingGlobal ? 'Installing...' : 'Global'}
                                  </button>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          )}

            {/* TAB 3: CUSTOM INSTALL / ADD MARKETPLACE */}
            {activeTab === 'custom' && (
              <div className="plugins-tab-body">
                <div className="plugins-scroll-area">
                  <div className="plugins-form">
                {/* 1. Direct Install Form */}
                <div className="plugins-form-card">
                  <h4 className="plugins-form-title">Direct Install Spec</h4>
                  <p className="plugins-form-desc">
                    Install a plugin by marketplace ID (<code>name@marketplace</code>), npm package name (<code>@scope/pkg</code>), or git repository URL.
                  </p>
                  <form onSubmit={handleCustomInstall}>
                    <div className="plugins-form-row">
                      <input
                        type="text"
                        className="plugins-form-input"
                        placeholder="e.g. code-review@claude-plugins-official or @scope/pkg"
                        value={customSpec}
                        onChange={(e) => setCustomSpec(e.target.value)}
                        required
                      />
                      <select
                        className="plugins-form-select"
                        value={customType}
                        onChange={(e) => setCustomType(e.target.value)}
                      >
                        <option value="marketplace">Marketplace</option>
                        <option value="npm">npm package</option>
                        <option value="git">Git URL</option>
                        <option value="link">Local Link (Dev)</option>
                      </select>
                      <select
                        className="plugins-form-select"
                        value={customScope}
                        onChange={(e) => setCustomScope(e.target.value)}
                      >
                        <option value="project">Project Scope</option>
                        <option value="user">User / Global Scope</option>
                      </select>
                      <button
                        type="submit"
                        className="plugins-dialog-btn plugins-dialog-btn--primary"
                        disabled={actionLoading.custom || !customSpec.trim()}
                      >
                        {actionLoading.custom ? 'Installing...' : 'Install'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* 2. Add Marketplace Catalog Source */}
                <div className="plugins-form-card">
                  <h4 className="plugins-form-title">Add Marketplace Catalog</h4>
                  <p className="plugins-form-desc">
                    Register a new plugin catalog Git repository (e.g. <code>anthropics/claude-plugins-official</code> or a GitHub repo URL).
                  </p>
                  <form onSubmit={handleAddMarketplace}>
                    <div className="plugins-form-row">
                      <input
                        type="text"
                        className="plugins-form-input"
                        placeholder="owner/repo or https://github.com/..."
                        value={newMarketplaceSource}
                        onChange={(e) => setNewMarketplaceSource(e.target.value)}
                        required
                      />
                      <button
                        type="submit"
                        className="plugins-dialog-btn plugins-dialog-btn--secondary"
                        disabled={actionLoading.addMkt || !newMarketplaceSource.trim()}
                      >
                        {actionLoading.addMkt ? 'Adding...' : 'Add Marketplace'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* 3. Configured Marketplaces List */}
                {marketplaces.length > 0 && (
                  <div className="plugins-form-card">
                    <h4 className="plugins-form-title">Configured Marketplaces</h4>
                    <div className="plugins-list" style={{ marginTop: '0.25rem' }}>
                      {marketplaces.map((m) => (
                        <div
                          key={m.name}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '0.5rem 0',
                            borderBottom: '1px solid rgba(255,255,255,0.06)',
                          }}
                        >
                          <div>
                            <div style={{ fontWeight: 600, fontSize: '0.875rem', color: '#ffffff' }}>{m.name}</div>
                            <div style={{ fontSize: '0.75rem', color: 'rgba(255,255,255,0.5)', fontFamily: 'ui-monospace, monospace' }}>
                              {m.sourceUri} ({m.pluginCount} available)
                            </div>
                          </div>
                          <span className="plugin-tag plugin-tag--active">Connected</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
