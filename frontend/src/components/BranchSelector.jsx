import { useState } from 'react';
import './BranchSelector.css';

const BranchIcon = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <line x1="6" y1="3" x2="6" y2="15" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CheckIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const TrashIcon = () => (
  <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

const TreeIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="5" r="3" />
    <circle cx="6" cy="19" r="3" />
    <circle cx="18" cy="19" r="3" />
    <line x1="12" y1="8" x2="12" y2="12" />
    <path d="M6 16v-1a3 3 0 0 1 3-3h6a3 3 0 0 1 3 3v1" />
  </svg>
);

export default function BranchSelector({
  activeBranch = 'main',
  branches = [],
  onSelectBranch,
  onDeleteBranch,
  onOpenTreeView,
  disabled = false,
}) {
  const [isOpen, setIsOpen] = useState(false);

  // Fallback if branches array is empty
  const branchList = branches.length > 0 ? branches : [{ id: 'b_main', name: 'main' }];

  const handleToggle = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
  };
  const handleSelect = (name) => {
    if (name === activeBranch) {
      setIsOpen(false);
      return;
    }
    onSelectBranch?.(name);
    setIsOpen(false);
  };


  const handleDelete = (e, name) => {
    e.stopPropagation();
    if (name === 'main' || name === activeBranch) return;
    if (confirm(`Are you sure you want to delete branch "${name}"?`)) {
      onDeleteBranch?.(name);
    }
  };

  return (
    <div className="branch-selector">
      {/* Trigger Button */}
      <button
        type="button"
        className={`branch-selector__btn ${isOpen ? 'branch-selector__btn--active' : ''}`}
        onClick={handleToggle}
        disabled={disabled}
        title={disabled ? 'Cannot switch branches while agent is running' : 'Switch or create branch'}
      >
        <span className="branch-selector__icon">
          <BranchIcon />
        </span>
        <span className="branch-selector__name">{activeBranch}</span>
        <span className={`branch-selector__chevron ${isOpen ? 'branch-selector__chevron--open' : ''}`}>
          <ChevronDownIcon />
        </span>
      </button>

      {/* Popover Backdrop */}
      {isOpen && <div className="branch-selector__backdrop" onClick={() => setIsOpen(false)} />}

      {/* Popover Dropdown */}
      {isOpen && (
        <div className="branch-selector__menu">
          <div className="branch-selector__menu-header">
            <span className="branch-selector__menu-title">Branches</span>
            <button
              type="button"
              className="branch-selector__tree-btn"
              onClick={() => {
                setIsOpen(false);
                onOpenTreeView?.();
              }}
              title="View Complete Session & Branch Tree"
            >
              <TreeIcon />
              <span>View Tree</span>
            </button>
          </div>

          {/* Branch Items */}
          <div className="branch-selector__list">
            {branchList.map((b) => {
              const isActive = b.name === activeBranch;
              return (
                <div
                  key={b.id || b.name}
                  className={`branch-selector__item ${isActive ? 'branch-selector__item--active' : ''}`}
                  onClick={() => handleSelect(b.name)}
                >
                  <div className="branch-selector__item-left">
                    <BranchIcon />
                    <span className="branch-selector__item-name">{b.name}</span>
                  </div>

                  <div className="branch-selector__item-actions">
                    {isActive ? (
                      <span className="branch-selector__check-icon">
                        <CheckIcon />
                      </span>
                    ) : b.name !== 'main' ? (
                      <button
                        type="button"
                        className="branch-selector__delete-btn"
                        title={`Delete ${b.name}`}
                        onClick={(e) => handleDelete(e, b.name)}
                      >
                        <TrashIcon />
                      </button>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      )}
    </div>
  );
}
