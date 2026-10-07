import { useState, useEffect } from 'react';
import { API_BASE_URL } from '../config';
import './BranchTreeModal.css';

const BranchIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const CloseIcon = () => (
  <svg viewBox="0 0 24 24" width="14" height="14" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

export default function BranchTreeModal({
  isOpen,
  onClose,
  projectName,
  activeBranch = 'main',
  onSelectBranch,
  onBranchFromStep,
}) {
  const [treeData, setTreeData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [branchingStepId, setBranchingStepId] = useState(null);
  const [newBranchInput, setNewBranchInput] = useState('');

  // Fetch full tree graph on open
  useEffect(() => {
    if (!isOpen || !projectName) return;
    setLoading(true);
    setBranchingStepId(null);
    setNewBranchInput('');

    fetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/branch-tree`)
      .then((res) => res.json())
      .then((data) => {
        setTreeData(data);
      })
      .catch((err) => {
        console.error('[BranchTreeModal] Failed to fetch tree:', err);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [isOpen, projectName]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const branches = treeData?.branches || [];
  const checkpoints = treeData?.all_checkpoints || [];

  const handleSwitch = (branchName) => {
    onSelectBranch?.(branchName);
    onClose();
  };

  const handleBranchSubmit = (e, stepId) => {
    e.preventDefault();
    const name = newBranchInput.trim();
    if (!name || !stepId) return;
    onBranchFromStep?.(stepId, name);
    onClose();
  };

  return (
    <div className="branch-tree-backdrop" onClick={onClose}>
      <div className="branch-tree-modal" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="branch-tree__header">
          <div className="branch-tree__header-left">
            <div className="branch-tree__title-row">
              <span className="branch-tree__title">Project Branch & Checkpoint Tree</span>
              <div className="branch-tree__active-badge">
                <span className="branch-tree__active-dot" />
                <span>active: {activeBranch}</span>
              </div>
            </div>
            <span className="branch-tree__subtitle">
              Visual overview of all branches, checkpoints, and exploration lines for {projectName}
            </span>
          </div>

          <button className="branch-tree__close-btn" onClick={onClose} title="Close (Esc)">
            <CloseIcon />
          </button>
        </div>

        {/* Tree Body */}
        {loading ? (
          <div className="branch-tree__loading">Loading complete project tree...</div>
        ) : (
          <div className="branch-tree__body">
            {branches.map((b) => {
              const isActive = b.name === activeBranch;
              // Checkpoint nodes on this branch track
              const branchSteps = checkpoints.filter((s, idx) => {
                // If main, show all checkpoints or up to branch point
                if (b.name === 'main') return true;
                // If sub-branch, show from source commit or all
                return idx >= 0;
              });

              return (
                <div
                  key={b.id || b.name}
                  className={`branch-tree__column ${isActive ? 'branch-tree__column--active' : ''}`}
                >
                  {/* Column Header */}
                  <div className="branch-tree__col-header">
                    <div className="branch-tree__col-name-wrap" title={b.name}>
                      <span className="branch-tree__col-icon">
                        <BranchIcon />
                      </span>
                      <span className="branch-tree__col-name">{b.name}</span>
                    </div>

                    {!isActive ? (
                      <button
                        type="button"
                        className="branch-tree__switch-btn"
                        onClick={() => handleSwitch(b.name)}
                        title={`Switch to ${b.name}`}
                      >
                        Switch
                      </button>
                    ) : (
                      <span style={{ fontSize: '10.5px', color: '#60a5fa', fontWeight: 600 }}>Active</span>
                    )}
                  </div>

                  {/* Checkpoints Timeline */}
                  <div className="branch-tree__timeline">
                    {branchSteps.map((step, idx) => {
                      const isHead = idx === branchSteps.length - 1;
                      const isBranchingThis = branchingStepId === step.step_id;

                      return (
                        <div
                          key={step.step_id || idx}
                          className={`branch-tree__step-node ${isHead ? 'branch-tree__step-node--head' : ''}`}
                        >
                          <div className="branch-tree__step-dot">{step.step_number ?? idx}</div>

                          <div className="branch-tree__step-card">
                            <div className="branch-tree__step-meta">
                              <span>Step {step.step_number ?? idx}</span>
                              <span className="branch-tree__step-hash">
                                {step.commit_hash?.slice(0, 7) || 'HEAD'}
                              </span>
                            </div>

                            <div className="branch-tree__step-prompt" title={step.prompt}>
                              {step.prompt || 'Turn checkpoint'}
                            </div>

                            <div className="branch-tree__step-actions">
                              {!isBranchingThis ? (
                                <button
                                  type="button"
                                  className="branch-tree__branch-step-btn"
                                  onClick={() => {
                                    setBranchingStepId(step.step_id);
                                    setNewBranchInput(`exp-${step.step_id.replace(/^step_/, '')}`);
                                  }}
                                  title="Create branch from this turn"
                                >
                                  <BranchIcon />
                                  <span>Branch</span>
                                </button>
                              ) : null}
                            </div>

                            {/* Inline Branch Creator */}
                            {isBranchingThis && (
                              <form
                                onSubmit={(e) => handleBranchSubmit(e, step.step_id)}
                                className="branch-tree__inline-form"
                              >
                                <input
                                  autoFocus
                                  className="branch-tree__inline-input"
                                  placeholder="New branch name..."
                                  value={newBranchInput}
                                  onChange={(e) => setNewBranchInput(e.target.value)}
                                  onKeyDown={(e) => e.key === 'Escape' && setBranchingStepId(null)}
                                />
                                <div className="branch-tree__inline-btns">
                                  <button
                                    type="button"
                                    className="branch-tree__inline-cancel"
                                    onClick={() => setBranchingStepId(null)}
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="submit"
                                    className="branch-tree__inline-confirm"
                                    disabled={!newBranchInput.trim()}
                                  >
                                    Create
                                  </button>
                                </div>
                              </form>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
