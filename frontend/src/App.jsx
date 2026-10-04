import { useState, useEffect, useRef, useCallback } from 'react';
import WelcomeView from './components/WelcomeView';
import WorkspaceView from './components/WorkspaceView';
import { normalizeSubagentName, isSubagentTool } from './components/subagentUtils';
import { API_BASE_URL, WS_BASE_URL } from './config';
import './index.css';

function App() {
  const [activeProject, setActiveProject] = useState(() => {
    try {
      const saved = localStorage.getItem('lowkey_active_project');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const [currentView, setCurrentView] = useState(() => {
    try {
      const saved = localStorage.getItem('lowkey_active_project');
      return saved ? 'workspace' : 'welcome';
    } catch {
      return 'welcome';
    }
  });

  const [isTransitioning, setIsTransitioning] = useState(false);
  const [messages, setMessages] = useState([]);
  const [isConnected, setIsConnected] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null); // 'generating' | 'awaiting_human' | 'done' | null
  const isAgentRunning = agentStatus === 'generating';
  const [pendingApproval, setPendingApproval] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [lastChangeTimestamp, setLastChangeTimestamp] = useState(0);
  const [contextTelemetry, setContextTelemetry] = useState(null);
  const [todoState, setTodoState] = useState(null);
  const [checkpointTimeline, setCheckpointTimeline] = useState([]);
  // Hardware & Model States
  const [hardwareInfo, setHardwareInfo] = useState(null);
  const [models, setModels] = useState([]);
  const [selectedModel, setSelectedModel] = useState(() => {
    try {
      const activeProj = localStorage.getItem('lowkey_active_project');
      if (activeProj) {
        const parsed = JSON.parse(activeProj);
        if (parsed?.model) return parsed.model;
      }
    } catch {}
    return localStorage.getItem('lowkey_selected_model') || 'gemini-3.8-flash';
  });

  const wsRef = useRef(null);
  const pendingInitialPromptRef = useRef(null);
  const handleSendMessageRef = useRef(null);
  // Fetch System Specs and Models
  const fetchModelsAndHardware = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/system/models-and-hardware`);
      if (response.ok) {
        const data = await response.json();
        setHardwareInfo(data.hardware);
        setModels(data.models || []);

        // Validate or set default selected model
        if (data.models && data.models.length > 0) {
          let preferredModel = null;
          try {
            const activeProj = localStorage.getItem('lowkey_active_project');
            if (activeProj) {
              const parsed = JSON.parse(activeProj);
              if (parsed?.model) preferredModel = parsed.model;
            }
          } catch {}
          if (!preferredModel) {
            preferredModel = localStorage.getItem('lowkey_selected_model');
          }

          const matchingModel = data.models.find(
            (m) =>
              (m.id === preferredModel ||
                m.canonical_id === preferredModel ||
                `${m.provider}/${m.id}` === preferredModel) &&
              (m.has_auth || m.installed)
          );

          if (matchingModel) {
            const targetId = matchingModel.canonical_id || matchingModel.id;
            setSelectedModel(targetId);
            localStorage.setItem('lowkey_selected_model', targetId);
          } else {
            // Only default if the user's saved choice does not exist or has no auth
            const defaultModel =
              data.models.find(
                (m) =>
                  (m.id === data.active_model || m.canonical_id === data.active_model) &&
                  (m.has_auth || m.installed)
              ) ||
              data.models.find((m) => m.id === 'gemini-3.8-flash' && m.has_auth) ||
              data.models.find((m) => m.id === 'gemini-2.5-flash' && m.has_auth) ||
              data.models.find((m) => m.has_auth || m.installed) ||
              data.models[0];
            if (defaultModel) {
              const targetId = defaultModel.canonical_id || defaultModel.id;
              setSelectedModel(targetId);
              localStorage.setItem('lowkey_selected_model', targetId);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch hardware and models:', err);
    }
  };

  const handleSelectModel = (modelId) => {
    setSelectedModel(modelId);
    localStorage.setItem('lowkey_selected_model', modelId);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'set_model',
          model: modelId,
        })
      );
    }
  };

  useEffect(() => {
    fetchModelsAndHardware();

    // Initialize WebSocket connection
    wsRef.current = new WebSocket(WS_BASE_URL);

    wsRef.current.onopen = () => {
      setIsConnected(true);
      const savedModel = localStorage.getItem('lowkey_selected_model') || 'gemini-2.5-flash';
      try {
        const saved = localStorage.getItem('lowkey_active_project');
        if (saved) {
          const projectObj = JSON.parse(saved);
          if (projectObj && projectObj.name) {
            wsRef.current.send(
              JSON.stringify({
                action: 'open_project',
                name: projectObj.name,
                model: savedModel,
              })
            );
            return;
          }
        }
      } catch (err) {
        console.error('Failed to auto-open active project on reconnect:', err);
      }
      if (savedModel && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            action: 'set_model',
            model: savedModel,
          })
        );
      }
    };
    wsRef.current.onclose = () => {
      setIsConnected(false);
      setAgentStatus(null);
    };
    wsRef.current.onerror = () => {
      setIsConnected(false);
      setAgentStatus(null);
    };

    wsRef.current.onmessage = (event) => {
      try {
        if (!event || !event.data) return;
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (!data || typeof data !== 'object') return;
        const timestamp = new Date().toISOString();
        // Self-heal running status when active execution events stream in
        if (
          (data.type === 'status' && data.content === 'Running') ||
          data.type === 'token' ||
          data.type === 'thinking' ||
          data.type === 'tool_call' ||
          data.type === 'tool_result' ||
          data.type === 'subagent_event' ||
          data.event === 'subagent_event'
        ) {
          setAgentStatus((prev) => (prev !== 'awaiting_human' ? 'generating' : prev));
        }

        // Handle error responses
        if (data.type === 'error') {
          console.error('WebSocket error:', data.content);
          if (data.content && data.content.toLowerCase().includes('not found')) {
            try {
              localStorage.removeItem('lowkey_active_project');
            } catch {}
            setActiveProject(null);
            setCurrentView('welcome');
          }
          return;
        }

        // Handle Real-Time Context Telemetry Events (CP-106)
        if (data.type === 'context_telemetry' && data.telemetry) {
          setContextTelemetry(data.telemetry);
          return;
        }
        // Handle Real-Time Todo State Updates
        if (data.type === 'todo_update' && data.phases) {
          setTodoState({
            op: data.op || 'view',
            phases: data.phases,
            timestamp: Date.now(),
          });
          return;
        }
        // Handle Real-Time Tool Stream Previews (Live Diffs for Edit)
        if (data.type === 'tool_stream_preview') {
          setMessages((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].type === 'tool_call' && updated[i].name === 'edit') {
                updated[i] = {
                  ...updated[i],
                  diff: data.diff,
                  diffFile: data.file_path,
                };
                return updated;
              }
            }
            return prev;
          });
          return;
        }
        // Handle Real-Time Checkpoint Events
        if (data.type === 'checkpoint_step_captured') {
          setCheckpointTimeline((prev) => {
            const existing = prev.find((s) => s.step_id === data.step_id);
            if (existing) return prev;
            return [...prev, { step_id: data.step_id, label: data.label, timestamp: data.timestamp, file_count: data.file_count }];
          });
          return;
        }
        if (data.type === 'checkpoint_timeline') {
          setCheckpointTimeline(Array.isArray(data.steps) ? data.steps : []);
          return;
        }
        if (data.type === 'step_rewound' || data.type === 'checkpoint_rewound') {
          if (Array.isArray(data.messages)) {
            setMessages(data.messages);
          } else if (data.step_id) {
            setMessages((prev) => {
              const targetIdx = prev.findIndex((m) => m.step_id === data.step_id);
              if (targetIdx === -1) return prev;
              return prev.slice(0, targetIdx);
            });
          }
          setLastChangeTimestamp(Date.now());
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'list_checkpoints' }));
          }
          return;
        }
        // Handle Ask Human Question Event
        if (data.type === 'ask_human') {
          setAgentStatus('awaiting_human');
          setMessages((prev) => {
            const collapsedPrev = prev.map((msg) =>
              msg.type === 'tool_call' || msg.type === 'tool_result' || msg.type === 'thinking'
                ? { ...msg, collapsed: true }
                : msg
            );
            return [...collapsedPrev, { ...data, timestamp }];
          });
          return;
        }

        // Handle Command Approval Request
        if (data.type === 'command_approval_request') {
          setPendingApproval(data);
          return;
        }

        // Handle Preview Events
        if (data.type === 'preview_ready') {
          setPreviewData({
            port: data.port,
            url: data.url,
            backend_port: data.backend_port,
            backend_url: data.backend_url,
          });
          return;
        }
        if (data.type === 'preview_stopped') {
          setPreviewData(null);
          return;
        }

        // Handle File Changed Events from Agent Tool Execution
        if (data.type === 'file_changed') {
          setLastChangeTimestamp(Date.now());
          return;
        }

        if (data.type === 'project_opened') {
          if (data.project) {
            setActiveProject(data.project);
            if (data.project.model) {
              setSelectedModel(data.project.model);
              try {
                localStorage.setItem('lowkey_selected_model', data.project.model);
              } catch {}
            }
            try {
              localStorage.setItem('lowkey_active_project', JSON.stringify(data.project));
            } catch (e) {
              console.error('Failed to persist active project:', e);
            }
          }
          if (data.project && data.project.port) {
            setPreviewData({
              port: data.project.port,
              url: `http://localhost:${data.project.port}`,
            });
          } else {
            setPreviewData(null);
          }
          if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
            wsRef.current.send(JSON.stringify({ action: 'list_checkpoints' }));
          }

          // Dispatch pending initial prompt as soon as project is confirmed open on backend
          if (pendingInitialPromptRef.current) {
            const initialPrompt = pendingInitialPromptRef.current;
            pendingInitialPromptRef.current = null;
            handleSendMessageRef.current?.(initialPrompt);
          }
          return;
        }

        // Handle Rehydrating Persistent Chat History from Backend
        if (data.type === 'chat_history_loaded') {
          const rawEvents = Array.isArray(data.messages) ? data.messages : [];
          // Correlate tool_call and tool_result pairs into single unified cards
          const loaded = [];
          for (const ev of rawEvents) {
            if (ev.type === 'tool_result') {
              const matchedCall = loaded.slice().reverse().find(
                (m) => m.type === 'tool_call' && (m.id === ev.id || (!m.result && m.name === ev.name))
              );
              if (matchedCall) {
                matchedCall.result = ev.result;
                matchedCall.is_error = ev.is_error;
                if (ev.arguments) matchedCall.arguments = ev.arguments;
                if (ev.subagentStatus) matchedCall.subagentStatus = ev.subagentStatus;
                if (ev.subagentEvents) matchedCall.subagentEvents = ev.subagentEvents;
                if (ev.subagentMetrics) matchedCall.subagentMetrics = ev.subagentMetrics;
                continue;
              }
            }
            loaded.push({ ...ev });
          }
          const lastMsg = loaded[loaded.length - 1];
          const lastWasAsk = Boolean(
            lastMsg &&
              (lastMsg.type === 'ask_human' ||
                (lastMsg.type === 'tool_call' && lastMsg.name === 'ask_human') ||
                lastMsg.content === 'AwaitingHuman')
          );
          setAgentStatus((prev) => {
            if (prev === 'generating') return 'generating';
            return lastWasAsk ? 'awaiting_human' : null;
          });
          const collapsed = loaded.map((m) => ({
            ...m,
            collapsed: m.type === 'tool_call' || m.type === 'tool_result' || m.type === 'thinking' ? true : m.collapsed,
            subagentStatus: m.subagentStatus === 'running' ? 'interrupted' : m.subagentStatus,
          }));
          setMessages((prev) => {
            if (prev.length === 0) {
              return collapsed;
            }
            if (loaded.length === 0) {
              return prev;
            }
            // Preserve any in-flight active user prompt in prev that isn't in the loaded history yet
            const activeInFlight = prev.filter(
              (pMsg) =>
                (pMsg.role === 'user' || pMsg.type === 'user') &&
                !loaded.some(
                  (lMsg) =>
                    lMsg.content === pMsg.content &&
                    (lMsg.role === 'user' || lMsg.type === 'user')
                )
            );
            return [...collapsed, ...activeInFlight];
          });
          const latestTelemetryMsg = [...loaded].reverse().find((m) => m?.debug?.context_telemetry);
          if (latestTelemetryMsg?.debug?.context_telemetry) {
            setContextTelemetry(latestTelemetryMsg.debug.context_telemetry);
          } else if (data.telemetry) {
            setContextTelemetry(data.telemetry);
          }
          return;
        }

        // Handle Real-Time LLM Debug Inspection Payload
        if (data.type === 'llm_debug' && data.debug) {
          if (data.debug.context_telemetry) {
            setContextTelemetry(data.debug.context_telemetry);
          }
          setMessages((prev) => {
            const updated = [...prev];
            // Attach debug to the user message of this turn if needed
            const lastUserIdx = updated.map((m) => m.role === 'user' || m.type === 'user').lastIndexOf(true);
            if (lastUserIdx >= 0 && (!updated[lastUserIdx].debug || data.target === 'user')) {
              updated[lastUserIdx] = { ...updated[lastUserIdx], debug: data.debug };
            }
            // Also attach to the most recent assistant or tool message in progress
            const lastIdx = updated.length - 1;
            if (lastIdx >= 0 && lastIdx !== lastUserIdx) {
              updated[lastIdx] = { ...updated[lastIdx], debug: data.debug };
            }
            return updated;
          });
          return;
        }

        // Handle Real-Time Subagent Telemetry Events
        if (data.type === 'subagent_event' || data.event === 'subagent_event' || (data.subagent && (data.event || data.type))) {
          const normSubagent = normalizeSubagentName(data.subagent);
          const eventKind = data.event || data.type;
          setMessages((prev) => {
            const updated = [...prev];
            let matchIdx = -1;
            for (let i = updated.length - 1; i >= 0; i--) {
              const msg = updated[i];
              if (msg.type !== 'tool_call') continue;

              const normMsg = normalizeSubagentName(msg.name);
              const isMatch =
                msg.name === 'task' ||
                msg.name === data.subagent ||
                normMsg === normSubagent ||
                normMsg === data.subagent ||
                msg.name === normSubagent ||
                msg.arguments?.agent === data.subagent ||
                msg.arguments?.agent === normSubagent ||
                (Array.isArray(msg.arguments?.tasks) &&
                  msg.arguments.tasks.some(
                    (t) => t.agent === data.subagent || t.name === data.id || t.agent === normSubagent
                  ));

              if (isMatch) {
                matchIdx = i;
                break;
              }
            }

            if (matchIdx >= 0) {
              const msg = updated[matchIdx];
              const existingEvents = msg.subagentEvents || [];
              updated[matchIdx] = {
                ...msg,
                subagentEvents: [...existingEvents, { ...data, timestamp }],
                subagentStatus:
                  eventKind === 'finish'
                    ? data.status === 'failed'
                      ? 'failed'
                      : 'completed'
                    : 'running',
              };
              return updated;
            }

            // Fallback: If no tool_call card exists yet, create one so real-time events are never dropped
            const newSubagentCard = {
              type: 'tool_call',
              name: data.subagent || 'task',
              arguments: { agent: data.subagent, id: data.id, task: data.task || data.content || '' },
              subagentEvents: [{ ...data, timestamp }],
              subagentStatus:
                eventKind === 'finish'
                  ? data.status === 'failed'
                    ? 'failed'
                    : 'completed'
                  : 'running',
              timestamp,
            };
            return [...updated, newSubagentCard];
          });
          return;
        }

        // Correlate Tool Result with in-flight Tool Call in-place
        if (data.type === 'tool_result') {
          const isSubagent = isSubagentTool(data.name);
          const normName = normalizeSubagentName(data.name);

          setMessages((prev) => {
            const updated = [...prev];
            let matchIdx = -1;

            // Search backwards for the corresponding tool_call
            for (let i = updated.length - 1; i >= 0; i--) {
              const msg = updated[i];
              if (msg.type !== 'tool_call') continue;

              const isIdMatch = Boolean(data.id && msg.id && msg.id === data.id);
              const isNameMatch = !msg.result && (
                msg.name === data.name ||
                (isSubagent && (msg.name === 'task' || normalizeSubagentName(msg.name) === normName))
              );

              if (isIdMatch || isNameMatch) {
                matchIdx = i;
                break;
              }
            }

            if (matchIdx >= 0) {
              const prevCall = updated[matchIdx];
              updated[matchIdx] = {
                ...prevCall,
                result: data.result,
                is_error: data.is_error,
                arguments: data.arguments || prevCall.arguments,
                subagentStatus: isSubagent ? (data.subagentStatus || 'completed') : prevCall.subagentStatus,
                subagentEvents:
                  isSubagent && data.subagentEvents && data.subagentEvents.length > 0
                    ? data.subagentEvents
                    : prevCall.subagentEvents,
                subagentMetrics:
                  isSubagent && data.subagentMetrics
                    ? data.subagentMetrics
                    : prevCall.subagentMetrics,
              };
              return updated;
            }

            // Only if no matching tool_call card was found, append standalone result
            return [...updated, { ...data, timestamp }];
          });
          return;
        }

        const isTerminalStatus =
          data.type === 'status' &&
          (data.content === 'Done' ||
            data.content === 'AwaitingHuman' ||
            data.content?.startsWith('Error') ||
            data.content?.startsWith('Harness Error') ||
            data.content?.startsWith('Ollama Error') ||
            data.content?.startsWith('Stopped'));

        if (isTerminalStatus) {
          if (data.content === 'AwaitingHuman') {
            setAgentStatus('awaiting_human');
          } else if (data.content === 'Done') {
            setAgentStatus('done');
            setLastChangeTimestamp(Date.now());
          } else {
            setAgentStatus(null);
          }
        }

        setMessages((prev) => {
          // Auto-collapse tool/thinking blocks when execution completes or errors out
          if (isTerminalStatus) {
            const collapsedPrev = prev.map((msg) =>
              msg.type === 'tool_call' || msg.type === 'tool_result' || msg.type === 'thinking'
                ? { ...msg, collapsed: true }
                : msg
            );
            if (data.content === 'Done') {
              return collapsedPrev;
            }
            return [...collapsedPrev, { ...data, timestamp }];
          }

          // If it's a streaming token or thinking, try to append to the last message
          if (data.type === 'token' || data.type === 'thinking') {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.type === data.type) {
              const newLastMsg = { ...lastMsg, content: lastMsg.content + data.content };
              return [...prev.slice(0, -1), newLastMsg];
            }
            // If starting a brand-new token message and it's pure whitespace, don't create an empty bubble
            if (data.type === 'token' && !data.content.trim()) {
              return prev;
            }
          }
          // Otherwise, just add as a new message with a timestamp
          return [...prev, { ...data, timestamp }];
        });
      } catch (e) {
        console.error('Failed to parse websocket message', e);
      }
    };

    return () => {
      wsRef.current?.close();
    };
  }, []);

  const handleSendMessage = (prompt) => {
    if (!prompt) return;

    setAgentStatus('generating');
    // Add user message to UI
    setMessages((prev) => [
      ...prev,
      { role: 'user', content: prompt, timestamp: new Date().toISOString() },
    ]);

    if (wsRef.current && isConnected) {
      wsRef.current.send(
        JSON.stringify({
          action: 'prompt',
          prompt: prompt,
          model: selectedModel,
        })
      );
    }
  };
  handleSendMessageRef.current = handleSendMessage;

  const handleToolResponse = useCallback((id, response) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'tool_response',
          id,
          response,
        })
      );
    }
    setAgentStatus('generating');
  }, []);

  const handleOpenProject = (projectInfo) => {
    setActiveProject(projectInfo);
    setCurrentView('workspace');
    try {
      localStorage.setItem('lowkey_active_project', JSON.stringify(projectInfo));
    } catch (e) {
      console.error('Failed to persist active project:', e);
    }

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'open_project',
          name: projectInfo.name,
          model: selectedModel,
        })
      );
    }
  };

  const handleCreateProject = async (prompt, projectName) => {
    try {
      setIsTransitioning(true);
      setAgentStatus('generating');

      const response = await fetch(`${API_BASE_URL}/api/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: projectName, template: 'node_react', model: selectedModel }),
      });
      const data = await response.json();

      // Open project first; prompt will dispatch automatically on 'project_opened' confirmation
      pendingInitialPromptRef.current = prompt;
      handleOpenProject(data);
      setIsTransitioning(false);
    } catch (err) {
      console.error('Failed to create project', err);
      alert('Failed to create project.');
      setAgentStatus(null);
      setIsTransitioning(false);
    }
  };


  const handleRewindToStep = useCallback((stepId, report = '') => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;
    wsRef.current.send(
      JSON.stringify({
        action: 'rewind_to_step',
        step_id: stepId,
        report: report || `User clicked rewind to ${stepId}`,
      })
    );
  }, []);

  const handleGoToBrowser = () => {
    setAgentStatus(null);
    setCurrentView('welcome');
    setActiveProject(null);
    setPreviewData(null);
    setMessages([]);
    try {
      localStorage.removeItem('lowkey_active_project');
    } catch (e) {
      console.error('Failed to clear active project:', e);
    }
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          action: 'close_project',
        })
      );
    }
  };

  const handleApproveCommand = (requestId) => {
    if (wsRef.current && isConnected) {
      wsRef.current.send(
        JSON.stringify({
          action: 'command_approval',
          request_id: requestId,
          approved: true,
        })
      );
    }
    setPendingApproval(null);
  };

  const handleDenyCommand = (requestId) => {
    if (wsRef.current && isConnected) {
      wsRef.current.send(
        JSON.stringify({
          action: 'command_approval',
          request_id: requestId,
          approved: false,
        })
      );
    }
    setPendingApproval(null);
  };

  const handleStopPreview = () => {
    if (wsRef.current && isConnected) {
      wsRef.current.send(JSON.stringify({ action: 'stop_preview' }));
    }
    setPreviewData(null);
  };

  const handleStopAgent = () => {
    if (wsRef.current && isConnected) {
      wsRef.current.send(JSON.stringify({ action: 'stop_agent' }));
    }
    setAgentStatus(null);
  };

  return (
    <div className="app-container">
      {currentView === 'welcome' && (
        <WelcomeView
          onSubmit={handleCreateProject}
          onOpenProject={handleOpenProject}
          isTransitioning={isTransitioning}
          hardwareInfo={hardwareInfo}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          onRefreshModels={fetchModelsAndHardware}
        />
      )}

      {currentView === 'workspace' && (
        <WorkspaceView
          messages={messages}
          onSendMessage={handleSendMessage}
          onToolResponse={handleToolResponse}
          isConnected={isConnected}
          isAgentRunning={isAgentRunning}
          agentStatus={agentStatus}
          onClearStatus={() => setAgentStatus(null)}
          previewData={previewData}
          lastChangeTimestamp={lastChangeTimestamp}
          onStopPreview={handleStopPreview}
          onGoBack={handleGoToBrowser}
          projectName={activeProject?.name}
          pendingApproval={pendingApproval}
          onApproveCommand={handleApproveCommand}
          onDenyCommand={handleDenyCommand}
          hardwareInfo={hardwareInfo}
          models={models}
          selectedModel={selectedModel}
          onSelectModel={handleSelectModel}
          onRefreshModels={fetchModelsAndHardware}
          contextTelemetry={contextTelemetry}
          onStopAgent={handleStopAgent}
          todoState={todoState}
          checkpointTimeline={checkpointTimeline}
          onRewindToStep={handleRewindToStep}
        />
      )}
    </div>
  );
}

export default App;

