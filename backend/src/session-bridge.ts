import * as path from "node:path";
import * as fsSync from "node:fs";
import {
  createAgentSession,
  SessionManager,
  AgentRegistry,
  USER_INTERRUPT_LABEL,
  type AgentSession,
  type MCPManager,
  type AuthStorage,
} from "../../pi-harness/packages/coding-agent/src/index";
import type { Model } from "../../pi-harness/packages/ai/src/index";
import type { AgentSessionEvent } from "../../pi-harness/packages/coding-agent/src/session/agent-session-events";
import type {
  ExtensionUIContext,
  ExtensionAskDialogQuestion,
  ExtensionAskDialogResult,
  ExtensionUISelectItem,
  ExtensionUIDialogOptions,
} from "../../pi-harness/packages/coding-agent/src/extensibility/extensions/types";
import { readPlanFile } from "../../pi-harness/packages/coding-agent/src/plan-mode/plan-files";
import { ensureThemeSync, theme as tuiTheme } from "../../pi-harness/packages/tui/src/theme/theme";
import { clearCache as clearFsCache } from "../../pi-harness/packages/coding-agent/src/capability/fs";
import { ChatHistoryManager } from "./chat-history";
import { CheckpointManager } from "./checkpoint-manager";
import type { ModelsService } from "./models-service";
import type { DevServerManager } from "./dev-server";
export type WebSocketSender = (message: Record<string, unknown>) => void;

export interface PromptImageAttachment {
  data: string; // base64 encoded string
  mimeType: string;
}

export interface PromptFileAttachment {
  name: string;
  content: string;
  mimeType?: string;
  size?: number;
}

export interface PromptAttachments {
  images?: PromptImageAttachment[];
  files?: PromptFileAttachment[];
}
export class SessionBridge {
  private session: AgentSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private activeProjectPath: string | null = null;
  private activeBranchName: string = "main";
  private activeModel: string = "gemini-3.8-flash";
  private isGenerating: boolean = false;
  private wasStoppedByUser: boolean = false;
  private initPromise: Promise<void> | null = null;
  private activeToolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();
  private activeTurns: Record<string, unknown>[] = [];
  private pendingUiRequests = new Map<string, { resolve: (val: unknown) => void; reject: (err: unknown) => void }>();
  private devServerUnsubscribe: (() => void) | null = null;
  private currentPreviewUrl: string | null = null;
  private lastPromptText: string = "";
  private mcpManager: MCPManager | null = null;
  private mcpStatusUnsubscribe: (() => void) | null = null;
  private turnHadError: boolean = false;
  private currentMode: "build" | "plan" = "build";
  private pendingPlanRequests = new Map<string, (result: { approved: boolean; feedback?: string }) => void>();

  constructor(
    private readonly send: WebSocketSender,
    private readonly modelsService?: ModelsService,
    private readonly devServerManager?: DevServerManager,
  ) {}
  getActiveModel(): string {
    return this.activeModel;
  }
  getActiveProjectPath(): string | null {
    return this.activeProjectPath;
  }
  getCurrentMode(): "build" | "plan" {
    return this.currentMode;
  }

  async setMode(mode: "build" | "plan"): Promise<void> {
    if (this.currentMode === mode) return;
    this.currentMode = mode;
    if (this.session) {
      if (mode === "plan") {
        this.session.setPlanModeState({
          enabled: true,
          planFilePath: "local://PLAN.md",
          workflow: "parallel",
        });
        this.session.setPlanProposalHandler(async (title: string) => {
          return await this.handlePlanProposal(title);
        });
      } else {
        this.session.setPlanModeState(undefined);
        this.session.setPlanProposalHandler(null);
        for (const [, resolve] of this.pendingPlanRequests.entries()) {
          resolve({ approved: false, feedback: "Plan mode exited by user." });
        }
        this.pendingPlanRequests.clear();
      }
    }
    this.send({
      type: "mode_changed",
      mode,
      timestamp: new Date().toISOString(),
    });
  }

  resolvePlanProposal(requestId: string, approved: boolean, feedback?: string): boolean {
    const resolve = this.pendingPlanRequests.get(requestId);
    if (!resolve) return false;
    this.pendingPlanRequests.delete(requestId);
    resolve({ approved, feedback });
    return true;
  }

