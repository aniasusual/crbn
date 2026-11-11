import React, { useEffect, useMemo, useRef, useState } from 'react';
import './TodoCard.css';

const CheckIcon = () => (
  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

const ChevronIcon = ({ expanded }) => (
  <svg
    className={`todo-card__chevron ${expanded ? 'todo-card__chevron--up' : ''}`}
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2.4"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const CloseIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
    <line x1="18" y1="6" x2="6" y2="18" />
    <line x1="6" y1="6" x2="18" y2="18" />
  </svg>
);

function isClosedStatus(status) {
  return status === 'completed' || status === 'abandoned';
}

function summarizeTodos(phases) {
  const validPhases = (Array.isArray(phases) ? phases : []).filter(
    (phase) => phase && Array.isArray(phase.tasks) && phase.tasks.length > 0
  );
  const allTasks = validPhases.flatMap((phase) => phase.tasks);
  const total = allTasks.length;
  const closed = allTasks.filter((t) => isClosedStatus(t.status)).length;
  const completed = allTasks.filter((t) => t.status === 'completed').length;
  const inProgressTask = allTasks.find((t) => t.status === 'in_progress') || null;
  const pendingTask = allTasks.find((t) => t.status === 'pending') || null;
  const blockedTask = allTasks.find((t) => t.status === 'blocked') || null;
  const allClosed = total > 0 && closed === total;

  return {
    validPhases,
    total,
    closed,
    completed,
    inProgressTask,
    pendingTask,
    blockedTask,
    allClosed,
  };
}

export default function TodoCard({ phases = [], hasOverlay = false }) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [expandedDuringOverlay, setExpandedDuringOverlay] = useState(false);
  const [dismissedSignature, setDismissedSignature] = useState(null);
  const bodyRef = useRef(null);
  const activeRowRef = useRef(null);

  const summary = useMemo(() => summarizeTodos(phases), [phases]);
  const phasesSignature = useMemo(() => JSON.stringify(summary.validPhases), [summary.validPhases]);

  useEffect(() => {
    if (!hasOverlay) {
      setExpandedDuringOverlay(false);
    }
  }, [hasOverlay]);

  const effectiveExpanded = hasOverlay ? expandedDuringOverlay : isExpanded;

  useEffect(() => {
    if (!effectiveExpanded || !bodyRef.current || !activeRowRef.current) return;
    const container = bodyRef.current;
    const row = activeRowRef.current;
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const relTop = rowRect.top - containerRect.top + container.scrollTop;
    const relBottom = relTop + rowRect.height;

    if (relTop < container.scrollTop) {
      container.scrollTo({ top: Math.max(0, relTop - 8), behavior: 'smooth' });
    } else if (relBottom > container.scrollTop + container.clientHeight) {
      container.scrollTo({ top: relBottom - container.clientHeight + 8, behavior: 'smooth' });
    }
  }, [phasesSignature, effectiveExpanded]);

  if (summary.total === 0) return null;
  if (summary.allClosed && dismissedSignature === phasesSignature) return null;

  const { validPhases, total, closed, inProgressTask, pendingTask, blockedTask, allClosed } = summary;
  const showPhaseHeaders =
    validPhases.length > 1 ||
    (validPhases.length === 1 &&
      validPhases[0].name &&
      validPhases[0].name !== 'Tasks' &&
      validPhases[0].name !== 'Todos');

  const headlineTask = inProgressTask || pendingTask || blockedTask;
  const collapsedHint = allClosed
    ? 'All tasks complete'
    : headlineTask
    ? headlineTask.content
    : null;

  const handleToggle = () => {
    if (hasOverlay) {
      setExpandedDuringOverlay((prev) => !prev);
    } else {
      setIsExpanded((prev) => !prev);
    }
  };

  return (
    <section
      className={`todo-card ${effectiveExpanded ? 'todo-card--expanded' : 'todo-card--collapsed'}`}
      aria-label="Agent tasks"
    >
      <div className="todo-card__header">
        <button
          type="button"
          className="todo-card__header-toggle"
          onClick={handleToggle}
          aria-expanded={effectiveExpanded}
          title={effectiveExpanded ? 'Collapse tasks' : 'Expand tasks'}
        >
          <span className="todo-card__header-left">
            <span className="todo-card__title">Tasks</span>
            {!effectiveExpanded && collapsedHint && (
              <span
                className={`todo-card__preview-text ${
                  allClosed
                    ? 'todo-card__preview-text--done'
                    : inProgressTask
                    ? 'todo-card__preview-text--active'
                    : blockedTask && !pendingTask
                    ? 'todo-card__preview-text--blocked'
                    : ''
                }`}
                title={collapsedHint}
              >
                {inProgressTask && <span className="todo-card__live-dot" aria-hidden="true" />}
                <span className="todo-card__preview-label">{collapsedHint}</span>
              </span>
            )}
          </span>
          <span className="todo-card__header-right">
            <span className={`todo-card__progress ${allClosed ? 'todo-card__progress--ready' : ''}`}>
              {closed} / {total}
            </span>
            <ChevronIcon expanded={effectiveExpanded} />
          </span>
        </button>

        {allClosed && (
          <button
            type="button"
            className="todo-card__dismiss-btn"
            onClick={() => setDismissedSignature(phasesSignature)}
            title="Dismiss completed tasks"
            aria-label="Dismiss completed tasks"
          >
            <CloseIcon />
          </button>
        )}
      </div>

      {effectiveExpanded && (
        <div className="todo-card__body" ref={bodyRef}>
          {validPhases.map((phase, pIdx) => {
            const pTasks = phase.tasks || [];
            const pClosed = pTasks.filter((t) => isClosedStatus(t.status)).length;
            const pComplete = pTasks.length > 0 && pClosed === pTasks.length;

            return (
              <div key={`${phase.name}-${pIdx}`} className="todo-card__phase">
                {showPhaseHeaders && (
                  <div className="todo-card__phase-head">
                    {validPhases.length > 1 && (
                      <span className="todo-card__pindex">{pIdx + 1}.</span>
                    )}
                    <span className="todo-card__phase-name">{phase.name}</span>
                    <span className={`todo-card__chip ${pComplete ? 'todo-card__chip--done' : ''}`}>
                      {pClosed}/{pTasks.length}
                    </span>
                  </div>
                )}

                <div className="todo-card__tasks">
                  {pTasks.map((task, tIdx) => {
                    const status = task.status || 'pending';
                    const isCompleted = status === 'completed';
                    const isActive = status === 'in_progress';
                    const isBlocked = status === 'blocked';
                    const isAbandoned = status === 'abandoned';
                    const isDoneVisual = isCompleted || isAbandoned;
                    const noteText =
                      (isBlocked && task.blocker) ||
                      (Array.isArray(task.notes) && task.notes.length > 0 ? task.notes[task.notes.length - 1] : null);

                    return (
                      <div
                        key={`${task.content}-${tIdx}`}
                        ref={isActive ? activeRowRef : undefined}
                        className={`todo-card__task ${
                          isActive
                            ? 'todo-card__task--active'
                            : isDoneVisual
                            ? 'todo-card__task--done'
                            : isBlocked
                            ? 'todo-card__task--blocked'
                            : ''
                        }`}
                      >
                        <span
                          className={`todo-card__indicator todo-card__indicator--${status}`}
                          aria-hidden="true"
                        >
                          {isCompleted ? (
                            <CheckIcon />
                          ) : isActive ? (
                            <span className="todo-card__pulse-dot" />
                          ) : isBlocked ? (
                            <span className="todo-card__glyph">!</span>
                          ) : isAbandoned ? (
                            <span className="todo-card__glyph">&ndash;</span>
                          ) : null}
                        </span>

                        <span className="todo-card__task-body">
                          <span className="todo-card__task-top">
                            <span
                              className={`todo-card__task-label ${
                                isDoneVisual ? 'todo-card__task-label--done' : ''
                              }`}
                            >
                              {task.content}
                            </span>
                            {isActive && (
                              <span className="todo-card__badge todo-card__badge--active">
                                In progress
                              </span>
                            )}
                            {isBlocked && (
                              <span className="todo-card__badge todo-card__badge--blocked">
                                Blocked
                              </span>
                            )}
                            {isAbandoned && (
                              <span className="todo-card__badge todo-card__badge--dropped">
                                Dropped
                              </span>
                            )}
                          </span>
                          {noteText && (
                            <span className="todo-card__task-note">{noteText}</span>
                          )}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
