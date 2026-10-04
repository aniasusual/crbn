import { useState, useEffect } from 'react';
import ModelSelector from './ModelSelector';
import { API_BASE_URL } from '../config';
import './WelcomeView.css';

/**
 * WelcomeView — Minimalist Notion-style Landing Page.
 * Pure typography, quiet monochrome controls, and crisp hierarchy.
 */
export default function WelcomeView({
  onSubmit,
  onOpenProject,
  isExiting,
  isTransitioning,
  hardwareInfo,
  models = [],
  selectedModel,
  onSelectModel,
  onRefreshModels,
}) {
  const [prompt, setPrompt] = useState('');
  const [isNaming, setIsNaming] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [isGeneratingName, setIsGeneratingName] = useState(false);
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);

  const [projects, setProjects] = useState([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);

  const currentModelObj = models.find((m) => m.id === selectedModel) || {
    name: selectedModel || 'qwen3:8b',
    compatibility_label: 'Optimal',
  };

  const fetchProjects = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/projects`);
      const data = await response.json();
      setProjects(data);
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
    if (!window.confirm(`Delete project "${name}"?`)) return;
    try {
      await fetch(`${API_BASE_URL}/api/projects/${name}`, { method: 'DELETE' });
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
    if (!value) return;

    setIsNaming(true);
    setIsGeneratingName(true);

    try {
      const words = value.split(' ').slice(0, 4).join('-');
      const response = await fetch(
        `${API_BASE_URL}/api/projects/suggest-name?base=${encodeURIComponent(words)}`
      );
      const data = await response.json();
      setProjectName(data.suggested_name);
    } catch (err) {
      console.error('Failed to get suggested name', err);
      setProjectName('new-project');
    } finally {
      setIsGeneratingName(false);
    }
  };

  const handleFinalSubmit = (e) => {
    e.preventDefault();
    if (!projectName.trim()) return;
    onSubmit(prompt, projectName.trim());
  };

  const exiting = isExiting || isTransitioning;

  return (
    <div className={`notion-welcome ${exiting ? 'notion-welcome--exiting' : ''}`}>
      <div className="notion-welcome__content">
        {!isNaming ? (
          <>
            <h1 className="notion-welcome__title">What do you want to build?</h1>
            <p className="notion-welcome__subtitle">
              Describe your web application and Lowkey will build and run it locally.
            </p>

            <form className="notion-welcome__form" onSubmit={handleInitialSubmit}>
              <div className="notion-welcome__input-wrapper">
                <textarea
                  className="notion-welcome__input"
                  placeholder="A Kanban board with drag-and-drop, tags, and local storage..."
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
                />
                <div className="notion-welcome__actions">
                  <div className="notion-welcome__actions-left">
                    <button
                      type="button"
                      className="notion-welcome__model-pill"
                      onClick={() => setIsModelSelectorOpen(true)}
                      title="Change active model"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
                        <rect x="9" y="9" width="6" height="6"></rect>
                        <line x1="9" y1="1" x2="9" y2="4"></line>
                        <line x1="15" y1="1" x2="15" y2="4"></line>
                        <line x1="9" y1="20" x2="9" y2="23"></line>
                        <line x1="15" y1="20" x2="15" y2="23"></line>
                      </svg>
                      <span className="notion-welcome__model-name">
                        {currentModelObj.name || selectedModel}
                      </span>
                      {currentModelObj.compatibility_label && (
                        <span className="notion-welcome__model-compat">
                          {currentModelObj.compatibility_label}
                        </span>
                      )}
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="6 9 12 15 18 9"></polyline>
                      </svg>
                    </button>

                  </div>

                  <div className="notion-welcome__actions-right">
                    <span className="notion-welcome__shortcut-hint">Enter to build</span>
                    <button type="submit" className="notion-welcome__submit-btn" disabled={!prompt.trim()}>
                      Start building
                    </button>
                  </div>
                </div>
              </div>
            </form>


            {!isLoadingProjects && projects.length > 0 && (
              <div className="notion-welcome__projects-section">
                <h3 className="notion-welcome__projects-heading">Recent Projects</h3>
                <div className="notion-welcome__projects-list">
                  {projects.map((project) => (
                    <div
                      key={project.name}
                      className="notion-project-item"
                      onClick={() => onOpenProject(project)}
                    >
                      <div className="notion-project-item__left">
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="notion-project-item__icon"
                        >
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                        </svg>
                        <span className="notion-project-item__name">{project.name}</span>
                      </div>

                      <div className="notion-project-item__right">
                        <span className="notion-project-item__date">
                          {new Date(project.last_opened).toLocaleDateString()}
                        </span>
                        {project.status === 'running' && (
                          <span className="notion-project-item__status-dot" title="Dev server running" />
                        )}
                        <div className="notion-project-item__actions">
                          <button
                            className="notion-project-item__btn"
                            onClick={(e) => handleOpenInFinder(e, project.name)}
                            title="Reveal in Finder"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                              <polyline points="15 3 21 3 21 9"></polyline>
                              <line x1="10" y1="14" x2="21" y2="3"></line>
                            </svg>
                          </button>
                          <button
                            className="notion-project-item__btn notion-project-item__btn--delete"
                            onClick={(e) => handleDeleteProject(e, project.name)}
                            title="Delete project"
                          >
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6"></polyline>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                            </svg>
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <h1 className="notion-welcome__title">Name your project</h1>
            <p className="notion-welcome__subtitle">
              Choose a folder name for your project workspace.
            </p>

            <form className="notion-welcome__form" onSubmit={handleFinalSubmit}>
              <div className="notion-welcome__input-wrapper">
                <input
                  type="text"
                  className="notion-welcome__name-input"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  disabled={isGeneratingName}
                  autoFocus
                />
                {isGeneratingName && <span className="notion-welcome__name-loading">Generating...</span>}
              </div>

              <div className="notion-welcome__actions notion-welcome__actions--naming">
                <button
                  type="button"
                  className="notion-btn notion-btn--secondary"
                  onClick={() => setIsNaming(false)}
                >
                  Back
                </button>
                <button
                  type="submit"
                  className="notion-welcome__submit-btn"
                  disabled={isGeneratingName || !projectName.trim()}
                >
                  Create Project
                </button>
              </div>
            </form>
          </>
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
