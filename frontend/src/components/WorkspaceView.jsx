import { useState, useCallback, useRef, useEffect } from 'react';
import ChatPanel from './ChatPanel';
import PreviewPanel from './PreviewPanel';
import ModelSelector from './ModelSelector';
import ContextGauge from './ContextGauge';
import './WorkspaceView.css';

export default function WorkspaceView({
  messages,
  onSendMessage,
  onToolResponse,
  isConnected,
  agentStatus = null,
  onClearStatus,
  previewData,
  lastChangeTimestamp,
  onStopPreview,
  onGoBack,
  projectName,
  pendingApproval,
  onApproveCommand,
  onDenyCommand,
  hardwareInfo,
  models = [],
  selectedModel,
  onSelectModel,
  onRefreshModels,
  contextTelemetry,
  onStopAgent,
  todoState,
  checkpointTimeline = [],
  onRewindToStep = null,
}) {
  const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false);
  const isDragging = useRef(false);
  const leftPanelRef = useRef(null);
  const rightPanelRef = useRef(null);


  const handleMouseDown = useCallback((_e) => {
    isDragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    // Disable pointer events on the preview iframe to prevent it from swallowing mouseup events
    if (rightPanelRef.current) {
      rightPanelRef.current.style.pointerEvents = 'none';
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    if (isDragging.current) {
      isDragging.current = false;
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';

      // Restore pointer events
      if (rightPanelRef.current) {
        rightPanelRef.current.style.pointerEvents = 'auto';
      }
    }
  }, []);

  const handleMouseMove = useCallback((e) => {
    if (!isDragging.current) return;

    // Account for the 16px padding on the left of the workspace
    let newWidth = e.clientX - 16;
    if (newWidth < 300) newWidth = 300;
    if (newWidth > window.innerWidth - 300) newWidth = window.innerWidth - 300;

    if (leftPanelRef.current) {
      leftPanelRef.current.style.width = `${newWidth}px`;
    }
  }, []);

  useEffect(() => {
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseMove, handleMouseUp]);

  return (
    <div className="workspace-container">
      <div className="workspace-header">
        <button className="workspace-header__back" onClick={onGoBack}>
          ← Back to Projects
        </button>
        <div className="workspace-header__title">{projectName || 'Workspace'}</div>
        <div className="workspace-header__right">
          <ContextGauge telemetry={contextTelemetry} placement="bottom" />
        </div>
      </div>

      <div className="workspace">
        <div className="workspace__left" ref={leftPanelRef} style={{ width: '400px' }}>
          <ChatPanel
            messages={messages}
            onSendMessage={onSendMessage}
            onToolResponse={onToolResponse}
            isConnected={isConnected}
            agentStatus={agentStatus}
            onClearStatus={onClearStatus}
            pendingApproval={pendingApproval}
            onApproveCommand={onApproveCommand}
            onDenyCommand={onDenyCommand}
            models={models}
            selectedModel={selectedModel}
            hardwareInfo={hardwareInfo}
            onSelectModel={onSelectModel}
            onRefreshModels={onRefreshModels}
            contextTelemetry={contextTelemetry}
            onStopAgent={onStopAgent}
            todoState={todoState}
            checkpointTimeline={checkpointTimeline}
            onRewindToStep={onRewindToStep}
          />
        </div>

        <div className="workspace__splitter" onMouseDown={handleMouseDown} />

        <div className="workspace__right" ref={rightPanelRef}>
          <PreviewPanel
            previewData={previewData}
            onStopPreview={onStopPreview}
            lastChangeTimestamp={lastChangeTimestamp}
          />
        </div>
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