  private async handlePlanProposal(title: string): Promise<{
    content: Array<{ type: "text"; text: string }>;
    details: { planFilePath: string; title: string; planExists: boolean };
  }> {
    if (!this.session) {
      throw new Error("No active session");
    }
    const sm = this.session.sessionManager;
    const localOptions = {
      getArtifactsDir: () => sm.getArtifactsDir(),
      getSessionId: () => sm.getSessionId(),
    };
    const details = await this.session.preparePlanForReview(title);
    const planFilePath = details.details?.planFilePath || "local://PLAN.md";
    const resolvedTitle = details.details?.title || title || "Plan";
    let planContent = "";
    try {
      planContent = (await readPlanFile(planFilePath, {
        localProtocolOptions: localOptions,
        cwd: this.activeProjectPath || sm.getCwd(),
      })) || "";
    } catch (err) {
      console.warn("[SessionBridge] Failed to read plan file content:", err);
    }

    const requestId = `plan_req_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    this.send({
      type: "plan_proposal_request",
      id: requestId,
      request_id: requestId,
      title: resolvedTitle,
      plan_path: planFilePath,
      plan_content: planContent,
      timestamp: new Date().toISOString(),
    });

    const { promise, resolve } = Promise.withResolvers<{ approved: boolean; feedback?: string }>();
    this.pendingPlanRequests.set(requestId, resolve);
    const response = await promise;

    if (!response.approved) {
      const feedback = response.feedback?.trim() || "Please refine the plan.";
      return {
        content: [
          {
            type: "text",
            text: `Plan refinement requested: ${feedback}\nUpdate the plan file, then write the plan slug to xd://propose again when ready.`,
          },
        ],
        details: { planFilePath, title: resolvedTitle, planExists: true },
      };
    }

    // Approved: exit plan mode and unlock full write/build access
    this.session.setPlanReferencePath(planFilePath);
    this.session.setPlanProposalHandler(null);
    this.session.setPlanModeState(undefined);
    this.currentMode = "build";
    this.send({
      type: "mode_changed",
      mode: "build",
      timestamp: new Date().toISOString(),
    });

    const approvedPrompt = [
      "Plan approved.",
      `Full plan inlined below; durable copy at ${planFilePath}.`,
      "Execute plan step-by-step with full tool access; MUST verify each step before next.",
      "Before execution: initialize todo tracking with todo.",
      "After each completed step: immediately update todo.",
      "",
      `<plan path="${planFilePath}">`,
      planContent,
      "</plan>",
    ].join("\n");

    setTimeout(() => {
      if (this.session) {
        this.prompt(approvedPrompt).catch((err) => {
          console.error("[SessionBridge] Failed to dispatch build prompt:", err);
        });
      }
    }, 150);

    return {
      content: [
        {
          type: "text",
          text: `Plan approved at ${planFilePath}. Plan mode exited; proceeding with implementation.`,
        },
      ],
      details: { planFilePath, title: resolvedTitle, planExists: true },
    };
  }
  getMcpStatus(): {
    servers: Array<{
      name: string;
      status: "connected" | "connecting" | "disconnected";
      config?: unknown;
      tools: Array<{ name: string; label?: string; description?: string }>;
    }>;
  } {
    if (!this.mcpManager) {
      return { servers: [] };
    }
    const allNames = this.mcpManager.getAllServerNames();
    const allTools = this.mcpManager.getTools();

    const servers = allNames.map((name) => {
      const status = this.mcpManager!.getConnectionStatus(name);
      const config = this.mcpManager!.getServerConfig(name);
      const serverTools = (allTools as unknown as Array<{
        name: string;
        label?: string;
        description?: string;
        mcpServerName?: string;
        details?: { serverName?: string };
      }>)
        .filter((t) => t.mcpServerName === name || t.details?.serverName === name)
        .map((t) => ({
          name: t.name,
          label: t.label || t.name,
          description: t.description || "",
        }));
      return {
        name,
        status,
        config,
        tools: serverTools,
      };
    });

    return { servers };
  }

  async reloadMcp(): Promise<{
    servers: Array<{
      name: string;
      status: "connected" | "connecting" | "disconnected";
      config?: unknown;
      tools: Array<{ name: string; label?: string; description?: string }>;
    }>;
  }> {
    if (this.initPromise) {
      await this.initPromise;
    }
    if (!this.mcpManager || !this.session) {
      return { servers: [] };
    }
    try {
      await this.mcpManager.disconnectAll();
      clearFsCache();
      await this.mcpManager.discoverAndConnect();
      await this.session.refreshMCPTools(this.mcpManager.getTools());
      const status = this.getMcpStatus();
      this.send({
        type: "mcp_status",
        ...status,
      });
      return status;
    } catch (err) {
      console.error("[SessionBridge] Failed to reload MCP tools:", err);
      throw err;
    }
  }

  private isProviderAuthenticated(providerId: string, authStorage: AuthStorage): boolean {
    const oauthMatch = this.modelsService?.oauthManager.getOAuthProviders().find(
      (p) => p.id === providerId || p.storeCredentialsAs === providerId
    );
    const targetId = oauthMatch?.storeCredentialsAs ?? providerId;
    const identity =
      authStorage.oauth.identity(targetId) ||
      (targetId !== providerId ? authStorage.oauth.identity(providerId) : undefined);

    const hasOAuth = Boolean(
      authStorage.credentials.hasOAuth(providerId) ||
        (targetId !== providerId && authStorage.credentials.hasOAuth(targetId)) ||
        identity
    );

    const storedApiKey =
      authStorage.credentials.get(providerId) ||
      (targetId !== providerId ? authStorage.credentials.get(targetId) : undefined);
    const hasVaultKey = Boolean(
      storedApiKey && storedApiKey.type === "api_key" && storedApiKey.key
    );

    const keySource = authStorage.keys.source(providerId);
    const hasRuntimeKey = Boolean(
      keySource?.concrete && (keySource.kind === "runtime" || keySource.kind === "config")
    );
    const hasEnvKey = Boolean(
      keySource?.concrete &&
        keySource.kind === "env" &&
        keySource.envVar &&
        Boolean(process.env[keySource.envVar])
    );

    const isLocalRunning = providerId === "ollama";
    return hasOAuth || hasVaultKey || hasRuntimeKey || hasEnvKey || isLocalRunning;
  }

  async resolveModel(modelName: string): Promise<Record<string, unknown> | undefined> {
    if (!this.modelsService) return undefined;
    const registry = await this.modelsService.getRegistry();
    const authStorage = await this.modelsService.getAuthStorage();

    // 1. If explicit provider is specified (provider/modelId), check if that provider has auth
    const slashIdx = modelName.indexOf("/");
    if (slashIdx > 0) {
      const provider = modelName.slice(0, slashIdx);
      const modelId = modelName.slice(slashIdx + 1);
      if (this.isProviderAuthenticated(provider, authStorage)) {
        const found = registry.find(provider, modelId);
        if (found) return found as unknown as Record<string, unknown>;
      }
    }

    // 2. Find all models matching modelName (by id, canonical_id, or provider/id)
    const allMatches = registry.getAll().filter((m) => {
      const canonical = "canonical_id" in m && typeof m.canonical_id === "string" ? m.canonical_id : undefined;
      return m.id === modelName || canonical === modelName || `${m.provider}/${m.id}` === modelName;
    });

    // 3. Filter strictly to providers for which the user HAS authenticated
    const authenticatedMatches = allMatches.filter((m) => this.isProviderAuthenticated(m.provider, authStorage));
    if (authenticatedMatches.length > 0) {
      return authenticatedMatches[0] as unknown as Record<string, unknown>;
    }
    // 4. Zero matching authenticated providers -> return undefined
    console.log(`[SessionBridge] No authenticated provider found for model "${modelName}".`);
    return undefined;
  }
  async setModel(modelName: string): Promise<void> {
    if (this.initPromise) {
      await this.initPromise.catch(() => {});
    }
    const resolved = await this.resolveModel(modelName);
    const targetModel = resolved
      ? ((resolved.canonical_id as string) || `${resolved.provider}/${resolved.id}`)
      : modelName;
    this.activeModel = targetModel;

    if (this.session && resolved) {
      try {
        await this.session.setModel(resolved as unknown as Model);
        console.log(`[SessionBridge] Switched active session model to ${this.activeModel}`);
        this.emitContextTelemetry();
        return;
      } catch (err) {
        console.warn("[SessionBridge] Direct session.setModel failed, recreating session with new model:", err);
      }
      if (this.activeProjectPath) {
        await this.openProject(this.activeProjectPath, this.activeModel);
      }
    } else if (this.activeProjectPath) {
      console.log(`[SessionBridge] Reviving session for project ${this.activeProjectPath} with model ${this.activeModel}`);
      await this.openProject(this.activeProjectPath, this.activeModel);
    }
  }

  getIsGenerating(): boolean {
    return this.isGenerating;
  }

  async openProject(projectPath: string, modelName?: string): Promise<void> {
    const requestedModel = modelName || this.activeModel;
    const resolved = await this.resolveModel(requestedModel);

    if (!resolved) {
      console.log(`[SessionBridge] openProject: No authenticated model available for "${requestedModel}". Session paused until credentials configured.`);
      this.activeModel = requestedModel;
      this.send({
        type: "auth_required",
        message: "No model provider has active credentials. Please connect an API key or log in with OAuth to activate the agent.",
      });
      return;
    }

    this.activeModel = (resolved.canonical_id as string) || `${resolved.provider}/${resolved.id}`;
    this.initPromise = (async () => {
      if (this.session) {
        if (this.isGenerating) {
          await this.session.abort().catch(() => {});
        }
        this.unsubscribe?.();
        this.unsubscribe = null;
        await this.session.dispose().catch(() => {});
        this.session = null;
        if (this.mcpStatusUnsubscribe) {
          this.mcpStatusUnsubscribe();
          this.mcpStatusUnsubscribe = null;
        }
        this.mcpManager = null;
      }

      this.activeProjectPath = projectPath;
      this.activeToolCalls.clear();

      // Load branch state and persisted chat history for active branch
      const branchState = await CheckpointManager.getBranches(projectPath).catch(() => null);
      if (branchState) {
        this.activeBranchName = branchState.active_branch || "main";
      }
      const history = await ChatHistoryManager.loadHistory(projectPath, this.activeBranchName);
      this.activeTurns = [...history.ui_events];
      CheckpointManager.ensureGitRepo(projectPath).catch(() => {});
      CheckpointManager.getCheckpoints(projectPath).then((steps) => {
        this.send({ type: "checkpoint_timeline", steps });
      }).catch(() => {});
      if (branchState) {
        this.send({
          type: "branch_state",
          active_branch: branchState.active_branch,
          branches: branchState.branches,
        });
      }
      try {
        const authStorage = this.modelsService ? await this.modelsService.getAuthStorage() : undefined;
        const modelRegistry = this.modelsService ? await this.modelsService.getRegistry() : undefined;

        const sessionManager = await SessionManager.continueRecent(projectPath);

        // Subscribe to devServer events to keep the agent's prompt in sync with real ports
        if (this.devServerManager && !this.devServerUnsubscribe) {
          this.devServerUnsubscribe = this.devServerManager.onEvent((event) => {
            if (event.type === "preview_ready" && event.project_path && this.activeProjectPath) {
              const resolvedEvent = path.resolve(event.project_path);
              const resolvedActive = path.resolve(this.activeProjectPath);
              if (resolvedEvent === resolvedActive && event.url) {
                this.handlePreviewReady(event.url, event.backend_port);
              }
            }
          });
        }

        const devServer = this.devServerManager?.getServerInfo(projectPath);
        const previewPort = devServer?.port ?? 3000;
        const previewUrl = devServer?.url ?? `http://127.0.0.1:${previewPort}`;
        this.currentPreviewUrl = previewUrl;
        const appendSystemPrompt = this.buildPreviewSystemPrompt(previewUrl, devServer?.backend_port);
        const { session, setToolUIContext, mcpManager } = await createAgentSession({
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
        this.mcpManager = mcpManager ?? null;
        if (this.currentMode === "plan") {
          session.setPlanModeState({
            enabled: true,
            planFilePath: "local://PLAN.md",
            workflow: "parallel",
          });
          session.setPlanProposalHandler(async (title: string) => {
            return await this.handlePlanProposal(title);
          });
        }
        if (this.mcpManager) {
          this.mcpStatusUnsubscribe = this.mcpManager.addConnectionStatusListener((evt) => {
            this.send({
              type: "mcp_status_update",
              event: evt,
              status: this.getMcpStatus(),
            });
          });
        }

        ensureThemeSync();
        const uiContext: ExtensionUIContext = {
          timeoutStartsOnPresentation: true,
          select: async (title: string, options: ExtensionUISelectItem[], dialogOptions?: ExtensionUIDialogOptions) => {
            const id = `sel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const optionLabels = options.map((opt) => (typeof opt === "string" ? opt : opt.label));
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
              resolve: (val: unknown) => {
                cleanup();
                const selected = typeof val === "string"
                  ? val
                  : (val && typeof val === "object" && "label" in val && typeof (val as { label: unknown }).label === "string"
                      ? (val as { label: string }).label
                      : String(val ?? ""));
                resolve(selected || undefined);
              },
              reject: (err: unknown) => {
                cleanup();
                reject(err instanceof Error ? err : new Error(String(err)));
              },
            });
            return promise;
          },
          confirm: async (title: string, message: string, _dialogOptions?: ExtensionUIDialogOptions) => {
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
              resolve: (val: unknown) => {
                this.pendingUiRequests.delete(id);
                resolve(val === "Approve" || val === "Yes" || val === true);
              },
              reject: (err: unknown) => {
                this.pendingUiRequests.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
              },
            });
            return promise;
          },
          askDialog: async (questions: ExtensionAskDialogQuestion[], _dialogOptions?: ExtensionUIDialogOptions) => {
            const id = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const timestamp = new Date().toISOString();
            const primaryQ = questions[0];

            this.send({
              type: "ask_human",
              id,
              question: primaryQ?.question ?? "Please clarify:",
              options: primaryQ?.options?.map((o) => o.label) ?? [],
              questions: questions.map((q) => ({
                id: q.id,
                question: q.question,
                header: q.header,
                options: q.options.map((o) => o.label),
                multi: Boolean(q.multi),
                recommended: q.recommended,
              })),
              timestamp,
            });
            const { promise, resolve, reject } = Promise.withResolvers<ExtensionAskDialogResult | undefined>();
            this.pendingUiRequests.set(id, {
              resolve: (val: unknown) => {
                this.pendingUiRequests.delete(id);
                const answerList: string[] = Array.isArray(val)
                  ? val.map(String)
                  : typeof val === "string"
                  ? [val]
                  : (val && typeof val === "object" && "label" in val && typeof (val as { label: unknown }).label === "string"
                      ? [(val as { label: string }).label]
                      : []);

                resolve({
                  kind: "submit",
                  results: questions.map((q) => ({
                    id: q.id,
                    question: q.question,
                    options: q.options.map((o) => o.label),
                    multi: q.multi ?? false,
                    selectedOptions: answerList.length > 0 ? answerList : [q.options[q.recommended ?? 0]?.label ?? ""],
                    customInput: typeof val === "string" && !q.options.some((o) => o.label === val) ? val : undefined,
                    timedOut: false,
                  })),
                });
              },
              reject: (err: unknown) => {
                this.pendingUiRequests.delete(id);
                reject(err instanceof Error ? err : new Error(String(err)));
              },
            });
            return promise;
          },
          input: async () => undefined,
          notify: (msg: string, type?: "info" | "warning" | "error") => this.send({ type: "notice", message: msg, level: type }),
          onTerminalInput: () => () => {},
          setStatus: () => {},
          setWorkingMessage: (msg?: string) => this.send({ type: "status", content: msg || "Running" }),
          setWidget: () => {},
          setFooter: () => {},
          setHeader: () => {},
          setTitle: () => {},
          custom: async <T>() => {
            throw new Error("Custom UI not supported in web bridge");
          },
          setEditorText: () => {},
          pasteToEditor: () => {},
          getEditorText: () => "",
          editor: async () => undefined,
          addAutocompleteProvider: () => {},
          setEditorComponent: () => {},
          theme: tuiTheme,
          getAllThemes: async () => [],
          getTheme: async () => undefined,
          setTheme: async () => ({ success: true }),
          getToolsExpanded: () => false,
          setToolsExpanded: () => {},
        };
        setToolUIContext?.(uiContext, true);

        console.log(`[SessionBridge] Initialized AgentSession for ${projectPath} with model ${session.model?.id}`);
        this.emitContextTelemetry();
        this.send({
          type: "mcp_status",
          ...this.getMcpStatus(),
        });
      } catch (err) {
        console.error(`[SessionBridge] Failed to create AgentSession:`, err);
        const errorMsg = err instanceof Error ? err.message : String(err);
        this.send({
          type: "status",
          content: `Harness Error: ${errorMsg}`,
        });
        this.send({
          type: "assistant_error",
          error: errorMsg,
          message: `Failed to initialize agent: ${errorMsg}`,
        });
      }
    })();

    await this.initPromise;
  }

  async prompt(promptText: string, attachments?: PromptAttachments): Promise<void> {
    if (this.initPromise) {
      await this.initPromise.catch(() => {});
    }

    // Ensure the latest preview server URL is synchronized before dispatching prompt
    if (this.activeProjectPath && this.devServerManager) {
      const activeDevServer = this.devServerManager.getServerInfo(this.activeProjectPath);
      const activeUrl = activeDevServer?.url || this.currentPreviewUrl;
      if (activeUrl && activeUrl !== this.currentPreviewUrl) {
        this.handlePreviewReady(activeUrl);
      }
    }

    const session = this.session;
    if (!session) {
      this.send({
        type: "auth_required",
        message: "Authentication required: No model provider has active credentials. Please connect an API key or log in with OAuth to activate the agent.",
      });
      this.send({
        type: "assistant_error",
        error: "No active credentials",
        message: "⚠️ **No Provider Connected**\n\nNo model is currently unlocked with valid credentials.\n\n👉 **To fix this**: Click the **Model Selector (`✦`)** at the bottom of the chat and connect your provider (OAuth or API key).",
      });
      return;
    }

    if (this.isGenerating) {
      this.wasStoppedByUser = true;
      await session.abort({ reason: USER_INTERRUPT_LABEL }).catch(() => {});
    }

    this.wasStoppedByUser = false;
    this.turnHadError = false;
    this.isGenerating = true;
    this.lastPromptText = promptText;
    // Record user message in UI events with any attached media
    const now = new Date().toISOString();
    const userMsg: Record<string, unknown> = {
      role: "user",
      content: promptText,
      timestamp: now,
    };
    if (attachments?.images && attachments.images.length > 0) {
      userMsg.images = attachments.images;
    }
    if (attachments?.files && attachments.files.length > 0) {
      userMsg.files = attachments.files;
    }

    this.activeTurns.push(userMsg);
    if (this.activeProjectPath) {
      await ChatHistoryManager.appendEvent(this.activeProjectPath, userMsg, this.activeBranchName);
    }

    this.send({
      type: "status",
      content: "Running",
      timestamp: now,
    });

    // Prepare prompt text with non-image file attachments if any
    let fullPromptText = promptText;
    if (attachments?.files && attachments.files.length > 0) {
      const fileSections = attachments.files
        .map((f) => `--- Attached File: ${f.name} ---\n${f.content}\n--- End Attached File ---`)
        .join("\n\n");
      fullPromptText = fullPromptText ? `${fullPromptText}\n\n${fileSections}` : fileSections;
    }

    // Format ImageContent blocks for pi-harness vision models
    const images = (attachments?.images ?? []).map((img) => ({
      type: "image" as const,
      data: img.data,
      mimeType: img.mimeType,
    }));

    try {
      await session.prompt(fullPromptText || "Analyze the attached media and proceed.", {
        images: images.length > 0 ? images : undefined,
      });
    } catch (err) {
      if (!this.wasStoppedByUser) {
        this.turnHadError = true;
        const errText = err instanceof Error ? err.message : String(err);
        let friendlyNotice = errText;
        if (
          errText.includes("No API key found") ||
          errText.includes("unauthorized") ||
          errText.includes("authentication")
        ) {
          friendlyNotice = `⚠️ **Authentication Required**\n\n${errText}\n\n👉 **To fix this**: Open the **Model Selector** (✦) and either connect your provider with OAuth (Claude, ChatGPT, Copilot) or enter an API key, or switch to an authenticated model.`;
        } else if (
          errText.includes("Individual quota reached") ||
          errText.includes("QUOTA_EXHAUSTED") ||
          (errText.includes("429") && errText.includes("Cloud Code Assist"))
        ) {
          const matchReset = errText.match(/Resets in ([^."\n]+)/);
          const resetNotice = matchReset ? ` (resets in ${matchReset[1]})` : "";
          friendlyNotice = `⚠️ **Google Antigravity Quota Limit Reached**\n\nYour weekly quota for third-party models (Claude / GPT) on Google Antigravity has been exhausted${resetNotice}.\n\n👉 **To fix this**: Switch to **Gemini 3.8 Flash** or **Gemini 2.5 Flash** (which have active quota), or connect directly with an Anthropic / OpenAI API key in the Model Selector (✦).`;
        } else if (
          errText.includes("No capacity available for model") ||
          (errText.includes("503") && errText.includes("Cloud Code Assist"))
        ) {
          friendlyNotice = `⚠️ **Google Antigravity Server Busy**\n\nGoogle's Antigravity server is temporarily out of capacity for this model.\n\n👉 **To fix this**: Switch to **Gemini 3.8 Flash** (active & available) in the Model Selector (✦).`;
        } else {
          friendlyNotice = `⚠️ **Agent Error**\n\n${errText}`;
        }
        const errorAssistantMsg = {
          role: "assistant",
          content: friendlyNotice,
          is_error: true,
          timestamp: new Date().toISOString(),
        };
        this.activeTurns.push(errorAssistantMsg);
        if (this.activeProjectPath) {
          ChatHistoryManager.appendEvent(
            this.activeProjectPath,
            errorAssistantMsg,
            this.activeBranchName
          ).catch(() => {});
        }
        this.send({
          type: "assistant_error",
          message: errorAssistantMsg,
          error: errText,
          timestamp: errorAssistantMsg.timestamp,
        });
        this.send({
          type: "status",
          content: `Error: ${errText}`,
          timestamp: errorAssistantMsg.timestamp,
        });
      }
    } finally {
      this.isGenerating = false;
    }
  }

  resolveUiRequest(id: string, response: unknown): boolean {
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

    if (this.session) {
      this.wasStoppedByUser = true;
      this.isGenerating = false;
      this.send({
        type: "status",
        content: "Stopped: Agent execution stopped by user.",
      });
      await this.session.abort({ reason: USER_INTERRUPT_LABEL }).catch(() => {});
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

  async rewindToStep(
    stepId: string,
    mode: "code_and_messages" | "messages_only" = "code_and_messages",
  ): Promise<boolean> {
    if (!this.activeProjectPath) return false;
    const projectPath = this.activeProjectPath;
    const rollbackCode = mode === "code_and_messages";

    if (this.isGenerating && this.session) {
      this.wasStoppedByUser = true;
      await this.session.abort({ reason: USER_INTERRUPT_LABEL }).catch(() => {});
      this.isGenerating = false;
    }

    try {
      const rewindResult = await CheckpointManager.rewindToStep(projectPath, stepId, { rollbackCode });
      const prunedEvents = await ChatHistoryManager.pruneHistoryAfter(
        projectPath,
        stepId,
        rewindResult.targetStep.timestamp,
      );
      this.activeTurns = [...prunedEvents];

      // Re-prime AgentSession on rewound tree
      if (this.session) {
        if (
          rollbackCode &&
          rewindResult.targetStep.entry_id &&
          this.session.sessionManager?.getEntry?.(rewindResult.targetStep.entry_id)
        ) {
          await this.session.navigateTree(rewindResult.targetStep.entry_id, { summarize: false }).catch(() => {});
        } else {
          await this.session.dispose().catch(() => {});
          this.session = null;
          await this.openProject(projectPath, this.activeModel);
        }
      }

      this.send({
        type: "chat_history_loaded",
        project: path.basename(projectPath),
        messages: prunedEvents,
        is_rewind: true,
      });

      this.send({
        type: "checkpoint_timeline",
        steps: rewindResult.remainingSteps,
      });

      this.send({
        type: "rewind_completed",
        step_id: stepId,
        mode,
        messages: prunedEvents,
        timestamp: new Date().toISOString(),
      });

      if (rollbackCode) {
        this.send({
          type: "file_changed",
          timestamp: Date.now(),
        });
      }

      return true;
    } catch (err) {
      console.error("[SessionBridge] Rewind failed:", err);
      this.send({
        type: "error",
        content: `Rewind failed: ${err instanceof Error ? err.message : String(err)}`,
      });
      return false;
    }
  }

  async createBranch(branchName: string, fromStepId: string, fromBranch?: string): Promise<boolean> {
    if (!this.activeProjectPath) return false;
    if (this.isGenerating) {
      throw new Error("Cannot create branch while agent is generating");
    }

    const projectPath = this.activeProjectPath;
    const currentBranch = fromBranch || this.activeBranchName;
    const leafId = this.session?.sessionManager?.getLeafId?.() ?? null;

    const newBranch = await CheckpointManager.createBranch(projectPath, branchName, fromStepId, leafId, fromBranch);
    this.activeBranchName = newBranch.name;
    const branchEvents = await ChatHistoryManager.branchHistory(
      projectPath,
      currentBranch,
      newBranch.name,
      fromStepId,
    );
    this.activeTurns = [...branchEvents];

    if (this.session && newBranch.leaf_entry_id) {
      if (this.session.sessionManager?.getEntry?.(newBranch.leaf_entry_id)) {
        await this.session.navigateTree(newBranch.leaf_entry_id, { summarize: false }).catch(() => {});
      }
    }

    const branchState = await CheckpointManager.getBranches(projectPath);
    this.send({
      type: "branch_state",
      active_branch: branchState.active_branch,
      branches: branchState.branches,
    });
    this.send({
      type: "chat_history_loaded",
      project: path.basename(projectPath),
      messages: this.activeTurns,
    });
    this.send({
      type: "file_changed",
      file: "*",
      timestamp: Date.now(),
    });
    return true;
  }

  async switchBranch(branchName: string): Promise<boolean> {
    if (!this.activeProjectPath) return false;
    if (this.isGenerating) {
      throw new Error("Cannot switch branch while agent is generating");
    }

    const projectPath = this.activeProjectPath;
    const currentBranch = this.activeBranchName;
    const leafId = this.session?.sessionManager?.getLeafId?.() ?? null;

    if (leafId) {
      await CheckpointManager.updateBranchLeaf(projectPath, currentBranch, leafId);
    }

    const target = await CheckpointManager.switchBranch(projectPath, branchName);
    this.activeBranchName = target.name;

    const history = await ChatHistoryManager.loadHistory(projectPath, target.name);
    this.activeTurns = [...history.ui_events];

    if (this.session && target.leaf_entry_id) {
      if (this.session.sessionManager?.getEntry?.(target.leaf_entry_id)) {
        await this.session.navigateTree(target.leaf_entry_id, { summarize: false }).catch(() => {});
      }
    }

    const branchState = await CheckpointManager.getBranches(projectPath);
    this.send({
      type: "branch_state",
      active_branch: branchState.active_branch,
      branches: branchState.branches,
    });
    this.send({
      type: "chat_history_loaded",
      project: path.basename(projectPath),
      messages: this.activeTurns,
    });
    this.send({
      type: "file_changed",
      file: "*",
      timestamp: Date.now(),
    });
    return true;
  }

  async deleteBranch(branchName: string): Promise<boolean> {
    if (!this.activeProjectPath) return false;
    await CheckpointManager.deleteBranch(this.activeProjectPath, branchName);
    const branchState = await CheckpointManager.getBranches(this.activeProjectPath);
    this.send({
      type: "branch_state",
      active_branch: branchState.active_branch,
      branches: branchState.branches,
    });
    return true;
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
        if (msg && msg.role === "assistant") {
          if (msg.stopReason === "aborted") {
            this.wasStoppedByUser = true;
          }
          if (msg.stopReason === "error") {
            this.turnHadError = true;
            const candidateMsg = msg as unknown as { errorMessage?: string };
            const errMsg = candidateMsg.errorMessage || "An error occurred during model generation.";
            let friendlyError = `⚠️ **Model Error**: ${errMsg}`;
            if (
              errMsg.includes("Individual quota reached") ||
              errMsg.includes("QUOTA_EXHAUSTED") ||
              (errMsg.includes("429") && errMsg.includes("Cloud Code Assist"))
            ) {
              const matchReset = errMsg.match(/Resets in ([^."\n]+)/);
              const resetNotice = matchReset ? ` (resets in ${matchReset[1]})` : "";
              friendlyError = `⚠️ **Google Antigravity Quota Limit Reached**\n\nYour weekly quota for third-party models (Claude / GPT) on Google Antigravity has been reached${resetNotice}.\n\n👉 **To continue**: Switch to **Gemini 3.8 Flash** or **Gemini 2.5 Flash** in the Model Selector (✦), or connect an Anthropic / OpenAI API key directly.`;
            } else if (
              errMsg.includes("No capacity available for model") ||
              (errMsg.includes("503") && errMsg.includes("Cloud Code Assist"))
            ) {
              friendlyError = `⚠️ **Google Antigravity Server Busy**\n\nGoogle's Antigravity server is temporarily out of capacity for this model.\n\n👉 **To continue**: Switch to **Gemini 3.8 Flash** (active & available) in the Model Selector (✦).`;
            } else if (
              errMsg.includes("Requested entity was not found") ||
              (errMsg.includes("404") && errMsg.includes("Cloud Code Assist"))
            ) {
              friendlyError = `⚠️ **Google Antigravity Model Unavailable**\n\nThis model is no longer available on Google Antigravity.\n\n👉 **To continue**: Switch to **Gemini 3.8 Flash** or **Gemini 2.5 Flash** in the Model Selector (✦).`;
            }
            const errorMsg = {
              role: "assistant",
              content: friendlyError,
              is_error: true,
              timestamp,
            };
            if (this.activeProjectPath) {
              ChatHistoryManager.appendEvent(
                this.activeProjectPath,
                errorMsg,
                this.activeBranchName
              ).catch(() => {});
            }
            this.send({
              type: "assistant_error",
              message: errorMsg,
              error: errMsg,
              timestamp,
            });
            this.send({
              type: "status",
              content: `Error: ${errMsg}`,
              timestamp,
            });
          }
          if (Array.isArray(msg.content)) {
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
                ChatHistoryManager.appendEvent(this.activeProjectPath, assistantMsg, this.activeBranchName).catch(() => {});
              }
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
          ChatHistoryManager.appendEvent(this.activeProjectPath, toolCallMsg, this.activeBranchName).catch(() => {});
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
          ChatHistoryManager.appendEvent(this.activeProjectPath, toolResultMsg, this.activeBranchName).catch(() => {});
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
          if (filePath && this.activeProjectPath) {
            const resolvedPath = path.isAbsolute(filePath)
              ? filePath
              : path.join(this.activeProjectPath, filePath);
            try {
              fsSync.utimesSync(resolvedPath, new Date(), new Date());
            } catch {}

            const normPath = filePath.replace(/\\/g, "/");
            if (
              normPath.includes("server/") ||
              normPath.endsWith("server.js") ||
              normPath.endsWith("server.ts") ||
              normPath.endsWith("package.json")
            ) {
              this.devServerManager?.ensureBackendRunning(this.activeProjectPath).catch((err) => {
                console.warn("[SessionBridge] Error checking backend after file change:", err);
              });
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
        const wasStopped = this.wasStoppedByUser;
        const hadError = this.turnHadError;
        this.wasStoppedByUser = false;
        this.turnHadError = false;
        this.isGenerating = false;
        if (wasStopped) {
          this.send({
            type: "status",
            content: "Stopped: Agent execution stopped by user.",
            timestamp,
          });
        } else if (hadError) {
          console.log("[SessionBridge] Agent turn ended with error, skipping 'Done' status");
        } else {
          this.send({
            type: "status",
            content: "Done",
            timestamp,
          });
        }
        this.emitContextTelemetry();

        // Commit snapshot checkpoint when turn finishes
        if (!wasStopped && this.activeProjectPath) {
          (async () => {
            try {
              const leafId = this.session?.sessionManager?.getLeafId?.() ?? null;
              const checkpoint = await CheckpointManager.createCheckpoint(
                this.activeProjectPath!,
                this.lastPromptText || "App update",
                leafId,
              );
              if (checkpoint) {
                // Stamp step_id on the last turn event
                if (this.activeTurns.length > 0) {
                  const lastMsg = this.activeTurns[this.activeTurns.length - 1];
                  lastMsg.step_id = checkpoint.step_id;
                  await ChatHistoryManager.saveHistory(this.activeProjectPath!, this.activeTurns, this.activeBranchName);
                  if (leafId) {
                    await CheckpointManager.updateBranchLeaf(this.activeProjectPath!, this.activeBranchName, leafId);
                  }
                }
                const steps = await CheckpointManager.getCheckpoints(this.activeProjectPath!);
                this.send({
                  type: "checkpoint_timeline",
                  steps,
                });
                this.send({
                  type: "step_checkpoint_created",
                  step: checkpoint,
                  step_id: checkpoint.step_id,
                });
              }
            } catch (err) {
              console.error("[SessionBridge] Error committing checkpoint:", err);
            }
          })();
        }
        break;
      }
    }
  }

  async dispose(): Promise<void> {
    for (const [, req] of this.pendingUiRequests.entries()) {
      req.reject(new Error("Session disposed"));
    }
    this.pendingUiRequests.clear();
    for (const [, resolve] of this.pendingPlanRequests.entries()) {
      resolve({ approved: false, feedback: "Session disposed" });
    }
    this.pendingPlanRequests.clear();

    if (this.session) {
      this.unsubscribe?.();
      this.unsubscribe = null;
      await this.session.dispose().catch(() => {});
      this.session = null;
    }
    if (this.mcpStatusUnsubscribe) {
      this.mcpStatusUnsubscribe();
      this.mcpStatusUnsubscribe = null;
    }
    this.mcpManager = null;
    this.devServerUnsubscribe?.();
    this.devServerUnsubscribe = null;
  }

  private buildPreviewSystemPrompt(previewUrl: string, backendPort?: number | null): string {
    const lines = [
      `# Managed Development Server & Live Preview Environment`,
      `- A managed Vite dev server is ALREADY active for this project at ${previewUrl}.`,
      `- Automatic Hot Module Replacement (HMR) is active: writing or editing files in src/ immediately updates the live preview iframe.`,
    ];
    if (backendPort) {
      lines.push(
        `- A managed API backend server is ALREADY active for this project at http://127.0.0.1:${backendPort}.`,
        `- Frontend requests to '/api/*' are automatically proxied by Vite to http://127.0.0.1:${backendPort}.`,
        `- Backend code in server/index.js (or server/) automatically reloads when modified.`,
      );
    } else {
      lines.push(
        `- Fullstack capability: If you create backend API endpoints (e.g., in server/index.js), the platform automatically detects, launches, and proxies them through '/api/*'.`,
      );
    }
    lines.push(
      `- DO NOT attempt to run dev servers in bash (never execute npm run dev, bun dev, vite, or node server); dev servers are fully managed by the workspace.`,
      `- DO NOT alter port settings in vite.config.js or package.json.`,
      ``,
      `## CRITICAL NETWORK & PORT RULES (MANDATORY):`,
      `1. FRONTEND API CALLS: ALWAYS use relative paths starting with '/api' (e.g. fetch('/api/items') or axios.get('/api/users')).`,
      `   - NEVER hardcode absolute backend URLs (e.g. NEVER write fetch('http://localhost:5001/api/...'), fetch('http://127.0.0.1:...'), or any fixed port).`,
      `   - The Vite dev server automatically proxies all '/api/*' requests to the active backend port. Hardcoded URLs break when the project is reopened on dynamic ports.`,
      `2. BACKEND SERVER LISTEN PORT: When creating or editing backend servers (Express, Fastify, Node http, etc.):`,
      `   - ALWAYS read the port dynamically from environment variables: const PORT = process.env.BACKEND_PORT || process.env.PORT || 5001;`,
      `   - ALWAYS listen on that variable: app.listen(PORT, '0.0.0.0', ...);`,
      `   - NEVER hardcode a static port number in app.listen(). The workspace dynamically assigns free ports to prevent port conflicts.`,
      `3. DEV SERVER LIFECYCLE: Do not run dev servers in bash or alter port settings in vite.config.js or package.json.`,
      `4. BRAND ATTRIBUTION (MANDATORY): The project template contains a mandatory "Made on 80degrees" badge chip (#made-on-80degrees) in index.html. DO NOT remove, hide, alter, or cover this badge when editing index.html or application styles.`
    );
    return lines.join("\n");
  }

  private handlePreviewReady(newUrl: string, backendPort?: number | null): void {
    this.currentPreviewUrl = newUrl;
    console.log(`[SessionBridge] Updated live preview URL to ${newUrl}${backendPort ? ` (backend: ${backendPort})` : ""}`);

    const agent = this.session?.agent;
    if (agent) {
      try {
        const currentPrompts: string[] = agent.state?.systemPrompt ?? [];
        const newPromptSection = this.buildPreviewSystemPrompt(newUrl, backendPort);

        let replaced = false;
        const updated = currentPrompts.map((p) => {
          if (p.includes("# Managed Development Server & Live Preview Environment")) {
            replaced = true;
            return newPromptSection;
          }
          return p;
        });

        if (!replaced) {
          updated.push(newPromptSection);
        }

        agent.setSystemPrompt(updated);
      } catch (err) {
        console.warn("[SessionBridge] Could not update agent system prompt dynamically:", err);
      }
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
