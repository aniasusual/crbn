import * as path from "node:path";
import {
  createAgentSession,
  SessionManager,
  AgentRegistry,
  type AgentSession,
} from "../../pi-harness/packages/coding-agent/src/index";
import type { AgentSessionEvent } from "../../pi-harness/packages/coding-agent/src/session/agent-session-events";
import { ChatHistoryManager } from "./chat-history";
import type { ModelsService } from "./models-service";
import type { DevServerManager } from "./dev-server";
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
  private pendingUiRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void }>();

  constructor(
    private readonly send: WebSocketSender,
    private readonly modelsService?: ModelsService,
    private readonly devServerManager?: DevServerManager,
  ) {}
  getActiveModel(): string {
    return this.activeModel;
  }

  async setModel(modelName: string): Promise<void> {
    this.activeModel = modelName;
    if (this.initPromise) {
      await this.initPromise;
    }
    if (this.session && this.modelsService) {
      try {
        const registry = await this.modelsService.getRegistry();
        const parts = modelName.split("/");
        let found = parts.length === 2 ? registry.find(parts[0], parts[1]) : undefined;
        if (!found) {
          found = registry.getAll().find(m => m.id === modelName || `${m.provider}/${m.id}` === modelName);
        }
        if (found && this.session) {
          await this.session.setModel(found);
          console.log(`[SessionBridge] Switched active session model to ${found.provider}/${found.id}`);
          this.emitContextTelemetry();
        }
      } catch (err) {
        console.warn("[SessionBridge] Failed to switch model on active session:", err);
      }
    }
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
        const authStorage = this.modelsService ? await this.modelsService.getAuthStorage() : undefined;
        const modelRegistry = this.modelsService ? await this.modelsService.getRegistry() : undefined;

        const sessionManager = await SessionManager.continueRecent(projectPath);
        const devServer = this.devServerManager?.getServerInfo(projectPath);
        const previewPort = devServer?.port ?? 3000;
        const previewUrl = devServer?.url ?? `http://127.0.0.1:${previewPort}`;
        const appendSystemPrompt = [
          `# Managed Development Server & Live Preview Environment`,
          `- A managed Vite dev server is ALREADY active for this project at ${previewUrl}.`,
          `- Automatic Hot Module Replacement (HMR) is active: writing or editing files in src/ immediately updates the live preview iframe.`,
          `- DO NOT attempt to run dev servers in bash (never execute npm run dev, bun dev, vite, or node server).`,
          `- DO NOT alter port settings in vite.config.js or package.json.`,
        ].join("\n");

        const { session, setToolUIContext } = await createAgentSession({
          cwd: projectPath,
          modelPattern: this.activeModel,
          sessionManager,
          authStorage,
          modelRegistry,
          interactivePrompts: true,
          appendSystemPrompt,
          agentRegistry: new AgentRegistry(),
          agentId: `agent_${path.basename(projectPath)}`,
        });
        this.session = session;
        this.unsubscribe = session.subscribe(event => this.handleSessionEvent(event));

        setToolUIContext?.({
          timeoutStartsOnPresentation: true,
          select: async (title, options, dialogOptions) => {
            const id = `sel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const optionLabels = options.map(opt => (typeof opt === "string" ? opt : opt.label));
            const isApproval = optionLabels.includes("Approve") && optionLabels.includes("Deny");
            const timestamp = new Date().toISOString();

            if (isApproval) {
              this.send({
                type: "command_approval_request",
                id,
                request_id: id,
                command: title,
                options: optionLabels,
                timestamp,
              });
            } else {
              this.send({
                type: "ask_human",
                id,
                question: title,
                options: optionLabels,
                questions: [{ id: "q1", question: title, options: optionLabels }],
                timestamp,
              });
            }
            const { promise, resolve, reject } = Promise.withResolvers<string | undefined>();
            const cleanup = () => {
              this.pendingUiRequests.delete(id);
              signal?.removeEventListener("abort", onAbort);
            };
            const signal = dialogOptions?.signal;
            const onAbort = () => {
              cleanup();
              reject(new Error("Operation cancelled"));
            };
            signal?.addEventListener("abort", onAbort, { once: true });

            this.pendingUiRequests.set(id, {
              resolve: (val: any) => {
                cleanup();
                const selected = typeof val === "string" ? val : val?.label ?? String(val ?? "");
                resolve(selected || undefined);
              },
              reject: (err: any) => {
                cleanup();
                reject(err);
              },
            });
            return promise;
          },
          confirm: async (title, message, dialogOptions) => {
            const id = `conf_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const timestamp = new Date().toISOString();
            this.send({
              type: "command_approval_request",
              id,
              request_id: id,
              command: `${title}${message ? `\n${message}` : ""}`,
              options: ["Approve", "Deny"],
              timestamp,
            });

            const { promise, resolve, reject } = Promise.withResolvers<boolean>();
            this.pendingUiRequests.set(id, {
              resolve: (val: any) => {
                this.pendingUiRequests.delete(id);
                resolve(val === "Approve" || val === "Yes" || val === true);
              },
              reject: (err: any) => {
                this.pendingUiRequests.delete(id);
                reject(err);
              },
            });
            return promise;
          },
          askDialog: async (questions, dialogOptions) => {
            const id = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const timestamp = new Date().toISOString();
            const primaryQ = questions[0];

            this.send({
              type: "ask_human",
              id,
              question: primaryQ?.question ?? "Please clarify:",
              options: primaryQ?.options?.map(o => o.label) ?? [],
              questions: questions.map(q => ({
                id: q.id,
                question: q.question,
                header: q.header,
                options: q.options.map(o => o.label),
                multi: Boolean(q.multi),
                recommended: q.recommended,
              })),
              timestamp,
            });
            const { promise, resolve, reject } = Promise.withResolvers<any>();
            this.pendingUiRequests.set(id, {
              resolve: (val: any) => {
                this.pendingUiRequests.delete(id);
                const answerList = Array.isArray(val)
                  ? val
                  : typeof val === "string"
                  ? [val]
                  : val?.label
                  ? [val.label]
                  : [];

                resolve({
                  kind: "submit",
                  results: questions.map(q => ({
                    id: q.id,
                    question: q.question,
                    options: q.options.map(o => o.label),
                    multi: q.multi ?? false,
                    selectedOptions: answerList.length > 0 ? answerList : [q.options[q.recommended ?? 0]?.label ?? ""],
                    customInput: typeof val === "string" && !q.options.some(o => o.label === val) ? val : undefined,
                    timedOut: false,
                  })),
                });
              },
              reject: (err: any) => {
                this.pendingUiRequests.delete(id);
                reject(err);
              },
            });
            return promise;
          },
          input: async () => undefined,
          notify: (msg, type) => this.send({ type: "notice", message: msg, level: type }),
          onTerminalInput: () => () => {},
          setStatus: () => {},
          setWorkingMessage: msg => this.send({ type: "status", content: msg || "Running" }),
          setWidget: () => {},
          setFooter: () => {},
          setHeader: () => {},
          setTitle: () => {},
          custom: async () => undefined as any,
          editor: async () => undefined,
        }, true);

        console.log(`[SessionBridge] Initialized AgentSession for ${projectPath} with model ${session.model?.id}`);
        this.emitContextTelemetry();
      } catch (err) {
        console.error(`[SessionBridge] Failed to create AgentSession:`, err);
        this.send({
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

    const session = this.session;
    if (!session) {
      this.send({
        type: "status",
        content: "Harness Error: No active session. Please open a project first.",
      });
      return;
    }

    if (this.isGenerating) {
      await session.abort().catch(() => {});
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

    this.send({
      type: "status",
      content: "Running",
      timestamp: now,
    });

    try {
      await session.prompt(promptText);
    } catch (err) {
      this.send({
        type: "status",
        content: `Harness Error: ${err instanceof Error ? err.message : String(err)}`,
      });
    } finally {
      this.isGenerating = false;
    }
  }

  resolveUiRequest(id: string, response: any): boolean {
    const pending = this.pendingUiRequests.get(id);
    if (pending) {
      pending.resolve(response);
      this.pendingUiRequests.delete(id);
      return true;
    }
    for (const [key, val] of this.pendingUiRequests.entries()) {
      if (key.includes(id) || id.includes(key)) {
        val.resolve(response);
        this.pendingUiRequests.delete(key);
        return true;
      }
    }
    return false;
  }

  async stop(): Promise<void> {
    for (const [, req] of this.pendingUiRequests.entries()) {
      req.reject(new Error("Agent execution stopped by user."));
    }
    this.pendingUiRequests.clear();

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
      if (this.session) {
        try {
          await this.session.newSession();
        } catch (err) {
          console.warn("[SessionBridge] Failed to reset AgentSession to new session:", err);
        }
      }
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
      this.emitContextTelemetry();
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

      case "message_end": {
        const msg = event.message;
        if (msg && msg.role === "assistant" && Array.isArray(msg.content)) {
          let text = "";
          for (const block of msg.content) {
            if (
              block &&
              typeof block === "object" &&
              "type" in block &&
              block.type === "text" &&
              "text" in block &&
              typeof block.text === "string"
            ) {
              text += block.text;
            }
          }
          if (text.trim().length > 0) {
            const assistantMsg: Record<string, unknown> = {
              role: "assistant",
              content: text,
              timestamp,
            };
            this.activeTurns.push(assistantMsg);
            if (this.activeProjectPath) {
              ChatHistoryManager.appendEvent(this.activeProjectPath, assistantMsg).catch(() => {});
            }
          }
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
        const structuredResult = {
          content: event.result?.content ?? [{ type: "text", text: String(event.result ?? "") }],
          details: event.result?.details ?? undefined,
          isError: Boolean(event.isError),
        };

        const toolResultMsg = {
          type: "tool_result",
          id: event.toolCallId,
          name: event.toolName,
          arguments: cachedCall?.args ?? {},
          result: structuredResult,
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
          let filePath: string | null =
            (cachedCall?.args?.path as string) ?? (cachedCall?.args?.file_path as string) ?? null;
          if (!filePath && typeof cachedCall?.args?.input === "string") {
            const match = /\[([^#\]\s]+)#/.exec(cachedCall.args.input);
            if (match) filePath = match[1];
          }
          if (!filePath && event.result?.details && typeof event.result.details === "object") {
            const details = event.result.details as Record<string, unknown>;
            if (typeof details.path === "string") {
              filePath = details.path;
            } else if (Array.isArray(details.perFileResults) && details.perFileResults[0]?.path) {
              filePath = details.perFileResults[0].path;
            }
          }
          this.send({
            type: "file_changed",
            file: filePath ?? "*",
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
            result: structuredResult,
            id: event.toolCallId,
            timestamp,
          });
        }
        break;
      }

      case "auto_compaction_start": {
        break;
      }

      case "auto_compaction_end": {
        if (event.result?.summary) {
          this.send({
            type: "compaction_divider",
            summary: event.result.summary,
            timestamp,
          });
        }
        this.emitContextTelemetry();
        break;
      }

      case "model_changed": {
        this.emitContextTelemetry();
        break;
      }

      case "agent_end": {
        this.isGenerating = false;
        this.send({
          type: "status",
          content: "Done",
          timestamp,
        });
        this.emitContextTelemetry();
        break;
      }
    }
  }

  async dispose(): Promise<void> {
    for (const [, req] of this.pendingUiRequests.entries()) {
      req.reject(new Error("Session disposed"));
    }
    this.pendingUiRequests.clear();

    if (this.session) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      await this.session.dispose().catch(() => {});
      this.session = null;
    }
  }
  private emitContextTelemetry(): void {
    if (!this.session) return;
    const usage = this.session.getContextUsage();
    const breakdown = this.session.getContextBreakdown() as Record<string, unknown> | undefined;
    const contextWindow = usage?.contextWindow ?? this.session.model?.contextWindow ?? 1_000_000;
    const totalTokens = usage?.tokens ?? 0;
    const usagePct = usage?.percent !== undefined ? Math.round(usage.percent * 10) / 10 : Math.round((totalTokens / contextWindow) * 100);

    const staticTokens = Number(breakdown?.systemPromptTokens ?? 0);
    const schemaTokens = Number(breakdown?.systemToolsTokens ?? 0);
    const virtualRamTokens = Number(breakdown?.skillsTokens ?? 0);
    const providerPromptTokens = Number(breakdown?.messagesTokens ?? 0);

    this.send({
      type: "context_telemetry",
      telemetry: {
        context_window: contextWindow,
        total_tokens: totalTokens,
        usage_pct: usagePct,
        compact_threshold_pct: 80,
        squash_threshold_pct: 70,
        status: usagePct >= 80 ? "critical" : usagePct >= 70 ? "warning" : "normal",
        static_tokens: staticTokens,
        schema_tokens: schemaTokens,
        virtual_ram_tokens: virtualRamTokens,
        provider_prompt_tokens: providerPromptTokens,
        virtual_ram_files: 0,
        squashed: false,
        evicted: false,
        rolled_up: false,
      },
      timestamp: new Date().toISOString(),
    });
  }
}
