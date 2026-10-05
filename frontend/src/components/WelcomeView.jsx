import { useState, useEffect, useId } from 'react';
import ModelSelector from './ModelSelector';
import AttachmentRibbon from './AttachmentRibbon';
import PaintArtBackground from './PaintArtBackground';
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

  const handleDeleteProject = async (e, name) => {
    e.stopPropagation();
    if (!window.confirm(`Delete project "${name}"? This removes its files.`)) return;
    try {
      await fetch(`${API_BASE_URL}/api/projects/${name}`, { method: 'DELETE' });
      onDeleteProject?.(name);
      fetchProjects();
    } catch (err) {
      console.error('Failed to delete project', err);
    }
  };

  const handleOpenInFinder = async (e, name) => {
    e.stopPropagation();
    try {
      await fetch(`${API_BASE_URL}/api/projects/${name}/open-in-finder`, { method: 'POST' });
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
      {/* Background Painted Fine-Art Canvas */}
      <PaintArtBackground />

      <div className="degrees-welcome__content">
        {!isNaming ? (
          <>
            {/* Header & Editorial Wordmark */}
            {/* Header & Official 80degrees Logo */}
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
                A creative studio for full-stack software. Describe your concept in natural language; we'll compose, build, and run it locally.
              </p>
            </header>

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
                    <span className="degrees-timelines__count">{projects.length}</span>
                  )}
                </div>
                <span className="degrees-timelines__sub">Workspaces stored locally</span>
              </div>

              {isLoadingProjects ? (
                <div className="degrees-timelines__loading">
                  <div className="degrees-spinner" />
                  <span>Loading workspaces...</span>
                </div>
              ) : projects.length > 0 ? (
                <div className="degrees-timelines__list">
                  {projects.map((project) => (
                    <div
                      key={project.name}
                      className="degrees-timeline-row"
                      onClick={() => onOpenProject(project)}
                    >
                      <div className="degrees-timeline-row__main">
                        <div className="degrees-timeline-row__monogram">
                          {project.name.charAt(0).toUpperCase()}
                        </div>

                        <span className="degrees-timeline-row__name">{project.name}</span>

                        {project.status === 'running' && (
                          <span className="degrees-status-badge">
                            <span className="degrees-status-badge__dot" />
                            <span>LIVE</span>
                          </span>
                        )}
                      </div>

                      <div className="degrees-timeline-row__meta">
                        <span className="degrees-timeline-row__model">
                          {project.model ? project.model.split('/').pop() : 'gemini-3.8-flash'}
                        </span>

                        <span className="degrees-timeline-row__date">
                          {project.last_opened
                            ? new Date(project.last_opened).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })
                            : 'Recent'}
                        </span>

                        <div className="degrees-timeline-row__actions" onClick={(e) => e.stopPropagation()}>
                          <button
                            type="button"
                            className="degrees-icon-btn"
                            onClick={(e) => handleOpenInFinder(e, project.name)}
                            title="Reveal in Finder"
                            aria-label="Reveal in Finder"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                            </svg>
                          </button>

                          <button
                            type="button"
                            className="degrees-icon-btn degrees-icon-btn--danger"
                            onClick={(e) => handleDeleteProject(e, project.name)}
                            title="Delete project"
                            aria-label="Delete project"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>

                        <span className="degrees-timeline-row__arrow">→</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="degrees-timelines__empty">
                  <p>No workspaces created yet. Enter an idea above to start building.</p>
                </div>
              )}
            </section>
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
              Choose a directory name for your project in <code>~/.soluchan/projects</code>.
            </p>

            <form className="degrees-welcome__form" onSubmit={handleFinalSubmit}>
              <div className="degrees-naming-input-box">
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
            </form>
          </div>
        )}
      </div>

      {/* Model Selector Modal */}
      <ModelSelector
        isOpen={isModelSelectorOpen}
        onClose={() => setIsModelSelectorOpen(false)}
        selectedModel={selectedModel}
        onSelectModel={onSelectModel}
        hardwareInfo={hardwareInfo}
        models={models}
        onRefreshModels={onRefreshModels}
      />
    </div>
  );
}
