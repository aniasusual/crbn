import {
  createAgentSession,
  SessionManager,
  type AgentSession,
} from "../../pi-harness/packages/coding-agent/src/index";
import { ChatHistoryManager } from "./chat-history";

export type WebSocketSender = (message: Record<string, unknown>) => void;

export class SessionBridge {
  private session: AgentSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private activeProjectPath: string | null = null;
  private activeModel: string = "gemini-2.5-flash";
  private isGenerating: boolean = false;
  private initPromise: Promise<void> | null = null;
  private activeToolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();
  private activeTurns: Record<string, unknown>[] = [];

  constructor(private readonly send: WebSocketSender) {}

  getActiveModel(): string {
    return this.activeModel;
  }

  setModel(modelName: string): void {
    this.activeModel = modelName;
  }

  getIsGenerating(): boolean {
    return this.isGenerating;
  }

  async openProject(projectPath: string, modelName?: string): Promise<void> {
    if (modelName) {
      this.activeModel = modelName;
    }

    this.initPromise = (async () => {
      if (this.session) {
        if (this.isGenerating) {
          await this.session.abort().catch(() => {});
        }
        this.unsubscribe?.();
        this.unsubscribe = null;
        await this.session.dispose().catch(() => {});
        this.session = null;
      }

      this.activeProjectPath = projectPath;
      this.activeToolCalls.clear();

      // Load persisted chat history for this project
      const history = await ChatHistoryManager.loadHistory(projectPath);
      this.activeTurns = [...history.ui_events];

      try {
        const { session } = await createAgentSession({
          cwd: projectPath,
          modelPattern: this.activeModel,
          sessionManager: SessionManager.create(projectPath),
        });

        this.session = session;
        this.unsubscribe = session.subscribe(event => this.handleSessionEvent(event));

        console.log(`[SessionBridge] Initialized AgentSession for ${projectPath} with model ${session.model?.id}`);
      } catch (err) {
        console.error(`[SessionBridge] Failed to create AgentSession:`, err);
        this.send({
          type: "status",
          content: `Harness Error: ${err instanceof Error ? err.message : String(err)}`,
        });
      }
    })();

    await this.initPromise;
  }

