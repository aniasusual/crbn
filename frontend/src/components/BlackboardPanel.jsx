import { useState, useEffect, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import { getAgentaSessionHeaders } from '../lib/agenta-session';

const TASK_STATUS_GROUPS = [
  { key: 'in_progress', label: 'In progress', dotVar: 'var(--ag-run-status-processing)' },
  { key: 'review', label: 'In review', dotVar: 'var(--ag-run-status-warning)' },
  { key: 'blocked', label: 'Blocked', dotVar: 'var(--ag-run-status-error)' },
  { key: 'backlog', label: 'Backlog', dotVar: 'var(--ag-run-status-default)' },
  { key: 'done', label: 'Done', dotVar: 'var(--ag-run-status-success)' },
];

const TASK_STATUS_BY_KEY = Object.fromEntries(
  TASK_STATUS_GROUPS.map((g) => [g.key, g])
);

const PRIORITY_STYLES = {
  urgent: { label: 'Urgent', tone: 'error' },
  high: { label: 'High', tone: 'warning' },
  medium: { label: 'Medium', tone: 'neutral' },
  low: { label: 'Low', tone: 'muted' },
};

const ARTIFACT_TYPE_LABELS = {
  git_milestone: { label: 'Git milestone', tone: 'success' },
  launch_kit: { label: 'Launch kit', tone: 'warning' },
  bug_reproduction: { label: 'Bug report', tone: 'error' },
  research: { label: 'Research', tone: 'neutral' },
  live_url: { label: 'Live URL', tone: 'neutral' },
  generic: { label: 'Artifact', tone: 'muted' },
};

const PlusIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor">
    <path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z" />
  </svg>
);

