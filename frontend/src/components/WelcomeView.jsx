import { useState, useEffect, useId, useMemo } from 'react';
import ModelSelector from './ModelSelector';
import ProviderConnectModal from './ProviderConnectModal';
import AttachmentRibbon from './AttachmentRibbon';
import { AsciiEffect } from '@/components/ui/ascii-effect';
import { GrainGradient } from '@/components/ui/grain-gradient';
import InteractiveListPreview from '@/components/ui/interactive-list-preview';
import { useMediaAttachments } from '../hooks/useMediaAttachments';
import { API_BASE_URL } from '../config';
import './WelcomeView.css';

export default function WelcomeView({
  onSubmit,
  onOpenProject,
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
      const statusLabel = p.status === 'running' ? `LIVE :${p.port || 3000}` : 'LOCAL';
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
  const currentModelObj = models.find(
    (m) => m.id === selectedModel || m.canonical_id === selectedModel
  ) || {
    name: selectedModel || 'gemini-3.8-flash',
    compatibility_label: 'Optimal',
  };

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

  useEffect(() => {
    fetchProjects();
  }, []);

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

  const handleInitialSubmit = async (e) => {
    e.preventDefault();
    const value = prompt.trim();
    if (!value && attachments.length === 0) return;

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
      .map((a) => ({ data: a.base64, mimeType: a.mimeType, name: a.name }));
    const files = attachments
      .filter((a) => a.type === 'file')
      .map((a) => ({ name: a.name, content: a.content, size: a.size }));

    onSubmit(prompt, projectName.trim(), { images, files });
    clearAttachments();
  };

  const exiting = isExiting || isTransitioning;

  return (
    <div className={`degrees-welcome ${exiting ? 'degrees-welcome--exiting' : ''}`}>
      {!isNaming ? (
        <>
          {/* Left 30%: ASCII Art Panel */}
          <aside className="degrees-welcome__left" aria-label="Visual Art">
            <div className="degrees-welcome__ascii-frame">
              <AsciiEffect
                variant="flow"
                imageSrc="/images/portrait.jpg"
                fontSize={5}
                flowSpeed={0.22}
                flowStrength={12}
                mouseRadius={180}
                mouseStrength={32}
                mouseWaveSpeed={2.6}
                mouseEasing={1.0}
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
                speed={1}
                className="h-full w-full"
              />
            </div>
            <div className="degrees-welcome__right-inner">
            <header className="degrees-welcome__header">
              <div className="degrees-logo-container">
                <img
                  src="/logo-white.png"
                  alt="80degrees"
                  className="degrees-logo-img"
                />
              </div>

              <h1 className="degrees-welcome__title">
                Cook what you <span className="degrees-welcome__title-serif">want.</span>
              </h1>

              <p className="degrees-welcome__subtitle">
                A creative studio for full-stack software. Describe your concept in natural language and choose a model; we'll compose, build, and run it.
              </p>
            </header>

            {/* Direction banner for users without an API key */}
            <div
              className="degrees-welcome__oauth-direction"
              onClick={() => setIsConnectModalOpen(true)}
              title="Connect Claude, ChatGPT, Copilot and more"
            >
              <div className="degrees-welcome__oauth-direction-left">
                <span className="degrees-welcome__oauth-text">
                  No API key?  No problem — connect Claude, ChatGPT, Copilot and more
                </span>
              </div>
              <span className="degrees-welcome__oauth-badge-btn">Connect account →</span>
            </div>

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
                accept="image/*,.pdf,.txt,.md,.json,.csv,.js,.jsx,.ts,.tsx,.py,.html,.css"
                style={{ display: 'none' }}
                onChange={(e) => {
                  if (e.target.files) addFiles(Array.from(e.target.files));
                }}
              />

              <div
                className={`degrees-composer ${
                  isDragging ? 'degrees-composer--dragging' : ''
                }`}
              >
                {/* Uploaded Attachments Preview */}
                {attachments && attachments.length > 0 && (
                  <div className="degrees-composer__attachments">
                    <AttachmentRibbon attachments={attachments} onRemove={removeAttachment} />
                  </div>
                )}

                <textarea
                  id={textareaId}
                  className="degrees-composer__textarea"
                  placeholder="Describe an application, interface, or creative tool you'd like to build..."
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
                      <span>Attach</span>
                    </button>

                    <button
                      type="button"
                      className="degrees-model-pill"
                      onClick={() => setIsModelSelectorOpen(true)}
                      title="Select foundation model"
                    >
                      <span className="degrees-model-pill__icon">✦</span>
                      <span className="degrees-model-pill__name">
                        {currentModelObj.name || selectedModel}
                      </span>
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </button>
                  </div>

                  <div className="degrees-composer__toolbar-right">
                    <span className="degrees-composer__hint">
                      <kbd className="degrees-keycap">↵ return</kbd> to build
                    </span>
                    <button
                      type="submit"
                      className="degrees-cta-btn"
                      disabled={!prompt.trim() && attachments.length === 0}
                    >
                      <span>Start building</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"></line>
                        <polyline points="12 5 19 12 12 19"></polyline>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            </form>

            {/* Recent Timelines Section — Clean Editorial List Format */}
            <section className="degrees-timelines">
              <div className="degrees-timelines__header">
                <div className="degrees-timelines__title-group">
                  <h2 className="degrees-timelines__title">Recent Timelines</h2>
                  {projects.length > 0 && (
                    <span className="degrees-timelines__count">
                      {timelineSearch.trim()
                        ? `${filteredProjects.length} of ${projects.length}`
                        : projects.length}
                    </span>
                  )}
                </div>

                <div className="degrees-timelines__header-right">
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
                        aria-label="Clear search"
                      >
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                          <line x1="18" y1="6" x2="6" y2="18"></line>
                          <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {isLoadingProjects ? (
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
                    <p>No workspaces created yet. Enter an idea above to start building.</p>
                  )}
                </div>
              )}
            </section>
            </div>
          </main>
        </>
      ) : (
          /* Naming Step */
          <div className="degrees-naming-card">
            <div className="degrees-logo-container degrees-logo-container--naming">
              <img
                src="/logo-white.png"
                alt="80degrees"
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
      />
    </div>
  );
}
