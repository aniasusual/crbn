import { useState, useEffect, useRef, useCallback } from 'react';
import { API_BASE_URL } from '../config';
import './BranchTreeModal.css';

const BRANCH_COLORS = [
  '#38bdf8', // 0: Sky Blue (main)
  '#a855f7', // 1: Purple
  '#34d399', // 2: Emerald Green
  '#fbbf24', // 3: Amber Gold
  '#f43f5e', // 4: Rose Pink
  '#6366f1', // 5: Indigo
  '#14b8a6', // 6: Teal
  '#ec4899', // 7: Fuchsia
];

const BranchIcon = () => (
  <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round">
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
  const [branchingNodeId, setBranchingNodeId] = useState(null);
  const [newBranchInput, setNewBranchInput] = useState('');

  // Pan & Zoom State
  const [zoom, setZoom] = useState(1.0);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [draggingNodeId, setDraggingNodeId] = useState(null);
  const [customNodePositions, setCustomNodePositions] = useState({});

  const bodyRef = useRef(null);
  const draggingNodeRef = useRef(null);
  const panningRef = useRef(null);

  // Fetch full tree graph on open
  useEffect(() => {
    if (!isOpen || !projectName) return;
    setLoading(true);
    setBranchingNodeId(null);
    setNewBranchInput('');
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    setCustomNodePositions({});

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

  // Global mousemove and mouseup listeners for drag and pan
  useEffect(() => {
    if (!isOpen) return;

    const handleWindowMouseMove = (e) => {
      // 1. Handle Node Dragging
      if (draggingNodeRef.current) {
        const { nodeId, startMouseX, startMouseY, startNodeX, startNodeY } = draggingNodeRef.current;
        const dx = (e.clientX - startMouseX) / zoom;
        const dy = (e.clientY - startMouseY) / zoom;
        setCustomNodePositions((prev) => ({
          ...prev,
          [nodeId]: {
            x: Math.round(startNodeX + dx),
            y: Math.round(startNodeY + dy),
          },
        }));
        return;
      }

      // 2. Handle Canvas Panning
      if (panningRef.current) {
        const { startMouseX, startMouseY, startPanX, startPanY } = panningRef.current;
        setPan({
          x: Math.round(startPanX + (e.clientX - startMouseX)),
          y: Math.round(startPanY + (e.clientY - startMouseY)),
        });
      }
    };

    const handleWindowMouseUp = () => {
      draggingNodeRef.current = null;
      panningRef.current = null;
      setDraggingNodeId(null);
      setIsPanning(false);
    };

    window.addEventListener('mousemove', handleWindowMouseMove);
    window.addEventListener('mouseup', handleWindowMouseUp);

    return () => {
      window.removeEventListener('mousemove', handleWindowMouseMove);
      window.removeEventListener('mouseup', handleWindowMouseUp);
    };
  }, [isOpen, zoom]);

  // Mouse wheel zoom on canvas
  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const zoomDelta = e.deltaY < 0 ? 0.08 : -0.08;
    setZoom((z) => Math.min(2.5, Math.max(0.35, +(z + zoomDelta).toFixed(2))));
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !isOpen) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [isOpen, handleWheel]);

  if (!isOpen) return null;

  const rawBranches = treeData?.branches || [];
  const checkpoints = treeData?.all_checkpoints || [];

  // Sort branches so 'main' is always index 0, followed by child branches
  const branches = [...rawBranches].sort((a, b) => {
    if (a.name === 'main') return -1;
    if (b.name === 'main') return 1;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });

  // Assign column index and color to each branch
  const branchLanes = new Map();
  branches.forEach((b, idx) => {
    branchLanes.set(b.name, {
      laneIndex: idx,
      color: BRANCH_COLORS[idx % BRANCH_COLORS.length],
      branch: b,
    });
  });

  const CARD_WIDTH = 250;
  const CARD_HEIGHT = 96;
  const X_PITCH = 320;
  const Y_PITCH = 146;
  const START_X = 50;
  const START_Y = 50;

  // ──────────────────────────────────────────────────────────
  // Build Graph Vertices (Nodes) & Directed Edges
  // ──────────────────────────────────────────────────────────
  const nodes = [];
  const nodeMap = new Map();
  const edges = [];

  // 1. Build main branch nodes from checkpoints
  checkpoints.forEach((step, idx) => {
    const isHeadOfMain = idx === checkpoints.length - 1;
    const isCurrentActiveHead = isHeadOfMain && activeBranch === 'main';
    const mainColor = BRANCH_COLORS[0];

    const defaultX = START_X;
    const defaultY = START_Y + idx * Y_PITCH;
    const nodeId = step.step_id || `step_${idx}`;
    const customPos = customNodePositions[nodeId];

    const node = {
      id: nodeId,
      stepId: step.step_id || `step_${idx}`,
      stepNumber: step.step_number ?? idx,
      branchName: 'main',
      color: mainColor,
      commitHash: step.commit_hash?.slice(0, 7) || 'HEAD',
      prompt: step.prompt || 'Project state',
      isHead: isHeadOfMain,
      isActiveBranch: isCurrentActiveHead,
      col: 0,
      row: idx,
      defaultX,
      defaultY,
      x: customPos ? customPos.x : defaultX,
      y: customPos ? customPos.y : defaultY,
    };

    nodes.push(node);
    nodeMap.set(node.id, node);

    // Sequential edge on main (Step i -> Step i+1)
    if (idx > 0) {
      const prevStepId = checkpoints[idx - 1].step_id || `step_${idx - 1}`;
      edges.push({
        id: `edge-${prevStepId}-${node.id}`,
        fromId: prevStepId,
        toId: node.id,
        color: mainColor,
        isBranchFork: false,
      });
    }
  });

  // 2. Build child branch nodes and branching edges
  branches.forEach((b) => {
    if (b.name === 'main') return;
    const laneInfo = branchLanes.get(b.name);
    if (!laneInfo) return;

    // Find parent source checkpoint where this branch sprouted from
    const parentNode =
      nodeMap.get(b.source_step_id) ||
      nodes.find((n) => n.commitHash === b.source_commit?.slice(0, 7)) ||
      nodes[0];

    const parentRow = parentNode ? parentNode.row : 0;
    const childCol = laneInfo.laneIndex;
    const childRow = parentRow + 1;

    const branchNodeId = `branch-node-${b.name}`;
    const isCurrentActiveHead = activeBranch === b.name;

    const defaultX = START_X + childCol * X_PITCH;
    const defaultY = START_Y + childRow * Y_PITCH;
    const customPos = customNodePositions[branchNodeId];

    const childNode = {
      id: branchNodeId,
      stepId: b.source_step_id || 'step_0',
      stepNumber: parentNode ? parentNode.stepNumber + 1 : 1,
      branchName: b.name,
      color: laneInfo.color,
      commitHash: b.source_commit?.slice(0, 7) || 'HEAD',
      prompt: `Branch: ${b.name} (forked from ${parentNode?.stepId || 'root'})`,
      isHead: true,
      isActiveBranch: isCurrentActiveHead,
      col: childCol,
      row: childRow,
      defaultX,
      defaultY,
      x: customPos ? customPos.x : defaultX,
      y: customPos ? customPos.y : defaultY,
    };

    nodes.push(childNode);
    nodeMap.set(childNode.id, childNode);

    // Directed branching edge (From parent node -> this branch node)
    if (parentNode) {
      edges.push({
        id: `fork-edge-${parentNode.id}-${childNode.id}`,
        fromId: parentNode.id,
        toId: childNode.id,
        color: laneInfo.color,
        isBranchFork: true,
      });
    }
  });

  // Dynamic canvas bounds to fit all nodes even when dragged
  const maxX = Math.max(800, ...nodes.map((n) => n.x + CARD_WIDTH + 80));
  const maxY = Math.max(500, ...nodes.map((n) => n.y + CARD_HEIGHT + 100));

  // Node Drag Start
  const handleNodeMouseDown = (e, node) => {
    if (e.target.closest('button, input, form')) return;
    e.stopPropagation();

    draggingNodeRef.current = {
      nodeId: node.id,
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startNodeX: node.x,
      startNodeY: node.y,
    };
    setDraggingNodeId(node.id);
  };

  // Canvas Pan Start
  const handleCanvasMouseDown = (e) => {
    if (e.target.closest('.branch-tree__node, button, input')) return;
    panningRef.current = {
      startMouseX: e.clientX,
      startMouseY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
    setIsPanning(true);
  };

  // Fit to Screen Handler
  const handleFitView = () => {
    if (nodes.length === 0 || !bodyRef.current) return;
    const bodyRect = bodyRef.current.getBoundingClientRect();
    const minX = Math.min(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const widthSpan = maxX - minX;
    const heightSpan = maxY - minY;

    const scaleX = (bodyRect.width - 100) / widthSpan;
    const scaleY = (bodyRect.height - 100) / heightSpan;
    const newZoom = Math.min(1.2, Math.max(0.4, Math.min(scaleX, scaleY)));

    setZoom(+newZoom.toFixed(2));
    setPan({
      x: Math.round((bodyRect.width - widthSpan * newZoom) / 2 - minX * newZoom),
      y: Math.round((bodyRect.height - heightSpan * newZoom) / 2 - minY * newZoom),
    });
  };

  const handleResetView = () => {
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    setCustomNodePositions({});
  };

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
        {/* Modal Header */}
        <div className="branch-tree__header">
          <div className="branch-tree__header-left">
            <div className="branch-tree__title-row">
              <span className="branch-tree__title">Project Branch Graph</span>
              <div className="branch-tree__active-badge">
                <span className="branch-tree__active-dot" />
                <span>active: {activeBranch}</span>
              </div>
            </div>
            <span className="branch-tree__subtitle">
              Lineage and checkpoint graph for {projectName}
            </span>
          </div>

          <button className="branch-tree__close-btn" onClick={onClose} title="Close (Esc)">
            <CloseIcon />
          </button>
        </div>

        {/* Legend / Info Bar */}
        <div className="branch-tree__nav-bar">
          <div className="branch-tree__nav-legend">
            {branches.map((b) => {
              const laneInfo = branchLanes.get(b.name);
              const color = laneInfo?.color || '#38bdf8';
              const isActive = b.name === activeBranch;
              return (
                <div key={b.name} className="branch-tree__legend-item">
                  <span className="branch-tree__legend-dot" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                  <span style={{ color: isActive ? '#ffffff' : 'rgba(255,255,255,0.7)', fontWeight: isActive ? 600 : 400 }}>
                    {b.name} {isActive && '• Active'}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Graph Body / Canvas Area */}
        {loading ? (
          <div className="branch-tree__loading">Loading graph data structure...</div>
        ) : (
          <div
            ref={bodyRef}
            className={`branch-tree__body ${isPanning ? 'branch-tree__body--panning' : ''}`}
            onMouseDown={handleCanvasMouseDown}
          >
            {/* Unified Transform Layer (Pan & Zoom) */}
            <div
              className="branch-tree__transform-layer"
              style={{
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              }}
            >
              <div
                className="branch-tree__canvas"
                style={{ width: `${maxX}px`, height: `${maxY}px` }}
              >
                {/* SVG Directed Edges */}
                <svg className="branch-tree__svg-edges" width={maxX} height={maxY}>
                  <defs>
                    <marker
                      id="graph-arrow-default"
                      viewBox="0 0 10 10"
                      refX="7"
                      refY="5"
                      markerWidth="6"
                      markerHeight="6"
                      orient="auto-start-reverse"
                    >
                      <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="rgba(255, 255, 255, 0.45)" />
                    </marker>
                    {branches.map((b) => {
                      const lane = branchLanes.get(b.name);
                      const color = lane?.color || '#38bdf8';
                      return (
                        <marker
                          key={`marker-${b.name}`}
                          id={`arrow-${b.name}`}
                          viewBox="0 0 10 10"
                          refX="7"
                          refY="5"
                          markerWidth="6"
                          markerHeight="6"
                          orient="auto-start-reverse"
                        >
                          <path d="M 0 1.5 L 8 5 L 0 8.5 z" fill={color} />
                        </marker>
                      );
                    })}
                  </defs>

                  {/* Render Connecting Edges (Live re-routing on drag) */}
                  {edges.map((edge) => {
                    const fromNode = nodeMap.get(edge.fromId);
                    const toNode = nodeMap.get(edge.toId);
                    if (!fromNode || !toNode) return null;

                    // Ports: bottom center of source -> top center of target
                    const x1 = fromNode.x + CARD_WIDTH / 2;
                    const y1 = fromNode.y + CARD_HEIGHT;
                    const x2 = toNode.x + CARD_WIDTH / 2;
                    const y2 = toNode.y;

                    let d = '';
                    if (Math.abs(x1 - x2) < 4) {
                      d = `M ${x1} ${y1} L ${x2} ${y2}`;
                    } else {
                      const midY = (y1 + y2) / 2;
                      d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
                    }

                    return (
                      <path
                        key={edge.id}
                        d={d}
                        stroke={edge.color}
                        strokeWidth={edge.isBranchFork ? '2.5' : '2'}
                        fill="none"
                        strokeLinecap="round"
                        opacity="0.85"
                        markerEnd={`url(#arrow-${toNode.branchName})`}
                      />
                    );
                  })}
                </svg>

                {/* Graph Vertices (Draggable Node Cards) */}
                {nodes.map((node) => {
                  const isBranchingThis = branchingNodeId === node.id;
                  const isCurrentActive = activeBranch === node.branchName;
                  const isDraggingThis = draggingNodeId === node.id;

                  return (
                    <div
                      key={node.id}
                      className={`branch-tree__node ${isCurrentActive ? 'branch-tree__node--active' : ''} ${
                        isDraggingThis ? 'branch-tree__node--dragging' : ''
                      }`}
                      style={{
                        left: `${node.x}px`,
                        top: `${node.y}px`,
                      }}
                      onMouseDown={(e) => handleNodeMouseDown(e, node)}
                    >
                      {/* Visual port anchors */}
                      <div
                        className="branch-tree__port-top"
                        style={{ background: node.color, boxShadow: `0 0 6px ${node.color}` }}
                      />
                      <div className="branch-tree__port-bottom" />

                      {/* Node Header */}
                      <div className="branch-tree__node-header">
                        <span className="branch-tree__node-badge">Step {node.stepNumber}</span>
                        <span
                          className="branch-tree__node-branch"
                          style={{
                            background: `${node.color}22`,
                            color: node.color,
                          }}
                        >
                          <BranchIcon />
                          <span>{node.branchName}</span>
                        </span>
                        <span className="branch-tree__node-hash">{node.commitHash}</span>
                      </div>

                      {/* Node Prompt Summary */}
                      <div className="branch-tree__node-prompt" title={node.prompt}>
                        {node.prompt}
                      </div>

                      {/* Node Footer / Actions */}
                      <div className="branch-tree__node-footer">
                        {node.isActiveBranch ? (
                          <span className="branch-tree__node-head-tag">• Active</span>
                        ) : (
                          <span style={{ fontSize: '10px', color: 'rgba(255,255,255,0.35)' }}>
                            {node.branchName}
                          </span>
                        )}

                        <div className="branch-tree__node-actions">
                          {!isCurrentActive && (
                            <button
                              type="button"
                              className="branch-tree__btn-switch"
                              onClick={() => handleSwitch(node.branchName)}
                              title={`Switch to branch ${node.branchName}`}
                            >
                              Switch
                            </button>
                          )}
                          <button
                            type="button"
                            className="branch-tree__btn-branch"
                            onClick={() => {
                              setBranchingNodeId(node.id);
                              setNewBranchInput(`exp-${node.stepId.replace(/^step_/, '')}`);
                            }}
                            title="Branch out from this exact node"
                          >
                            <BranchIcon />
                            <span>Branch</span>
                          </button>
                        </div>
                      </div>

                      {/* Inline Branch Creator overlay */}
                      {isBranchingThis && (
                        <form
                          onSubmit={(e) => handleBranchSubmit(e, node.stepId)}
                          className="branch-tree__inline-form"
                        >
                          <div style={{ fontSize: '11px', fontWeight: 600, color: '#93c5fd' }}>
                            Branch from Step {node.stepNumber}
                          </div>
                          <input
                            autoFocus
                            className="branch-tree__inline-input"
                            placeholder="New branch name..."
                            value={newBranchInput}
                            onChange={(e) => setNewBranchInput(e.target.value)}
                            onKeyDown={(e) => e.key === 'Escape' && setBranchingNodeId(null)}
                          />
                          <div className="branch-tree__inline-btns">
                            <button
                              type="button"
                              className="branch-tree__inline-cancel"
                              onClick={() => setBranchingNodeId(null)}
                            >
                              Cancel
                            </button>
                            <button
                              type="submit"
                              className="branch-tree__inline-confirm"
                              disabled={!newBranchInput.trim()}
                            >
                              Create & Switch
                            </button>
                          </div>
                        </form>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Floating Glassmorphic HUD: Zoom, Pan, Fit */}
            <div className="branch-tree__hud">
              <button
                type="button"
                className="branch-tree__hud-btn"
                onClick={() => setZoom((z) => Math.max(0.35, +(z - 0.15).toFixed(2)))}
                title="Zoom Out (−)"
              >
                −
              </button>

              <span
                className="branch-tree__hud-pct"
                onClick={() => setZoom(1.0)}
                title="Click to reset zoom to 100%"
              >
                {Math.round(zoom * 100)}%
              </span>

              <button
                type="button"
                className="branch-tree__hud-btn"
                onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.15).toFixed(2)))}
                title="Zoom In (+)"
              >
                +
              </button>

              <div className="branch-tree__hud-divider" />

              <button
                type="button"
                className="branch-tree__hud-text-btn"
                onClick={handleFitView}
                title="Fit all nodes in view"
              >
                Fit
              </button>

              <button
                type="button"
                className="branch-tree__hud-text-btn"
                onClick={handleResetView}
                title="Reset Pan, Zoom & Positions"
              >
                Reset
              </button>
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