const CloseIcon = ({ size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor">
    <path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
  </svg>
);

const ArrowClockwiseIcon = ({ size = 14 }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor">
    <path d="M240,56v48a8,8,0,0,1-8,8H184a8,8,0,0,1,0-16H211.4L184.81,71.64l-.25-.24a80,80,0,1,0-1.67,114.78,8,8,0,0,1,11,11.63A95.44,95.44,0,0,1,128,224h-1.32A96,96,0,1,1,195.75,60L224,85.8V56a8,8,0,1,1,16,0Z" />
  </svg>
);

const CheckIcon = ({ size = 13 }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor">
    <path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z" />
  </svg>
);

const ArrowUpRightIcon = ({ size = 12 }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor">
    <path d="M200,64V168a8,8,0,0,1-16,0V83.31L69.66,197.66a8,8,0,0,1-11.32-11.32L172.69,72H88a8,8,0,0,1,0-16H192A8,8,0,0,1,200,64Z" />
  </svg>
);

const ChevronDownIcon = ({ size = 11 }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" fill="currentColor" aria-hidden="true">
    <path d="M213.66,101.66l-80,80a8,8,0,0,1-11.32,0l-80-80A8,8,0,0,1,53.66,90.34L128,164.69l74.34-74.35a8,8,0,0,1,11.32,11.32Z" />
  </svg>
);

function formatRelativeTime(iso) {
  if (!iso) return '';
  try {
    const diffSec = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
    if (diffSec < 60) return 'just now';
    if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
    if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
    return `${Math.floor(diffSec / 86400)}d ago`;
  } catch {
    return '';
  }
}

const DEFAULT_ENGINEERING_OPTION = {
  id: 'engineering',
  name: 'Engineering Agent',
  role: 'Full-Stack Coding & Dev Server Agent',
  initials: 'ENG',
  color: '#EA580C',
  workflowId: '00000000-0000-4000-8000-000000000e01',
  isCustom: false,
  isEngineering: true,
};

export default function BlackboardPanel({
  projectName,
  companyAgents = [],
  isReady = true,
  theme = 'dark',
  isOpen,
  onClose,
  onMetricsUpdate,
  onSendTaskToEngineering,
  onOpenSpecialistChat,
}) {
  const [activeTab, setActiveTab] = useState('kanban');
  const [tasks, setTasks] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [briefing, setBriefing] = useState(null);
  const [liveAgents, setLiveAgents] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // New task creation state
  const [showNewTaskForm, setShowNewTaskForm] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDesc, setNewTaskDesc] = useState('');
  const [newTaskPriority, setNewTaskPriority] = useState('medium');
  const [newTaskAssignee, setNewTaskAssignee] = useState('');
  const [newTaskDepId, setNewTaskDepId] = useState('');
  const [isCreatingTask, setIsCreatingTask] = useState(false);

  // Approval notes state (approvalId -> string)
  const [approvalNotes, setApprovalNotes] = useState({});
  const [resolvingId, setResolvingId] = useState(null);
  const [continuationByApprovalId, setContinuationByApprovalId] = useState({});
  const [lastContinuation, setLastContinuation] = useState(null);
  const [lastTaskDispatch, setLastTaskDispatch] = useState(null);
  // Artifact filter state
  const [artifactFilter, setArtifactFilter] = useState('all');
  const [taskFilter, setTaskFilter] = useState('all');
  const [expandedTaskIds, setExpandedTaskIds] = useState({});
  const baseUrl = projectName
    ? `${API_BASE_URL}/api/projects/${encodeURIComponent(projectName)}/company/blackboard`
    : null;

  const fetchBlackboardData = useCallback(
    async (silent = false) => {
      if (!baseUrl || !isReady) return;
      if (!silent) setLoading(true);
      try {
        const sessionHeaders = await getAgentaSessionHeaders();
        const [tasksRes, approvalsRes, artifactsRes, briefingRes] = await Promise.all([
          fetch(`${baseUrl}/tasks`, { headers: sessionHeaders }),
          fetch(`${baseUrl}/approvals`, { headers: sessionHeaders }),
          fetch(`${baseUrl}/artifacts`, { headers: sessionHeaders }),
          fetch(`${baseUrl}/briefing`, { headers: sessionHeaders }),
        ]);
        let nextTasks = [];
        let nextApprovals = [];
        let nextArtifacts = [];

        if (tasksRes.ok) {
          const d = await tasksRes.json();
          nextTasks = Array.isArray(d?.tasks) ? d.tasks : [];
          setTasks(nextTasks);
          if (Array.isArray(d?.agents) && d.agents.length > 0) {
            setLiveAgents(d.agents);
          }
        }
        if (approvalsRes.ok) {
          const d = await approvalsRes.json();
          nextApprovals = Array.isArray(d?.approvals) ? d.approvals : [];
          setApprovals(nextApprovals);
        }
        if (artifactsRes.ok) {
          const d = await artifactsRes.json();
          nextArtifacts = Array.isArray(d?.artifacts) ? d.artifacts : [];
          setArtifacts(nextArtifacts);
        }
        if (briefingRes.ok) {
          const nextBriefing = await briefingRes.json();
          setBriefing(nextBriefing);
          if (Array.isArray(nextBriefing?.agents) && nextBriefing.agents.length > 0) {
            setLiveAgents(nextBriefing.agents);
          }
        }
        setError(null);

        if (typeof onMetricsUpdate === 'function') {
          const pendingApprovals = nextApprovals.filter((a) => a.status === 'pending').length;
          onMetricsUpdate({
            totalTasks: nextTasks.length,
            inProgressTasks: nextTasks.filter((t) => t.status === 'in_progress').length,
            blockedTasks: nextTasks.filter((t) => t.status === 'blocked').length,
            doneTasks: nextTasks.filter((t) => t.status === 'done').length,
            pendingApprovals,
            totalArtifacts: nextArtifacts.length,
          });
        }
      } catch (err) {
        if (!silent) {
          setError(err instanceof Error ? err.message : 'Failed to load Blackboard');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [baseUrl, isReady, onMetricsUpdate]
  );

  useEffect(() => {
    if (!projectName || !isReady) return;
    fetchBlackboardData(false);
    const interval = setInterval(() => {
      fetchBlackboardData(true);
    }, 5000);
    return () => clearInterval(interval);
  }, [projectName, isReady, fetchBlackboardData]);
  const handleCreateTask = async (e) => {
    e.preventDefault();
    if (!baseUrl || !newTaskTitle.trim() || isCreatingTask) return;
    setIsCreatingTask(true);
    try {
      const sessionHeaders = await getAgentaSessionHeaders();
      const payload = {
        title: newTaskTitle.trim(),
        description: newTaskDesc.trim() || undefined,
        priority: newTaskPriority,
        dependencies: newTaskDepId ? [newTaskDepId] : [],
        ...(newTaskAssignee ? { assignee_agent_id: newTaskAssignee } : {}),
      };
      const res = await fetch(`${baseUrl}/tasks`, {
        method: 'POST',
        headers: { ...sessionHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        if (data?.continuation?.dispatched) {
          setLastTaskDispatch({
            taskTitle: data?.task?.title || newTaskTitle.trim() || 'Task',
            ...data.continuation,
          });
        }
        setNewTaskTitle('');
        setNewTaskDesc('');
        setNewTaskPriority('medium');
        setNewTaskAssignee('');
        setNewTaskDepId('');
        setShowNewTaskForm(false);
        await fetchBlackboardData(true);
      }
    } finally {
      setIsCreatingTask(false);
    }
  };

  const handleUpdateTaskStatus = async (taskId, nextStatus) => {
    if (!baseUrl || !taskId) return;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status: nextStatus } : t)));
    try {
      const sessionHeaders = await getAgentaSessionHeaders();
      const res = await fetch(`${baseUrl}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { ...sessionHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: nextStatus }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const disp =
          (Array.isArray(data?.unblocked_dispatches) && data.unblocked_dispatches[0]) ||
          data?.continuation;
        if (disp?.dispatched) {
          setLastTaskDispatch({
            taskTitle: data?.task?.title || 'Task',
            ...disp,
          });
        }
      }
      await fetchBlackboardData(true);
    } catch {
      await fetchBlackboardData(true);
    }
  };

  const handleUpdateTaskAssignee = async (taskId, nextAssigneeValue) => {
    if (!baseUrl || !taskId) return;
    try {
      const sessionHeaders = await getAgentaSessionHeaders();
      await fetch(`${baseUrl}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'PATCH',
        headers: { ...sessionHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          assignee_agent_id: nextAssigneeValue || null,
        }),
      });
      await fetchBlackboardData(true);
    } catch {
      await fetchBlackboardData(true);
    }
  };

  const handleOpenTaskInAgentChat = (task) => {
    if (!task) return;
    const isSpecialist =
      Boolean(task.assignee_workflow_id || task.assignee_role) &&
      !task.assignee_is_engineering &&
      task.assignee_role !== 'engineering' &&
      !task.assignee_removed;

    if (isSpecialist && typeof onOpenSpecialistChat === 'function') {
      if (task.id && task.status === 'backlog') {
        handleUpdateTaskStatus(task.id, 'in_progress');
      }
      onOpenSpecialistChat(
        {
          id: task.assignee_role,
          name: task.assignee_name,
          initials: task.assignee_initials,
          workflowId: task.assignee_workflow_id,
        },
        task
      );
      return;
    }

    if (typeof onSendTaskToEngineering === 'function') {
      onSendTaskToEngineering(task);
    }
  };
  const handleResolveApproval = async (approvalId, resolutionStatus) => {
    if (!baseUrl || !approvalId || resolvingId) return;
    setResolvingId(approvalId);
    try {
      const sessionHeaders = await getAgentaSessionHeaders();
      const notes = (approvalNotes[approvalId] || '').trim();
      const res = await fetch(`${baseUrl}/approvals/${encodeURIComponent(approvalId)}/resolve`, {
        method: 'POST',
        headers: { ...sessionHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: resolutionStatus,
          ...(notes ? { founder_notes: notes } : {}),
        }),
      });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const cont = data?.continuation || data?.approval?.continuation;
        if (cont) {
          setContinuationByApprovalId((prev) => ({ ...prev, [approvalId]: cont }));
          setLastContinuation({
            approvalId,
            status: resolutionStatus,
            actionType: data?.approval?.action_type || 'action',
            ...cont,
          });
        }
        await fetchBlackboardData(true);
      }
    } finally {
      setResolvingId(null);
    }
  };

  if (!isOpen) return null;
  const activeRoster = (() => {
    const source = liveAgents.length > 0 ? liveAgents : companyAgents;
    const list = Array.isArray(source) ? [...source] : [];
    if (!list.some((a) => a.id === 'engineering' || a.isEngineering)) {
      list.push(DEFAULT_ENGINEERING_OPTION);
    }
    return list;
  })();

  const pendingApprovals = approvals.filter((a) => a.status === 'pending');
  const resolvedApprovals = approvals.filter((a) => a.status !== 'pending');
  const blockedTasks = tasks.filter((t) => t.status === 'blocked');
  const taskTitleById = new Map(tasks.map((t) => [t.id, t.title]));

  const filteredArtifacts =
    artifactFilter === 'all'
      ? artifacts
      : artifacts.filter((a) => a.type === artifactFilter);
  return (
    <aside
      className={`ag-bb-panel ${theme === 'light' ? 'ag-bb-theme-light' : 'ag-bb-theme-dark'}`}
      aria-label="Blackboard"
    >
      {/* Agenta ScreenScaffold-style Header */}
      <div className="ag-bb-header">
        <div className="ag-bb-header__row">
          <div className="ag-bb-header__title-wrap">
            <h2 className="ag-bb-header__title">Blackboard</h2>
            {briefing?.summary && (
              <p className="ag-bb-header__desc">{briefing.summary}</p>
            )}
          </div>

          <div className="ag-bb-header__actions">
            {activeTab === 'kanban' && (
              <button
                type="button"
                className="ag-bb-btn ag-bb-btn--primary ag-bb-btn--sm"
                onClick={() => setShowNewTaskForm((v) => !v)}
              >
                <PlusIcon size={13} />
                <span>{showNewTaskForm ? 'Cancel' : 'New task'}</span>
              </button>
            )}
            <button
              type="button"
              className="ag-bb-btn ag-bb-btn--ghost ag-bb-btn--icon-sm"
              onClick={() => fetchBlackboardData(false)}
              title="Refresh"
              aria-label="Refresh Blackboard"
            >
              <ArrowClockwiseIcon size={14} />
            </button>
            <button
              type="button"
              className="ag-bb-btn ag-bb-btn--ghost ag-bb-btn--icon-sm"
              onClick={onClose}
              title="Close"
              aria-label="Close Blackboard"
            >
              <CloseIcon size={15} />
            </button>
          </div>
        </div>

        {/* Agenta Line Tabs (matches @agenta/ui TabsList variant="line") */}
        <div className="ag-bb-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'kanban'}
            className={`ag-bb-tab ${activeTab === 'kanban' ? 'ag-bb-tab--active' : ''}`}
            onClick={() => setActiveTab('kanban')}
          >
            <span>Tasks</span>
            <span className="ag-bb-tab__badge">{tasks.length}</span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'approvals'}
            className={`ag-bb-tab ${activeTab === 'approvals' ? 'ag-bb-tab--active' : ''}`}
            onClick={() => setActiveTab('approvals')}
          >
            <span>Approvals</span>
            <span
              className={`ag-bb-tab__badge ${
                pendingApprovals.length > 0 ? 'ag-bb-tab__badge--warning' : ''
              }`}
            >
              {pendingApprovals.length}
            </span>
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'artifacts'}
            className={`ag-bb-tab ${activeTab === 'artifacts' ? 'ag-bb-tab--active' : ''}`}
            onClick={() => setActiveTab('artifacts')}
          >
            <span>Artifacts</span>
            <span className="ag-bb-tab__badge">{artifacts.length}</span>
          </button>
        </div>
      </div>

      {/* Scrollable Body */}
      <div className="ag-bb-body ag-scroll-quiet">
        {error && <div className="ag-bb-callout ag-bb-callout--error">{error}</div>}

        {/* TAB 1: KANBAN */}
        {activeTab === 'kanban' && (
          <>
            {lastTaskDispatch?.dispatched && (
              <div className="ag-bb-card" style={{ borderColor: 'var(--ag-run-status-processing)' }}>
                <div className="ag-bb-card__header">
                  <span className="ag-bb-card__title">
                    {lastTaskDispatch.agentInitials
                      ? `${lastTaskDispatch.agentInitials} · ${lastTaskDispatch.agentName || 'Specialist'}`
                      : lastTaskDispatch.agentName || 'Agent'}{' '}
                    started working on unblocked task
                  </span>
                  {typeof onOpenSpecialistChat === 'function' && lastTaskDispatch.workflowId && (
                    <button
                      type="button"
                      className="ag-bb-btn ag-bb-btn--outline ag-bb-btn--xs"
                      onClick={() =>
                        onOpenSpecialistChat({
                          id: lastTaskDispatch.agentId,
                          name: lastTaskDispatch.agentName,
                          initials: lastTaskDispatch.agentInitials,
                          workflowId: lastTaskDispatch.workflowId,
                          sessionId: lastTaskDispatch.sessionId,
                        })
                      }
                    >
                      <span>View live session</span>
                      <ArrowUpRightIcon size={11} />
                    </button>
                  )}
                </div>
              </div>
            )}

            {showNewTaskForm && (
              <form className="ag-bb-card ag-bb-form" onSubmit={handleCreateTask}>
                <div className="ag-bb-form__header">Create task</div>
                <input
                  type="text"
                  className="ag-bb-input"
                  placeholder="Task title"
                  value={newTaskTitle}
                  onChange={(e) => setNewTaskTitle(e.target.value)}
                  required
                />
                <textarea
                  className="ag-bb-textarea"
                  placeholder="Description or acceptance criteria (optional)"
                  rows={2}
                  value={newTaskDesc}
                  onChange={(e) => setNewTaskDesc(e.target.value)}
                />
                <div className="ag-bb-form__row">
                  <div className="ag-bb-field">
                    <label className="ag-bb-label">Assignee</label>
                    <select
                      className="ag-bb-select"
                      value={newTaskAssignee}
                      onChange={(e) => setNewTaskAssignee(e.target.value)}
                    >
                      <option value="">Unassigned</option>
                      {activeRoster.map((agent) => {
                        const val = agent.workflowId || agent.id;
                        return (
                          <option key={val} value={val}>
                            {agent.initials} · {agent.name}
                            {agent.isCustom ? ' (Custom)' : ''}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="ag-bb-field">
                    <label className="ag-bb-label">Priority</label>
                    <select
                      className="ag-bb-select"
                      value={newTaskPriority}
                      onChange={(e) => setNewTaskPriority(e.target.value)}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                  <div className="ag-bb-field">
                    <label className="ag-bb-label">Blocked by</label>
                    <select
                      className="ag-bb-select"
                      value={newTaskDepId}
                      onChange={(e) => setNewTaskDepId(e.target.value)}
                    >
                      <option value="">None</option>
                      {tasks
                        .filter((t) => t.status !== 'done')
                        .map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.title.slice(0, 44)}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="ag-bb-form__actions">
                    <button
                      type="button"
                      className="ag-bb-btn ag-bb-btn--outline ag-bb-btn--sm"
                      onClick={() => setShowNewTaskForm(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="ag-bb-btn ag-bb-btn--primary ag-bb-btn--sm"
                      disabled={isCreatingTask || !newTaskTitle.trim()}
                    >
                      {isCreatingTask ? 'Saving…' : 'Create'}
                    </button>
                  </div>
                </div>
              </form>
            )}

            {/* Status Filter Bar */}
            <div className="ag-bb-filter-bar">
              {[
                { id: 'all', label: 'All', count: tasks.length },
                ...TASK_STATUS_GROUPS.map((g) => ({
                  id: g.key,
                  label: g.label,
                  dotVar: g.dotVar,
                  count: tasks.filter((t) => t.status === g.key).length,
                })),
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`ag-bb-filter-btn ${
                    taskFilter === f.id ? 'ag-bb-filter-btn--active' : ''
                  }`}
                  onClick={() => setTaskFilter(f.id)}
                >
                  {f.dotVar && (
                    <span
                      className="ag-bb-status-dot"
                      style={{ background: f.dotVar }}
                    />
                  )}
                  <span>{f.label}</span>
                  <span className="ag-bb-filter-btn__count">{f.count}</span>
                </button>
              ))}
            </div>

            {/* Task Groups & Cards */}
            {tasks.length === 0 ? (
              <div className="ag-bb-empty-box">
                No tasks on the Blackboard yet. Create a task or ask Chief of Staff to plan a sprint.
              </div>
            ) : (
              <div className="ag-bb-task-groups">
                {TASK_STATUS_GROUPS.filter((group) =>
                  taskFilter === 'all'
                    ? tasks.some((t) => t.status === group.key)
                    : group.key === taskFilter
                ).map((group) => {
                  const groupTasks = tasks.filter((t) => t.status === group.key);
                  return (
                    <section key={group.key} className="ag-bb-task-group">
                      <div className="ag-bb-col-header">
                        <span
                          className="ag-bb-status-dot"
                          style={{ background: group.dotVar }}
                        />
                        <span className="ag-bb-col-header__label">{group.label}</span>
                        <span className="ag-bb-col-header__count">{groupTasks.length}</span>
                      </div>

                      {groupTasks.length === 0 ? (
                        <div className="ag-bb-empty-box">
                          No tasks in {group.label.toLowerCase()}.
                        </div>
                      ) : (
                        <div className="ag-bb-task-grid">
                          {groupTasks.map((task) => {
                            const pr = PRIORITY_STYLES[task.priority] || PRIORITY_STYLES.medium;
                            const stMeta =
                              TASK_STATUS_BY_KEY[task.status] || TASK_STATUS_BY_KEY.backlog;
                            const depNames = (task.dependencies || [])
                              .map((depId) => taskTitleById.get(depId) || depId.slice(0, 8))
                              .join(', ');
                            const isDescExpanded = Boolean(expandedTaskIds[task.id]);
                            const hasLongDesc =
                              typeof task.description === 'string' && task.description.length > 120;
                            const currentAssigneeValue = task.assignee_removed
                              ? ''
                              : task.assignee_workflow_id ||
                                task.assignee_agent_id ||
                                task.assignee_role ||
                                '';
                            const timeLabel = formatRelativeTime(
                              task.updated_at || task.created_at
                            );

                            return (
                              <div
                                key={task.id}
                                className={`ag-bb-task-card ${
                                  task.status === 'blocked' ? 'ag-bb-task-card--blocked' : ''
                                }`}
                              >
                                {/* Row 1: Status Selector Pill + Priority Chip + Timestamp/Commit */}
                                <div className="ag-bb-task-card__top">
                                  <div className="ag-bb-task-card__top-left">
                                    <label
                                      className="ag-bb-status-pill"
                                      title="Change task status"
                                    >
                                      <span
                                        className="ag-bb-status-dot"
                                        style={{ background: stMeta.dotVar }}
                                      />
                                      <span>{stMeta.label}</span>
                                      <ChevronDownIcon size={10} />
                                      <select
                                        className="ag-bb-overlay-select"
                                        value={task.status}
                                        onChange={(e) =>
                                          handleUpdateTaskStatus(task.id, e.target.value)
                                        }
                                        aria-label={`Status for ${task.title}`}
                                      >
                                        <option value="backlog">Backlog</option>
                                        <option value="in_progress">In progress</option>
                                        <option value="review">In review</option>
                                        <option value="done">Done</option>
                                        <option value="blocked">Blocked</option>
                                      </select>
                                    </label>

                                    <span className={`ag-bb-chip ag-bb-chip--${pr.tone}`}>
                                      {pr.label}
                                    </span>
                                  </div>

                                  <div className="ag-bb-task-card__top-right">
                                    {task.commit_hash ? (
                                      <span
                                        className="ag-bb-code-chip"
                                        title={`Completed in commit ${task.commit_hash}`}
                                      >
                                        {String(task.commit_hash).slice(0, 7)}
                                      </span>
                                    ) : timeLabel ? (
                                      <span className="ag-bb-task-card__time">{timeLabel}</span>
                                    ) : null}
                                  </div>
                                </div>

                                {/* Row 2: Full-Width Task Title */}
                                <h3 className="ag-bb-task-card__title">{task.title}</h3>

                                {/* Row 3: Clamped Description (click to expand) */}
                                {task.description && (
                                  <div className="ag-bb-task-card__desc-wrap">
                                    <p
                                      className={`ag-bb-task-card__desc ${
                                        !isDescExpanded ? 'ag-bb-task-card__desc--clamped' : ''
                                      }`}
                                    >
                                      {task.description}
                                    </p>
                                    {hasLongDesc && (
                                      <button
                                        type="button"
                                        className="ag-bb-task-card__expand-btn"
                                        onClick={() =>
                                          setExpandedTaskIds((prev) => ({
                                            ...prev,
                                            [task.id]: !prev[task.id],
                                          }))
                                        }
                                      >
                                        {isDescExpanded ? 'Show less' : 'Show more'}
                                      </button>
                                    )}
                                  </div>
                                )}

                                {/* Row 4: Dependency Notice (when present) */}
                                {depNames && (
                                  <div className="ag-bb-task-card__deps">
                                    <span className="ag-bb-task-card__deps-text">
                                      Waiting on: <strong>{depNames}</strong>
                                    </span>
                                    {task.status === 'blocked' && (
                                      <button
                                        type="button"
                                        className="ag-bb-btn ag-bb-btn--outline ag-bb-btn--xs"
                                        onClick={() =>
                                          handleUpdateTaskStatus(task.id, 'in_progress')
                                        }
                                      >
                                        Unblock
                                      </button>
                                    )}
                                  </div>
                                )}

                                {/* Row 5: Footer — Interactive Assignee Chip + Open in Chat CTA */}
                                <div className="ag-bb-task-card__footer">
                                  <label
                                    className="ag-bb-assignee-pill"
                                    title="Assign task to a specialist or engineering agent"
                                  >
                                    {task.assignee_initials ? (
                                      <>
                                        <span
                                          className="ag-bb-agent-badge"
                                          style={{
                                            '--ag-agent-color':
                                              task.assignee_color || '#3B82F6',
                                          }}
                                        >
                                          {task.assignee_initials}
                                        </span>
                                        <span className="ag-bb-assignee-pill__name">
                                          {task.assignee_name || task.assignee_role}
                                        </span>
                                      </>
                                    ) : task.assignee_removed ? (
                                      <span className="ag-bb-assignee-pill__unassigned">
                                        Removed agent · Reassign
                                      </span>
                                    ) : (
                                      <span className="ag-bb-assignee-pill__unassigned">
                                        Unassigned
                                      </span>
                                    )}
                                    <ChevronDownIcon size={10} />
                                    <select
                                      className="ag-bb-overlay-select"
                                      value={currentAssigneeValue}
                                      onChange={(e) =>
                                        handleUpdateTaskAssignee(task.id, e.target.value)
                                      }
                                      aria-label={`Assignee for ${task.title}`}
                                    >
                                      <option value="">Unassigned</option>
                                      {activeRoster.map((agent) => {
                                        const val = agent.workflowId || agent.id;
                                        return (
                                          <option key={val} value={val}>
                                            {agent.initials} · {agent.name}
                                            {agent.isCustom ? ' (Custom)' : ''}
                                          </option>
                                        );
                                      })}
                                    </select>
                                  </label>

                                  {(typeof onSendTaskToEngineering === 'function' ||
                                    typeof onOpenSpecialistChat === 'function') &&
                                    task.status !== 'done' && (
                                      <button
                                        type="button"
                                        className="ag-bb-btn ag-bb-btn--outline ag-bb-btn--xs ag-bb-task-card__open-btn"
                                        onClick={() => handleOpenTaskInAgentChat(task)}
                                        title={
                                          task.assignee_initials &&
                                          !task.assignee_is_engineering &&
                                          task.assignee_role !== 'engineering'
                                            ? `Open in ${task.assignee_name} chat`
                                            : 'Send task to 80degrees coding agent'
                                        }
                                      >
                                        <span>
                                          {task.assignee_initials
                                            ? `Open in ${task.assignee_initials}`
                                            : 'Open in chat'}
                                        </span>
                                        <ArrowUpRightIcon size={11} />
                                      </button>
                                    )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}

        {/* TAB 2: FOUNDER APPROVALS */}
        {activeTab === 'approvals' && (
          <div className="ag-bb-stack">
            {lastContinuation?.dispatched && (
              <div className="ag-bb-card" style={{ borderColor: 'var(--ag-run-status-success)' }}>
                <div className="ag-bb-card__header">
                  <span className="ag-bb-card__title">
                    {lastContinuation.agentInitials
                      ? `${lastContinuation.agentInitials} · ${lastContinuation.agentName || 'Specialist'}`
                      : lastContinuation.agentName || 'Agent'}{' '}
                    notified ({lastContinuation.status === 'approved' ? 'Approved' : 'Rejected'})
                  </span>
                  {typeof onOpenSpecialistChat === 'function' && lastContinuation.workflowId && (
                    <button
                      type="button"
                      className="ag-bb-btn ag-bb-btn--outline ag-bb-btn--xs"
                      onClick={() =>
                        onOpenSpecialistChat({
                          id: lastContinuation.agentId,
                          name: lastContinuation.agentName,
                          initials: lastContinuation.agentInitials,
                          workflowId: lastContinuation.workflowId,
                          sessionId: lastContinuation.sessionId,
                        })
                      }
                    >
                      <span>View live session</span>
                      <ArrowUpRightIcon size={11} />
                    </button>
                  )}
                </div>
                <div className="ag-bb-card__desc">
                  Dispatched continuation turn for <code>{lastContinuation.actionType}</code> into session{' '}
                  <code>{String(lastContinuation.sessionId || '').slice(0, 8)}</code>.
                </div>
              </div>
            )}

            <div className="ag-bb-col-header">
              <span className="ag-bb-col-header__label">Waiting on you</span>
              <span className="ag-bb-col-header__count">{pendingApprovals.length}</span>
            </div>
            {pendingApprovals.length === 0 ? (
              <div className="ag-bb-empty-box">
                No actions are waiting for approval.
              </div>
            ) : (
              <div className="ag-bb-stack">
                {pendingApprovals.map((item) => (
                  <div key={item.id} className="ag-bb-card">
                    <div className="ag-bb-card__header">
                      <span className="ag-bb-card__title">{item.action_type}</span>
                      <div className="ag-bb-card__badges">
                        {item.agent_initials && (
                          <span
                            className="ag-bb-agent-badge"
                            style={{
                              '--ag-agent-color': item.agent_color || '#3B82F6',
                            }}
                            title={item.agent_name || item.agent_role}
                          >
                            {item.agent_initials}
                          </span>
                        )}
                        <span className="ag-bb-chip ag-bb-chip--warning">Waiting</span>
                      </div>
                    </div>
                    <pre className="ag-bb-code-block">
                      {JSON.stringify(item.payload || {}, null, 2)}
                    </pre>

                    <div className="ag-bb-approval-bar">
                      <input
                        type="text"
                        className="ag-bb-input"
                        placeholder="Add a note (optional)…"
                        value={approvalNotes[item.id] || ''}
                        onChange={(e) =>
                          setApprovalNotes((prev) => ({
                            ...prev,
                            [item.id]: e.target.value,
                          }))
                        }
                      />
                      <div className="ag-bb-approval-bar__btns">
                        <button
                          type="button"
                          className="ag-bb-btn ag-bb-btn--outline ag-bb-btn--sm"
                          disabled={resolvingId === item.id}
                          onClick={() => handleResolveApproval(item.id, 'rejected')}
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          className="ag-bb-btn ag-bb-btn--primary ag-bb-btn--sm"
                          disabled={resolvingId === item.id}
                          onClick={() => handleResolveApproval(item.id, 'approved')}
                        >
                          <CheckIcon size={13} />
                          <span>Approve</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {resolvedApprovals.length > 0 && (
              <>
                <div className="ag-bb-col-header" style={{ marginTop: 12 }}>
                  <span className="ag-bb-col-header__label">Resolved</span>
                  <span className="ag-bb-col-header__count">{resolvedApprovals.length}</span>
                </div>
                <div className="ag-bb-stack">
                  {resolvedApprovals.map((item) => {
                    const cont = continuationByApprovalId[item.id] || item.continuation;
                    const sessId = cont?.sessionId || item.payload?.session_id;
                    const wfId = cont?.workflowId || item.agent_workflow_id;
                    return (
                      <div key={item.id} className="ag-bb-card">
                        <div className="ag-bb-card__header">
                          <span className="ag-bb-card__title">{item.action_type}</span>
                          <div className="ag-bb-card__badges">
                            {item.agent_initials && (
                              <span
                                className="ag-bb-agent-badge"
                                style={{
                                  '--ag-agent-color': item.agent_color || '#3B82F6',
                                }}
                                title={item.agent_name || item.agent_role}
                              >
                                {item.agent_initials}
                              </span>
                            )}
                            <span
                              className={`ag-bb-chip ${
                                item.status === 'approved'
                                  ? 'ag-bb-chip--success'
                                  : 'ag-bb-chip--error'
                              }`}
                            >
                              {item.status === 'approved' ? 'Approved' : 'Rejected'}
                            </span>
                          </div>
                        </div>
                        {item.founder_notes && (
                          <div className="ag-bb-card__desc">{item.founder_notes}</div>
                        )}
                        <pre className="ag-bb-code-block">
                          {JSON.stringify(item.payload || {}, null, 2)}
                        </pre>
                        {typeof onOpenSpecialistChat === 'function' && wfId && (
                          <div className="ag-bb-card__meta">
                            <span className="ag-bb-card__meta-text">
                              {cont?.dispatched
                                ? `Continuation sent to ${item.agent_name || item.agent_initials || 'agent'}`
                                : item.agent_name || ''}
                            </span>
                            <button
                              type="button"
                              className="ag-bb-btn ag-bb-btn--outline ag-bb-btn--xs"
                              onClick={() =>
                                onOpenSpecialistChat({
                                  id: item.agent_role,
                                  name: item.agent_name,
                                  initials: item.agent_initials,
                                  workflowId: wfId,
                                  sessionId: sessId,
                                })
                              }
                            >
                              <span>
                                {item.agent_initials ? `Open in ${item.agent_initials}` : 'View session'}
                              </span>
                              <ArrowUpRightIcon size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}

        {/* TAB 3: ARTIFACTS */}
        {activeTab === 'artifacts' && (
          <div className="ag-bb-stack">
            <div className="ag-bb-filter-bar">
              {[
                { id: 'all', label: 'All' },
                { id: 'git_milestone', label: 'Git milestones' },
                { id: 'launch_kit', label: 'Launch kits' },
                { id: 'bug_reproduction', label: 'Bug reports' },
                { id: 'research', label: 'Research' },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  className={`ag-bb-filter-btn ${
                    artifactFilter === f.id ? 'ag-bb-filter-btn--active' : ''
                  }`}
                  onClick={() => setArtifactFilter(f.id)}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredArtifacts.length === 0 ? (
              <div className="ag-bb-empty-box">No artifacts found.</div>
            ) : (
              <div className="ag-bb-stack">
                {filteredArtifacts.map((art) => {
                  const meta =
                    ARTIFACT_TYPE_LABELS[art.type] || ARTIFACT_TYPE_LABELS.generic;
                  return (
                    <div key={art.id} className="ag-bb-card">
                      <div className="ag-bb-card__header">
                        <span className="ag-bb-card__title">{art.title}</span>
                        <div className="ag-bb-card__badges">
                          {art.agent_initials && (
                            <span
                              className="ag-bb-agent-badge"
                              style={{
                                '--ag-agent-color': art.agent_color || '#3B82F6',
                              }}
                              title={art.agent_name || art.agent_role}
                            >
                              {art.agent_initials}
                            </span>
                          )}
                          <span className={`ag-bb-chip ag-bb-chip--${meta.tone}`}>
                            {meta.label}
                          </span>
                        </div>
                      </div>
                      <pre className="ag-bb-code-block">
                        {JSON.stringify(art.data || {}, null, 2)}
                      </pre>
                      <div className="ag-bb-card__meta">
                        <span className="ag-bb-card__meta-text">
                          {formatRelativeTime(art.created_at)}
                        </span>
                        {art.type === 'bug_reproduction' &&
                          typeof onSendTaskToEngineering === 'function' && (
                            <button
                              type="button"
                              className="ag-bb-btn ag-bb-btn--outline ag-bb-btn--xs"
                              onClick={() =>
                                onSendTaskToEngineering({
                                  id: art.task_id || undefined,
                                  title: `Fix: ${art.title}`,
                                  description: JSON.stringify(art.data || {}, null, 2),
                                })
                              }
                            >
                              <span>Open in chat</span>
                              <ArrowUpRightIcon size={11} />
                            </button>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {loading && tasks.length === 0 && (
          <div className="ag-bb-empty-box">Loading…</div>
        )}
      </div>
    </aside>
  );
}