  async prompt(promptText: string): Promise<void> {
    if (this.initPromise) {
      await this.initPromise;
    }

    if (!this.session) {
      this.send({
        type: "status",
        content: "Harness Error: No active session. Please open a project first.",
      });
      return;
    }

    if (this.isGenerating) {
      await this.session.abort().catch(() => {});
    }

    this.isGenerating = true;

    // Record user message in UI events
    const now = new Date().toISOString();
    const userMsg = {
      role: "user",
      content: promptText,
      timestamp: now,
    };
    this.activeTurns.push(userMsg);
    if (this.activeProjectPath) {
      await ChatHistoryManager.appendEvent(this.activeProjectPath, userMsg);
    }

    try {
      await this.session.prompt(promptText);
    } catch (err) {
      console.error(`[SessionBridge] Error executing prompt:`, err);
      this.send({
        type: "status",
        content: `Harness Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      this.isGenerating = false;
    }
  }

  async stop(): Promise<void> {
    if (this.session && this.isGenerating) {
      await this.session.abort().catch(() => {});
      this.isGenerating = false;
      this.send({
        type: "status",
        content: "Stopped: Agent execution stopped by user.",
      });
    }
  }

  async clear(): Promise<void> {
    if (this.activeProjectPath) {
      await ChatHistoryManager.clearHistory(this.activeProjectPath);
      this.activeTurns = [];
      this.send({
        type: "chat_history_loaded",
        project: this.activeProjectPath,
        messages: [],
      });
      this.send({
        type: "status",
        content: "Session context reset.",
      });
    }
  }

  private handleSessionEvent(event: AgentSessionEvent): void {
    const timestamp = new Date().toISOString();

    switch (event.type) {
      case "message_update": {
        const assistantEvt = event.assistantMessageEvent;
        if (assistantEvt.type === "text_delta") {
          this.send({
            type: "token",
            content: assistantEvt.delta,
            timestamp,
          });
        } else if (assistantEvt.type === "thinking_delta") {
          this.send({
            type: "thinking",
            content: assistantEvt.delta,
            timestamp,
          });
        }
        break;
      }

      case "tool_execution_start": {
        const toolArgs = (event.args && typeof event.args === "object" ? event.args : {}) as Record<string, unknown>;
        this.activeToolCalls.set(event.toolCallId, { name: event.toolName, args: toolArgs });

        const toolCallMsg = {
          type: "tool_call",
          id: event.toolCallId,
          name: event.toolName,
          arguments: toolArgs,
          timestamp,
        };
        this.activeTurns.push(toolCallMsg);
        if (this.activeProjectPath) {
          ChatHistoryManager.appendEvent(this.activeProjectPath, toolCallMsg).catch(() => {});
        }

        this.send(toolCallMsg);

        // Special handling for ask human
        if (event.toolName === "ask") {
          const questions = (toolArgs.questions as Array<{ question?: string; options?: Array<{ label: string }> }>) ?? [];
          const primaryQ = questions[0];
          this.send({
            type: "ask_human",
            question: primaryQ?.question ?? "Please clarify:",
            options: primaryQ?.options ?? [],
            id: event.toolCallId,
            timestamp,
          });
        }

        // Special handling for todo tool
        if (event.toolName === "todo") {
          this.send({
            type: "todo_update",
            op: toolArgs.op ?? "view",
            phases: Array.isArray(toolArgs.list) ? toolArgs.list : [],
            timestamp,
          });
        }

        // Special handling for task subagent tool
        if (event.toolName === "task") {
          this.send({
            type: "subagent_event",
            subagent: (toolArgs.name as string) ?? "task",
            event: "start",
            task: (toolArgs.task as string) ?? "",
            id: event.toolCallId,
            timestamp,
          });
        }
        break;
      }

      case "tool_execution_end": {
        const cachedCall = this.activeToolCalls.get(event.toolCallId);
        const resultString =
          typeof event.result === "string"
            ? event.result
            : JSON.stringify(event.result ?? "");

        const toolResultMsg = {
          type: "tool_result",
          id: event.toolCallId,
          name: event.toolName,
          result: resultString,
          is_error: Boolean(event.isError),
          timestamp,
        };
        this.activeTurns.push(toolResultMsg);
        if (this.activeProjectPath) {
          ChatHistoryManager.appendEvent(this.activeProjectPath, toolResultMsg).catch(() => {});
        }

        this.send(toolResultMsg);

        // Notify file modification for live reload
        if (event.toolName === "write" || event.toolName === "edit") {
          const filePath = (cachedCall?.args?.path as string) ?? "*";
          this.send({
            type: "file_changed",
            file: filePath,
            timestamp,
          });
        }

        // Subagent finish
        if (event.toolName === "task") {
          this.send({
            type: "subagent_event",
            subagent: (cachedCall?.args?.name as string) ?? "task",
            event: "finish",
            status: event.isError ? "failed" : "completed",
            result: resultString,
            id: event.toolCallId,
            timestamp,
          });
        }
        break;
      }

      case "auto_compaction_start": {
        this.send({
          type: "status",
          content: "Compacting conversation context...",
          timestamp,
        });
        break;
      }

      case "auto_compaction_end": {
        this.send({
          type: "compaction_divider",
          summary: "Context automatically compacted to preserve memory headroom.",
          timestamp,
        });
        break;
      }

      case "agent_end": {
        this.isGenerating = false;
        this.send({
          type: "status",
          content: "Done",
          timestamp,
        });

        // Emit telemetry update
        const contextWindow = this.session?.model?.contextWindow ?? 1_000_000;
        this.send({
          type: "context_telemetry",
          telemetry: {
            context_window: contextWindow,
            total_tokens: 1500,
            usage_pct: 15,
            compact_threshold_pct: 80,
            squash_threshold_pct: 70,
            status: "normal",
          },
          timestamp,
        });
        break;
      }
    }
  }

  async dispose(): Promise<void> {
    if (this.session) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      await this.session.dispose().catch(() => {});
      this.session = null;
    }
  }
}
