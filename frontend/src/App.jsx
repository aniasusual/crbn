import { useState, useEffect, useRef, useCallback } from 'react';
import WelcomeView from './components/WelcomeView';
import WorkspaceView from './components/WorkspaceView';
import TabBar from './components/TabBar';
import { normalizeSubagentName, isSubagentTool } from './components/subagentUtils';
import { API_BASE_URL, WS_BASE_URL } from './config';
import './index.css';

export default function App() {
  const [tabs, setTabs] = useState(() => {
    try {
      const saved = localStorage.getItem('80degrees_open_tabs');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const [activeTabId, setActiveTabId] = useState(() => {
    try {
      return localStorage.getItem('80degrees_active_tab_id') || null;
    } catch {
      return null;
    }
  });

  const [currentView, setCurrentView] = useState(() => {
    try {
      const savedTabs = localStorage.getItem('80degrees_open_tabs');
      const parsed = savedTabs ? JSON.parse(savedTabs) : [];
      return parsed.length > 0 ? 'workspace' : 'welcome';
    } catch {
      return 'welcome';
    }
  });

  const [isTransitioning, setIsTransitioning] = useState(false);
  const [hardwareInfo, setHardwareInfo] = useState(null);
  const [models, setModels] = useState([]);
  const [providers, setProviders] = useState([]);
  const [globalDefaultModel, setGlobalDefaultModel] = useState(() => {
    return localStorage.getItem('80degrees_selected_model') || 'gemini-3.8-flash';
  });
  const [welcomePrompt, setWelcomePrompt] = useState('');

  // Map of tabId -> WebSocket connection
  const socketsRef = useRef(new Map());
  // Map of tabId -> pending initial prompt string
  const pendingPromptsRef = useRef(new Map());
  const handleSendMessageRef = useRef(null);
  const connectTabSocketRef = useRef(null);

  // Save open tabs list to localStorage whenever it changes
  useEffect(() => {
    try {
      const serialized = tabs.map((t) => ({
        id: t.id,
        projectName: t.projectName,
        model: t.model,
      }));
      localStorage.setItem('80degrees_open_tabs', JSON.stringify(serialized));
    } catch (e) {
      console.error('Failed to persist open tabs:', e);
    }
  }, [tabs]);

  // Save active tab ID to localStorage
  useEffect(() => {
    try {
      if (activeTabId) {
        localStorage.setItem('80degrees_active_tab_id', activeTabId);
      } else {
        localStorage.removeItem('80degrees_active_tab_id');
      }
    } catch (e) {
      console.error('Failed to persist active tab id:', e);
    }
  }, [activeTabId]);

  // Fetch System Specs and Models
  const fetchModelsAndHardware = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/system/models-and-hardware`);
      if (response.ok) {
        const data = await response.json();
        setHardwareInfo(data.hardware);
        setModels(data.models || []);
        setProviders(data.providers || []);

        // Validate or set default selected model
        if (data.models && data.models.length > 0) {
          const savedModel = localStorage.getItem('80degrees_selected_model');
          const matching = data.models.find(
            (m) =>
              (m.id === savedModel || m.canonical_id === savedModel) &&
              (m.has_auth || m.installed)
          );
          if (matching) {
            const targetId = matching.canonical_id || matching.id;
            setGlobalDefaultModel(targetId);
            localStorage.setItem('80degrees_selected_model', targetId);
          } else {
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
              setGlobalDefaultModel(targetId);
              localStorage.setItem('80degrees_selected_model', targetId);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch hardware and models:', err);
    }
  };

  // Helper to mutate a single tab's state
  const updateTab = useCallback((tabId, updater) => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== tabId) return t;
        const patch = typeof updater === 'function' ? updater(t) : updater;
        return { ...t, ...patch };
      })
    );
  }, []);

  // Connects a dedicated WebSocket for a specific tab
  const connectTabSocket = useCallback(
    (tabId, projectName, modelName, initialPrompt, initialAttachments) => {
      // Close existing socket for this tab if any
      const oldWs = socketsRef.current.get(tabId);
      if (oldWs) {
        try {
          oldWs.close();
        } catch {}
      }

      if (initialPrompt || (initialAttachments && (initialAttachments.images?.length > 0 || initialAttachments.files?.length > 0))) {
        pendingPromptsRef.current.set(tabId, { prompt: initialPrompt || '', attachments: initialAttachments });
      }

      const ws = new WebSocket(WS_BASE_URL);
      socketsRef.current.set(tabId, ws);

      ws.onopen = () => {
        updateTab(tabId, { isConnected: true });
        ws.send(
          JSON.stringify({
            action: 'open_project',
            name: projectName,
            model: modelName,
          })
        );
      };

      ws.onclose = () => {
        updateTab(tabId, { isConnected: false, agentStatus: null });
      };

      ws.onerror = () => {
        updateTab(tabId, { isConnected: false, agentStatus: null });
      };

      ws.onmessage = (event) => {
        try {
          if (!event || !event.data) return;
          const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
          if (!data || typeof data !== 'object') return;
          const timestamp = new Date().toISOString();

          // Self-heal running status when active execution events arrive
          if (
            (data.type === 'status' && data.content === 'Running') ||
            data.type === 'token' ||
            data.type === 'thinking' ||
            data.type === 'tool_call' ||
            data.type === 'tool_result' ||
            data.type === 'subagent_event'
          ) {
            updateTab(tabId, (t) => ({
              agentStatus: t.agentStatus !== 'awaiting_human' ? 'generating' : t.agentStatus,
            }));
          }

          if (data.type === 'context_telemetry' && data.telemetry) {
            updateTab(tabId, { contextTelemetry: data.telemetry });
            return;
          }

          if (data.type === 'todo_update' && data.phases) {
            updateTab(tabId, {
              todoState: {
                op: data.op || 'view',
                phases: data.phases,
                timestamp: Date.now(),
              },
            });
            return;
          }

          if (data.type === 'preview_ready') {
            updateTab(tabId, (t) => ({
              previewData: {
                port: data.port,
                url: data.url,
                backend_port: data.backend_port ?? t.previewData?.backend_port ?? null,
                backend_url:
                  data.backend_url ??
                  (data.backend_port
                    ? `http://127.0.0.1:${data.backend_port}`
                    : t.previewData?.backend_url ?? null),
              },
            }));
            return;
          }

          if (data.type === 'preview_stopped') {
            updateTab(tabId, { previewData: null });
            return;
          }

          if (data.type === 'file_changed') {
            updateTab(tabId, { lastChangeTimestamp: Date.now() });
            return;
          }
          if (data.type === 'step_checkpoint_created' && data.step_id) {
            updateTab(tabId, (t) => {
              const msgs = [...t.messages];
              if (msgs.length > 0) {
                const lastIdx = msgs.length - 1;
                msgs[lastIdx] = { ...msgs[lastIdx], step_id: data.step_id };
              }
              return { messages: msgs };
            });
            return;
          }

          if (data.type === 'checkpoint_timeline') {
            updateTab(tabId, {
              checkpointTimeline: Array.isArray(data.steps) ? data.steps : [],
            });
            return;
          }

          if (data.type === 'branch_state') {
            updateTab(tabId, {
              activeBranch: data.active_branch || 'main',
              branches: Array.isArray(data.branches) ? data.branches : [],
            });
            return;
          }

          if (data.type === 'rewind_completed') {
            updateTab(tabId, (t) => ({
              agentStatus: null,
              lastChangeTimestamp: Date.now(),
              messages: Array.isArray(data.messages)
                ? data.messages.map((m) => ({
                    ...m,
                    collapsed:
                      m.type === 'tool_call' || m.type === 'tool_result' || m.type === 'thinking'
                        ? true
                        : m.collapsed,
                  }))
                : t.messages,
            }));
            return;
          }

          if (data.type === 'project_opened') {
            updateTab(tabId, (t) => {
              const prev = t.previewData;
              const port = data.project?.port ?? prev?.port;
              const backendPort = data.project?.backend_port ?? prev?.backend_port ?? null;
              return {
                project: data.project,
                model: data.project?.model || t.model,
                previewData: port
                  ? {
                      port,
                      url: `http://127.0.0.1:${port}`,
                      backend_port: backendPort,
                      backend_url: backendPort
                        ? prev?.backend_url || `http://127.0.0.1:${backendPort}`
                        : null,
                    }
                  : prev,
              };
            });

            // If an initial prompt was queued for this tab, dispatch it now
            const pending = pendingPromptsRef.current.get(tabId);
            if (pending) {
              pendingPromptsRef.current.delete(tabId);
              const promptText = typeof pending === 'string' ? pending : pending.prompt;
              const attachments = typeof pending === 'object' ? pending.attachments : undefined;

              updateTab(tabId, (t) => {
                const alreadyHasPrompt = t.messages.some(
                  (m) => (m.role === 'user' || m.type === 'user') && m.content === promptText
                );
                return {
                  agentStatus: 'generating',
                  messages: alreadyHasPrompt
                    ? t.messages
                    : [
                        ...t.messages,
                        {
                          role: 'user',
                          content: promptText,
                          images: attachments?.images,
                          files: attachments?.files,
                          timestamp: new Date().toISOString(),
                        },
                      ],
                };
              });
              ws.send(
                JSON.stringify({
                  action: 'prompt',
                  prompt: promptText,
                  images: attachments?.images,
                  files: attachments?.files,
                  model: modelName,
                })
              );
            }
            return;
          }

          if (data.type === 'chat_history_loaded') {
            const rawEvents = Array.isArray(data.messages) ? data.messages : [];
            const loaded = [];
            for (const ev of rawEvents) {
              if (ev.type === 'tool_result') {
                const matchedCall = loaded
                  .slice()
                  .reverse()
                  .find(
                    (m) => m.type === 'tool_call' && (m.id === ev.id || (!m.result && m.name === ev.name))
                  );
                if (matchedCall) {
                  matchedCall.result = ev.result;
                  matchedCall.is_error = ev.is_error;
                  if (ev.arguments) matchedCall.arguments = ev.arguments;
                  if (ev.subagentStatus) matchedCall.subagentStatus = ev.subagentStatus;
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

            updateTab(tabId, (t) => {
              const mappedLoaded = loaded.map((m) => ({
                ...m,
                collapsed:
                  m.type === 'tool_call' || m.type === 'tool_result' || m.type === 'thinking'
                    ? true
                    : m.collapsed,
              }));

              // Preserve in-flight prompt only on initial load, NEVER on rewind
              const inFlight = data.is_rewind
                ? []
                : (t.messages || []).filter(
                    (activeMsg) =>
                      !mappedLoaded.some(
                        (histMsg) =>
                          (histMsg.id && activeMsg.id && histMsg.id === activeMsg.id) ||
                          (histMsg.role === activeMsg.role && histMsg.content === activeMsg.content)
                      )
                  );

              return {
                agentStatus:
                  t.agentStatus === 'generating' && !data.is_rewind
                    ? 'generating'
                    : lastWasAsk
                    ? 'awaiting_human'
                    : null,
                messages: data.is_rewind ? mappedLoaded : [...mappedLoaded, ...inFlight],
              };
            });
            return;
          }

          if (data.type === 'ask_human') {
            updateTab(tabId, (t) => ({
              agentStatus: 'awaiting_human',
              messages: [...t.messages, { ...data, timestamp }],
            }));
            return;
          }

          if (data.type === 'command_approval_request') {
            updateTab(tabId, { pendingApproval: data });
            return;
          }

          // Subagent event correlation
          if (
            data.type === 'subagent_event' ||
            data.event === 'subagent_event' ||
            (data.subagent && (data.event || data.type))
          ) {
            updateTab(tabId, (t) => {
              const updated = [...t.messages];
              const normSubagent = normalizeSubagentName(data.subagent);
              let matchIdx = -1;
              for (let i = updated.length - 1; i >= 0; i--) {
                const msg = updated[i];
                if (msg.type !== 'tool_call') continue;
                if (
                  msg.name === 'task' ||
                  msg.name === data.subagent ||
                  normalizeSubagentName(msg.name) === normSubagent
                ) {
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
                    data.event === 'finish' || data.type === 'finish'
                      ? data.status === 'failed'
                        ? 'failed'
                        : 'completed'
                      : 'running',
                };
                return { messages: updated };
              }

              return {
                messages: [
                  ...updated,
                  {
                    type: 'tool_call',
                    name: data.subagent || 'task',
                    arguments: { agent: data.subagent, id: data.id, task: data.task || '' },
                    subagentEvents: [{ ...data, timestamp }],
                    subagentStatus: 'running',
                    timestamp,
                  },
                ],
              };
            });
            return;
          }

          // In-place Tool Result Correlation
          if (data.type === 'tool_result') {
            const isSubagent = isSubagentTool(data.name);
            const normName = normalizeSubagentName(data.name);

            updateTab(tabId, (t) => {
              const updated = [...t.messages];
              let matchIdx = -1;
              for (let i = updated.length - 1; i >= 0; i--) {
                const msg = updated[i];
                if (msg.type !== 'tool_call') continue;
                const isIdMatch = Boolean(data.id && msg.id && msg.id === data.id);
                const isNameMatch =
                  !msg.result &&
                  (msg.name === data.name ||
                    (isSubagent && (msg.name === 'task' || normalizeSubagentName(msg.name) === normName)));
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
                  subagentStatus: isSubagent ? data.subagentStatus || 'completed' : prevCall.subagentStatus,
                };
                return { messages: updated };
              }
              return { messages: [...updated, { ...data, timestamp }] };
            });
            return;
          }

          const isTerminalStatus =
            data.type === 'status' &&
            (data.content === 'Done' ||
              data.content === 'AwaitingHuman' ||
              data.content?.startsWith('Error') ||
              data.content?.startsWith('Harness Error') ||
              data.content?.startsWith('Stopped'));

          if (isTerminalStatus) {
            updateTab(tabId, (t) => ({
              agentStatus:
                data.content === 'AwaitingHuman'
                  ? 'awaiting_human'
                  : data.content === 'Done'
                  ? 'done'
                  : null,
              lastChangeTimestamp: data.content === 'Done' ? Date.now() : t.lastChangeTimestamp,
              messages: t.messages.map((m) =>
                m.type === 'tool_call' || m.type === 'tool_result' || m.type === 'thinking'
                  ? { ...m, collapsed: true }
                  : m
              ),
            }));
            return;
          }

          // Streaming tokens and thinking deltas
          if (data.type === 'token' || data.type === 'thinking') {
            updateTab(tabId, (t) => {
              const prevMsgs = t.messages;
              const lastMsg = prevMsgs[prevMsgs.length - 1];
              if (lastMsg && lastMsg.type === data.type) {
                const updatedLast = { ...lastMsg, content: lastMsg.content + data.content };
                return { messages: [...prevMsgs.slice(0, -1), updatedLast] };
              }
              if (data.type === 'token' && !data.content.trim()) {
                return {};
              }
              return { messages: [...prevMsgs, { ...data, timestamp }] };
            });
            return;
          }

          // Fallback append
          updateTab(tabId, (t) => ({
            messages: [...t.messages, { ...data, timestamp }],
          }));
        } catch (e) {
          console.error(`[Tab ${tabId}] WebSocket message error:`, e);
        }
      };
    },
    [updateTab]
  );
  connectTabSocketRef.current = connectTabSocket;

  // Rehydrate open tabs on initial load
  useEffect(() => {
    fetchModelsAndHardware();

    try {
      const savedTabs = localStorage.getItem('80degrees_open_tabs');
      const parsedTabs = savedTabs ? JSON.parse(savedTabs) : [];
      if (Array.isArray(parsedTabs) && parsedTabs.length > 0) {
        const initialized = parsedTabs.map((t) => ({
          id: t.id,
          projectName: t.projectName,
          project: { name: t.projectName },
          model: t.model || localStorage.getItem('80degrees_selected_model') || 'gemini-3.8-flash',
          inputText: '',
          messages: [],
          agentStatus: null,
          previewData: null,
          contextTelemetry: null,
          todoState: null,
          checkpointTimeline: [],
          pendingApproval: null,
          lastChangeTimestamp: 0,
          activeBranch: 'main',
          branches: [],
          isConnected: false,
        }));
        setTabs(initialized);

        // Connect sockets for all saved tabs
        for (const t of initialized) {
          connectTabSocketRef.current?.(t.id, t.projectName, t.model);
        }

        const savedActiveId = localStorage.getItem('80degrees_active_tab_id');
        const activeExists = initialized.some((t) => t.id === savedActiveId);
        setActiveTabId(activeExists ? savedActiveId : initialized[0].id);
        setCurrentView('workspace');
      }
    } catch (e) {
      console.error('Failed to restore open tabs:', e);
    }

    const activeSockets = socketsRef.current;
    return () => {
      for (const ws of activeSockets.values()) {
        try {
          ws.close();
        } catch {}
      }
      activeSockets.clear();
    };
  }, []);

  // Handle Opening a Project (from Welcome screen or Finder)
  const handleOpenProject = useCallback(
    (projectInfo, initialPrompt, initialAttachments) => {
      const projectName = projectInfo.name;
      const tabId = `tab_${projectName}`;
      const chosenModel = projectInfo.model || globalDefaultModel;

      // If already open, switch to that tab
      const existingTab = tabs.find((t) => t.id === tabId || t.projectName === projectName);
      if (existingTab) {
        setActiveTabId(existingTab.id);
        setCurrentView('workspace');
        if (initialPrompt || initialAttachments) {
          handleSendMessageRef.current?.(initialPrompt, initialAttachments);
        }
        return;
      }

      const initialMessages = (initialPrompt || initialAttachments)
        ? [
            {
              role: 'user',
              content: initialPrompt || '',
              images: initialAttachments?.images,
              files: initialAttachments?.files,
              timestamp: new Date().toISOString(),
            },
          ]
        : [];

      // Create new tab
      const newTab = {
        id: tabId,
        projectName,
        project: projectInfo,
        model: chosenModel,
        inputText: '',
        messages: initialMessages,
        agentStatus: initialPrompt ? 'generating' : null,
        previewData: null,
        contextTelemetry: null,
        todoState: null,
        checkpointTimeline: [],
        pendingApproval: null,
        lastChangeTimestamp: 0,
        activeBranch: 'main',
        branches: [],
        isConnected: false,
      };
      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(tabId);
      setCurrentView('workspace');

      // Establish dedicated WebSocket connection for this tab
      connectTabSocket(tabId, projectName, chosenModel, initialPrompt, initialAttachments);
    },
    [tabs, globalDefaultModel, connectTabSocket]
  );

  // Handle Creating a New Project from Welcome Screen
  const handleCreateProject = useCallback(
    async (prompt, projectName, attachments) => {
      try {
        setIsTransitioning(true);
        const response = await fetch(`${API_BASE_URL}/api/projects`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: projectName,
            template: 'node_react',
            model: globalDefaultModel,
          }),
        });
        const data = await response.json();
        setWelcomePrompt('');
        handleOpenProject(data, prompt, attachments);
        setIsTransitioning(false);
      } catch (err) {
        console.error('Failed to create project:', err);
        alert('Failed to create project.');
        setIsTransitioning(false);
      }
    },
    [globalDefaultModel, handleOpenProject]
  );
  // Handle Cloning and Building on a GitHub Repository
  const handleConnectAndBuild = useCallback(
    async (repo, prompt, attachments, targetBranch) => {
      try {
        setIsTransitioning(true);
        const branchToUse = targetBranch || repo.default_branch;
        const response = await fetch(`${API_BASE_URL}/api/github/clone`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            full_name: repo.full_name,
            branch: branchToUse,
            model: globalDefaultModel,
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.detail || 'Failed to clone repository');
        }
        setWelcomePrompt('');
        handleOpenProject(data, prompt, attachments);
        setIsTransitioning(false);
      } catch (err) {
        console.error('Failed to clone and build on repository:', err);
        alert(`Failed to clone and build on repository: ${err instanceof Error ? err.message : String(err)}`);
        setIsTransitioning(false);
      }
    },
    [globalDefaultModel, handleOpenProject]
  );


  // Handle Closing a Tab
  const handleCloseTab = useCallback(
    (tabId) => {
      const ws = socketsRef.current.get(tabId);
      if (ws) {
        try {
          ws.send(JSON.stringify({ action: 'close_project' }));
          ws.close();
        } catch {}
        socketsRef.current.delete(tabId);
      }
      pendingPromptsRef.current.delete(tabId);

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabId);
        if (activeTabId === tabId) {
          if (remaining.length > 0) {
            setActiveTabId(remaining[remaining.length - 1].id);
          } else {
            setActiveTabId(null);
            setCurrentView('welcome');
          }
        }
        return remaining;
      });
    },
    [activeTabId]
  );
  // Handle Deleting a Project from Welcome screen (closes any open tabs for it)
  const handleDeleteProjectFromTabs = useCallback(
    (projectName) => {
      const matching = tabs.filter((t) => t.projectName === projectName || t.id === `tab_${projectName}`);
      for (const tab of matching) {
        handleCloseTab(tab.id);
      }
    },
    [tabs, handleCloseTab]
  );


  // Active Tab Derived State
  const activeTab = tabs.find((t) => t.id === activeTabId) || null;

  // Active Tab Action Handlers
  const handleSendMessage = useCallback(
    (prompt, attachments) => {
      if ((!prompt && (!attachments || (!attachments.images?.length && !attachments.files?.length))) || !activeTabId) return;
      const ws = socketsRef.current.get(activeTabId);
      const tab = tabs.find((t) => t.id === activeTabId);
      if (!ws || !tab) return;

      const images = attachments?.images ?? [];
      const files = attachments?.files ?? [];

      updateTab(activeTabId, (t) => ({
        agentStatus: 'generating',
        messages: [
          ...t.messages,
          {
            role: 'user',
            content: prompt,
            images: images.length > 0 ? images : undefined,
            files: files.length > 0 ? files : undefined,
            timestamp: new Date().toISOString(),
          },
        ],
      }));

      const payload = JSON.stringify({
        action: 'prompt',
        prompt,
        images: images.length > 0 ? images : undefined,
        files: files.length > 0 ? files : undefined,
        model: tab.model,
      });

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(payload);
      } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.addEventListener('open', () => ws.send(payload), { once: true });
      }
    },
    [activeTabId, tabs, updateTab]
  );
  handleSendMessageRef.current = handleSendMessage;

  const handleToolResponse = useCallback(
    (id, response) => {
      if (!activeTabId) return;
      const ws = socketsRef.current.get(activeTabId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'tool_response', id, response }));
      }
      updateTab(activeTabId, { agentStatus: 'generating' });
    },
    [activeTabId, updateTab]
  );

  const handleSelectModel = useCallback(
    (modelId) => {
      if (!activeTabId) {
        setGlobalDefaultModel(modelId);
        localStorage.setItem('80degrees_selected_model', modelId);
        return;
      }
      updateTab(activeTabId, { model: modelId });
      setGlobalDefaultModel(modelId);
      localStorage.setItem('80degrees_selected_model', modelId);

      const ws = socketsRef.current.get(activeTabId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'set_model', model: modelId }));
      }
    },
    [activeTabId, updateTab]
  );

  const handleStopAgent = useCallback(() => {
    if (!activeTabId) return;
    const ws = socketsRef.current.get(activeTabId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: 'stop_agent' }));
    }
    updateTab(activeTabId, { agentStatus: null, pendingApproval: null });
  }, [activeTabId, updateTab]);

  const handleRewindToStep = useCallback(
    (stepId, mode = 'code_and_messages') => {
      if (!activeTabId || !stepId) return;
      const ws = socketsRef.current.get(activeTabId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'rewind_to_step', step_id: stepId, mode }));
      }
    },
    [activeTabId]
  );

  useEffect(() => {
    const handleGlobalKeyDown = (e) => {
      if (e.key === 'Escape') {
        const tab = tabs.find((t) => t.id === activeTabId);
        if (tab && (tab.agentStatus === 'generating' || tab.agentStatus === 'awaiting_human')) {
          handleStopAgent();
        }
      }
    };
    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [tabs, activeTabId, handleStopAgent]);

  const handleApproveCommand = useCallback(
    (requestId) => {
      if (!activeTabId) return;
      const ws = socketsRef.current.get(activeTabId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'command_approval', request_id: requestId, approved: true }));
      }
      updateTab(activeTabId, { pendingApproval: null });
    },
    [activeTabId, updateTab]
  );

  const handleDenyCommand = useCallback(
    (requestId) => {
      if (!activeTabId) return;
      const ws = socketsRef.current.get(activeTabId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'command_approval', request_id: requestId, approved: false }));
      }
      updateTab(activeTabId, { pendingApproval: null });
    },
    [activeTabId, updateTab]
  );

  const handleStopPreview = useCallback(() => {
    if (!activeTabId) return;
    const ws = socketsRef.current.get(activeTabId);
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ action: 'stop_preview' }));
    }
    updateTab(activeTabId, { previewData: null });
  }, [activeTabId, updateTab]);

  const handleSelectBranch = useCallback(
    (branchName) => {
      if (!activeTabId) return;
      const ws = socketsRef.current.get(activeTabId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'switch_branch', branch_name: branchName }));
      }
    },
    [activeTabId]
  );

  const handleCreateBranch = useCallback(
    (branchName, fromStepId) => {
      if (!activeTabId || !activeTab) return;
      const ws = socketsRef.current.get(activeTabId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        const lastStep = activeTab.checkpointTimeline?.[activeTab.checkpointTimeline.length - 1]?.step_id;
        ws.send(
          JSON.stringify({
            action: 'create_branch',
            branch_name: branchName,
            from_step_id: fromStepId || lastStep || 'step_0',
          })
        );
      }
    },
    [activeTabId, activeTab]
  );

  const handleDeleteBranch = useCallback(
    (branchName) => {
      if (!activeTabId) return;
      const ws = socketsRef.current.get(activeTabId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action: 'delete_branch', branch_name: branchName }));
      }
    },
    [activeTabId]
  );

  const handleBranchFromStep = useCallback(
    (stepId, branchName, fromBranch) => {
      if (!activeTabId) return;
      const ws = socketsRef.current.get(activeTabId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            action: 'create_branch',
            branch_name: branchName,
            from_step_id: stepId,
            from_branch: fromBranch,
          })
        );
      }
    },
    [activeTabId]
  );

  return (
    <div className="app-container">
      {/* Unified Top Tab Bar with Home tab and Context Gauge */}
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        isHomeActive={currentView === 'welcome'}
        onSelectHome={() => setCurrentView('welcome')}
        onSelectTab={(tabId) => {
          setActiveTabId(tabId);
          setCurrentView('workspace');
        }}
        onCloseTab={handleCloseTab}
        onNewTab={() => setCurrentView('welcome')}
      />

      {currentView === 'welcome' && (
        <WelcomeView
          onSubmit={handleCreateProject}
          onConnectAndBuild={handleConnectAndBuild}
          onOpenProject={(proj) => handleOpenProject(proj)}
          onDeleteProject={handleDeleteProjectFromTabs}
          isTransitioning={isTransitioning}
          hardwareInfo={hardwareInfo}
          models={models}
          providers={providers}
          selectedModel={globalDefaultModel}
          onSelectModel={(mId) => {
            setGlobalDefaultModel(mId);
            localStorage.setItem('80degrees_selected_model', mId);
          }}
          onRefreshModels={fetchModelsAndHardware}
          prompt={welcomePrompt}
          onPromptChange={setWelcomePrompt}
        />
      )}

      {currentView === 'workspace' && activeTab && (
        <WorkspaceView
          key={activeTab.id}
          messages={activeTab.messages}
          onSendMessage={handleSendMessage}
          onToolResponse={handleToolResponse}
          isConnected={activeTab.isConnected}
          isAgentRunning={activeTab.agentStatus === 'generating'}
          agentStatus={activeTab.agentStatus}
          onClearStatus={() => updateTab(activeTab.id, { agentStatus: null })}
          previewData={activeTab.previewData}
          lastChangeTimestamp={activeTab.lastChangeTimestamp}
          onStopPreview={handleStopPreview}
          onGoBack={() => setCurrentView('welcome')}
          projectName={activeTab.projectName}
          pendingApproval={activeTab.pendingApproval}
          onApproveCommand={handleApproveCommand}
          onDenyCommand={handleDenyCommand}
          hardwareInfo={hardwareInfo}
          models={models}
          providers={providers}
          selectedModel={activeTab.model}
          onSelectModel={handleSelectModel}
          onRefreshModels={fetchModelsAndHardware}
          contextTelemetry={activeTab.contextTelemetry}
          onStopAgent={handleStopAgent}
          todoState={activeTab.todoState}
          checkpointTimeline={activeTab.checkpointTimeline}
          onRewindToStep={handleRewindToStep}
          input={activeTab.inputText || ''}
          onInputChange={(val) => updateTab(activeTab.id, { inputText: val })}
          activeBranch={activeTab.activeBranch || 'main'}
          branches={activeTab.branches || []}
          onSelectBranch={handleSelectBranch}
          onCreateBranch={handleCreateBranch}
          onDeleteBranch={handleDeleteBranch}
          onBranchFromStep={handleBranchFromStep}
        />
      )}
    </div>
  );
}
