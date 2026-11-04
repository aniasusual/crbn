import './WorkspacePreparationView.css';

const MILESTONES = [
  { id: 'scaffolding', label: 'Scaffolding project template' },
  { id: 'git', label: 'Initializing repository baseline' },
  { id: 'dependencies', label: 'Installing dependencies' },
  { id: 'preview', label: 'Starting dev server and live preview' },
];

const PHASE_ORDER = ['scaffolding', 'git', 'dependencies', 'preview', 'ready'];

function getMilestoneStatus(milestoneId, currentPhase) {
  const currentIdx = PHASE_ORDER.indexOf(currentPhase);
  const milestoneIdx = PHASE_ORDER.indexOf(milestoneId);
  if (currentIdx > milestoneIdx || currentPhase === 'ready') return 'completed';
  if (currentIdx === milestoneIdx) return 'active';
  return 'pending';
}

export default function WorkspacePreparationView({ progress }) {
  const phase = progress?.phase || 'scaffolding';
  const percent = progress?.percent || 20;
  const projectName = progress?.projectName || 'workspace';
  const message = progress?.message || 'Preparing project files...';

  return (
    <div className="degrees-prep-screen" role="region" aria-label="Workspace Initialization">
      <div className="degrees-prep-container">
        {/* Header */}
        <div className="degrees-prep-top">
          <span className="degrees-prep-kicker">Workspace Setup</span>
          <h1 className="degrees-prep-heading">{projectName}</h1>
        </div>

        {/* Minimal Progress Line */}
        <div className="degrees-prep-line-track" aria-hidden="true">
          <div
            className="degrees-prep-line-fill"
            style={{ width: `${percent}%` }}
          />
        </div>

        {/* Sequential Text Lines */}
        <div className="degrees-prep-text-lines">
          {MILESTONES.map((m) => {
            const status = getMilestoneStatus(m.id, phase);
            return (
              <div
                key={m.id}
                className={`degrees-prep-line-row degrees-prep-line-row--${status}`}
              >
                <span className="degrees-prep-line-bullet">
                  {status === 'completed' ? (
                    <svg
                      width="10"
                      height="10"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : status === 'active' ? (
                    <span className="degrees-prep-inline-spinner" />
                  ) : (
                    <span className="degrees-prep-dim-dot" />
                  )}
                </span>
                <span className="degrees-prep-line-text">{m.label}</span>
                <span className="degrees-prep-line-state">
                  {status === 'completed'
                    ? 'Done'
                    : status === 'active'
                    ? 'In progress'
                    : 'Pending'}
                </span>
              </div>
            );
          })}
        </div>

        {/* Live Active Log Message */}
        <div className="degrees-prep-log-box">
          <span className="degrees-prep-log-prompt">&gt;</span>
          <span className="degrees-prep-log-text">{message}</span>
        </div>
      </div>
    </div>
  );
}
