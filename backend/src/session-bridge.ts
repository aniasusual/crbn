import * as path from "node:path";
import * as fsSync from "node:fs";
import {
  createAgentSession,
  SessionManager,
  AgentRegistry,
  USER_INTERRUPT_LABEL,
  type AgentSession,
  type MCPManager,
  type SessionInfo,
} from "../../pi-harness/packages/coding-agent/src/index";
import type { Model } from "../../pi-harness/packages/ai/src/index";
import type { AgentSessionEvent } from "../../pi-harness/packages/coding-agent/src/session/agent-session-events";
import type {
  ExtensionUIContext,
  ExtensionAskDialogQuestion,
  ExtensionAskDialogResult,
  ExtensionFormDialogResult,
  ExtensionUISelectItem,
  ExtensionUIDialogOptions,
} from "../../pi-harness/packages/coding-agent/src/extensibility/extensions/types";
import {
  parseHtmlForm,
  spansText,
  type ChoiceOption,
  type FormField,
} from "../../pi-harness/packages/tui/src/html-form/parse";
import {
  choiceValue,
  defaultFormData,
  fieldQuestions,
  textValue,
} from "../../pi-harness/packages/tui/src/html-form/data";
import { readPlanFile } from "../../pi-harness/packages/coding-agent/src/plan-mode/plan-files";
import { ensureThemeSync, theme as tuiTheme } from "../../pi-harness/packages/tui/src/theme/theme";
import { clearCache as clearFsCache } from "../../pi-harness/packages/coding-agent/src/capability/fs";
import { clearPluginRootsAndCaches } from "../../pi-harness/packages/coding-agent/src/discovery/helpers";
import { PluginsService } from "./plugins-service";
import { createMarketplaceExtension } from "./marketplace-extension";
import type { UnifiedPlugin } from "./plugins-types";
import { AttachmentService, type RawAttachment } from "./attachment-service";
import { ChatHistoryManager } from "./chat-history";
import { CheckpointManager } from "./checkpoint-manager";
import type { ModelsService } from "./models-service";
import type { DevServerManager } from "./dev-server";
import { telemetry } from "./telemetry-service";
export type WebSocketSender = (message: Record<string, unknown>) => void;
export interface PromptImageAttachment {
  data: string; // base64 encoded string
  mimeType: string;
}
export interface PromptVideoAttachment {
  name: string;
  data?: string;
  path?: string;
  mimeType?: string;
  size?: number;
  thumbnailUrl?: string;
}

export interface PromptFileAttachment {
  name: string;
  content?: string;
  data?: string;
  path?: string;
  mimeType?: string;
  size?: number;
}

export interface PromptAttachments {
  images?: PromptImageAttachment[];
  videos?: PromptVideoAttachment[];
  files?: PromptFileAttachment[];
}
function hasNestedTodo(details: unknown): boolean {
  if (!details || typeof details !== "object") return false;
  const rec = details as Record<string, unknown>;
  return (
    Array.isArray(rec.statusEvents) &&
    rec.statusEvents.some(
      (ev) =>
        ev &&
        typeof ev === "object" &&
        (ev as Record<string, unknown>).op === "todo" &&
        (ev as Record<string, unknown>).committed === true,
    )
  );
}

export class SessionBridge {
  private session: AgentSession | null = null;
  private unsubscribe: (() => void) | null = null;
  private activeProjectPath: string | null = null;
  private activeSessionId: string | null = null;
  private activeSessionFile: string | null = null;
  private activeBranchName: string = "main";
  private activeModel: string = "gemini-3.8-flash";
  private isGenerating: boolean = false;
  private wasStoppedByUser: boolean = false;
  private initPromise: Promise<void> | null = null;
  private activeToolCalls = new Map<string, { name: string; args: Record<string, unknown> }>();
  private activeTurns: Record<string, unknown>[] = [];
  private pendingUiRequests = new Map<string, { resolve: (val: unknown) => void; reject: (err: unknown) => void }>();
  private pendingAskRequest: Record<string, unknown> | null = null;
  private lastAskFormResults: Array<Record<string, unknown>> | null = null;
  private devServerUnsubscribe: (() => void) | null = null;
  private currentPreviewUrl: string | null = null;
  private lastPromptText: string = "";
  private mcpManager: MCPManager | null = null;
  private mcpStatusUnsubscribe: (() => void) | null = null;
  private turnHadError: boolean = false;
  private turnErrorMessage: string | null = null;
  private pluginsService: PluginsService = new PluginsService();
  private attachmentService: AttachmentService = new AttachmentService();
  private currentMode: "build" | "plan" = "build";
  private pendingPlanRequests = new Map<string, (result: { approved: boolean; feedback?: string }) => void>();
  private dispatchedPrompts = new Set<string>();
  private pendingFollowUps: Array<{ fullPromptText: string; promptText: string; attachments?: PromptAttachments }> = [];

  constructor(
    private readonly send: WebSocketSender,
    private readonly modelsService?: ModelsService,
    private readonly devServerManager?: DevServerManager,
  ) {}
  get isRunning(): boolean {
    return this.isGenerating;
  }

  getActiveModel(): string {
    return this.activeModel;
  }
  getActiveProjectPath(): string | null {
    return this.activeProjectPath;
  }
  getActiveTurns(): Record<string, unknown>[] {
    return this.activeTurns;
  }
  getActiveSessionId(): string | null {
    return this.activeSessionId;
  }
  getActiveSessionFile(): string | null {
    return this.activeSessionFile;
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
        this.session
          .followUp(approvedPrompt, undefined, { synthetic: true })
          .catch((err) => {
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

  async reloadPlugins(): Promise<{ count: number; plugins: UnifiedPlugin[] }> {
    if (this.initPromise) {
      await this.initPromise;
    }
    clearPluginRootsAndCaches(this.activeProjectPath ? [this.activeProjectPath] : undefined);
    if (this.session) {
      await this.session.refreshSkillsAndCommands().catch((err) => {
        console.warn("[SessionBridge] Failed to refresh skills and commands:", err);
      });
      await this.session.refreshBaseSystemPrompt().catch((err) => {
        console.warn("[SessionBridge] Failed to refresh base system prompt:", err);
      });
      if (this.mcpManager) {
        await this.reloadMcp().catch((err) => {
          console.warn("[SessionBridge] Failed to reload MCP during plugin reload:", err);
        });
      }
    }
    const plugins = await this.pluginsService.listInstalledPlugins(this.activeProjectPath ?? undefined);
    this.send({
      type: "plugins_status",
      plugins,
      timestamp: Date.now(),
    });
    return { count: plugins.filter((p) => p.enabled).length, plugins };
  }

  async getPluginsStatus(): Promise<UnifiedPlugin[]> {
    return this.pluginsService.listInstalledPlugins(this.activeProjectPath ?? undefined);
  }

  async resolveModel(modelName: string): Promise<Record<string, unknown> | undefined> {
    if (!this.modelsService) {
      return { id: modelName, provider: "default", canonical_id: modelName };
    }
    const registry = await this.modelsService.getRegistry();

    // 1. If explicit provider is specified (provider/modelId), validate concrete auth (including keyless/local)
    const slashIdx = modelName.indexOf("/");
    if (slashIdx > 0) {
      const provider = modelName.slice(0, slashIdx);
      const modelId = modelName.slice(slashIdx + 1);
      if (registry.hasConcreteAuth(provider)) {
        let found = registry.find(provider, modelId);
        if (!found) {
          if (registry.getDiscoverableProviders().includes(provider)) {
            await registry.refreshDiscoverableProviders([provider], "online").catch(() => {});
          } else if (provider === "vllm" || provider === "litellm") {
            await registry.refreshProvider(provider, "online").catch(() => {});
          }
          found = registry.find(provider, modelId);
        }
        if (found) return found as unknown as Record<string, unknown>;
      }
    }

    // 2. Find all models matching modelName (by id, canonical_id, or provider/id)
    let allMatches = registry.getAll().filter((m) => {
      const canonical = "canonical_id" in m && typeof m.canonical_id === "string" ? m.canonical_id : undefined;
      return m.id === modelName || canonical === modelName || `${m.provider}/${m.id}` === modelName;
    });

    // 3. Filter to providers with concrete auth (OAuth, API key, models.yml config, auth: none, or local engines)
    let authenticatedMatches = allMatches.filter((m) => registry.hasConcreteAuth(m.provider));

    // 4. Lazy refresh for local engines started after initial ModelRegistry load
    if (authenticatedMatches.length === 0) {
      const localProviders = registry
        .getDiscoverableProviders()
        .filter((p) => p === "ollama" || p === "llama.cpp" || p === "lm-studio");
      if (localProviders.length > 0) {
        await registry.refreshDiscoverableProviders(localProviders, "online").catch(() => {});
        allMatches = registry.getAll().filter((m) => {
          const canonical = "canonical_id" in m && typeof m.canonical_id === "string" ? m.canonical_id : undefined;
          return m.id === modelName || canonical === modelName || `${m.provider}/${m.id}` === modelName;
        });
        authenticatedMatches = allMatches.filter((m) => registry.hasConcreteAuth(m.provider));
      }
    }

    if (authenticatedMatches.length > 0) {
      return authenticatedMatches[0] as unknown as Record<string, unknown>;
    }

    // 5. Zero matching authenticated/keyless providers -> return undefined
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
  async refreshProviderIfActive(providerId: string): Promise<void> {
    const target = providerId.trim().toLowerCase();
    if (!target || !this.session) return;
    const sessionProvider = this.session.model?.provider?.toLowerCase();
    const activePrefix = `${target}/`;
    const isMatch = sessionProvider === target || this.activeModel.toLowerCase().startsWith(activePrefix);
    if (!isMatch || this.isGenerating) return;

    const resolved = await this.resolveModel(this.activeModel);
    if (resolved) {
      try {
        await this.session.setModel(resolved as unknown as Model);
        this.emitContextTelemetry();
        return;
      } catch (err) {
        console.warn("[SessionBridge] Failed to hot-reload model, reopening project session:", err);
      }
      if (this.activeProjectPath) {
        await this.openProject(this.activeProjectPath, this.activeModel);
      }
      return;
    }

    // Active custom provider was removed: tear down stale session cleanly and prompt user to re-select
    this.unsubscribe?.();
    this.unsubscribe = null;
    await this.session.dispose().catch(() => {});
    this.session = null;
    this.send({
      type: "auth_required",
      message: `Provider "${providerId}" was removed. Select another model to continue.`,
    });
  }

  getIsGenerating(): boolean {
    return this.isGenerating;
  }

  async openProject(projectPath: string, modelName?: string, targetSessionId?: string): Promise<void> {
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
      this.pendingAskRequest = null;
      for (const [, pendingReq] of this.pendingUiRequests.entries()) {
        pendingReq.reject(new Error("Project session reopened"));
      }
      this.pendingUiRequests.clear();

      // Resolve sessionManager for specified targetSessionId, or continue recent session
      let sessionManager: SessionManager;
      if (targetSessionId) {
        const sessions = await SessionManager.list(projectPath);
        const match = sessions.find((s) => s.id === targetSessionId || s.path === targetSessionId);
        if (match && fsSync.existsSync(match.path)) {
          sessionManager = await SessionManager.open(match.path);
        } else {
          sessionManager = await SessionManager.continueRecent(projectPath);
        }
      } else {
        sessionManager = await SessionManager.continueRecent(projectPath);
      }
      await sessionManager.ensureOnDisk().catch(() => {});
      this.activeSessionId = sessionManager.getSessionId() || null;
      this.activeSessionFile = sessionManager.getSessionFile() || null;
      // Load branch state and persisted chat history for active branch and active session
      const branchState = await CheckpointManager.getBranches(projectPath).catch(() => null);
      if (branchState) {
        this.activeBranchName = branchState.active_branch || "main";
      }
      const history = await ChatHistoryManager.loadHistory(projectPath, this.activeBranchName, { sessionId: this.activeSessionId || undefined });
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

        // sessionManager already initialized above
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
        const appendSystemPrompt = [
          this.buildPreviewSystemPrompt(previewUrl, devServer?.backend_port),
          this.buildMarketplaceSystemPrompt(),
        ].join("\n\n");
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
          extensions: [
            createMarketplaceExtension({
              pluginsService: this.pluginsService,
              getProjectPath: () => this.activeProjectPath || projectPath,
              onReloadPlugins: async () => {
                await this.reloadPlugins();
              },
              onReloadMcp: async () => {
                await this.reloadMcp();
              },
            }),
          ],
        });
        this.session = session;
        this.activeSessionId = session.sessionId || sessionManager.getSessionId() || null;
        this.activeSessionFile = session.sessionFile || sessionManager.getSessionFile() || null;
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
        this.pluginsService.listInstalledPlugins(projectPath).then((plugins) => {
          this.send({
            type: "plugins_status",
            plugins,
            timestamp: Date.now(),
          });
        }).catch((err) => {
          console.warn("[SessionBridge] Failed to fetch initial plugins status:", err);
        });

        ensureThemeSync();
        const uiContext: ExtensionUIContext = {
          timeoutStartsOnPresentation: true,
          select: async (title: string, options: ExtensionUISelectItem[], dialogOptions?: ExtensionUIDialogOptions) => {
            const id = `sel_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const normalizedOptions = options.map((opt) =>
              typeof opt === "string"
                ? { label: opt }
                : { label: opt.label, ...(opt.description ? { description: opt.description } : {}) }
            );
            const optionLabels = normalizedOptions.map((o) => o.label);
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
              const askPayload = {
                type: "ask_human",
                id,
                question: title,
                options: normalizedOptions,
                questions: [{ id: "q1", question: title, options: normalizedOptions, multi: false }],
                timestamp,
              };
              this.pendingAskRequest = askPayload;
              this.send(askPayload);
            }
            const { promise, resolve, reject } = Promise.withResolvers<string | undefined>();
            const signal = dialogOptions?.signal;
            const cleanup = () => {
              this.pendingUiRequests.delete(id);
              signal?.removeEventListener("abort", onAbort);
              if (!isApproval && this.pendingAskRequest?.id === id) {
                this.pendingAskRequest = null;
                this.send({ type: "ask_resolved", id });
              }
            };
            const onAbort = () => {
              cleanup();
              reject(new Error("Operation cancelled"));
            };
            signal?.addEventListener("abort", onAbort, { once: true });

            this.pendingUiRequests.set(id, {
              resolve: (val: unknown) => {
                cleanup();
                if (val === null || val === undefined) {
                  resolve(undefined);
                  return;
                }
                if (typeof val === "object") {
                  const kindVal = "kind" in val && typeof val.kind === "string" ? val.kind : undefined;
                  if (kindVal === "cancel" || kindVal === "chat") {
                    resolve(undefined);
                    return;
                  }
                  if ("answers" in val && val.answers && typeof val.answers === "object" && "q1" in val.answers) {
                    const q1 = val.answers.q1;
                    if (q1 && typeof q1 === "object") {
                      const firstOpt =
                        "selectedOptions" in q1 && Array.isArray(q1.selectedOptions) && typeof q1.selectedOptions[0] === "string"
                          ? q1.selectedOptions[0]
                          : undefined;
                      const customVal =
                        "customInput" in q1 && typeof q1.customInput === "string" ? q1.customInput : undefined;
                      resolve(firstOpt || customVal || undefined);
                      return;
                    }
                  }
                  if ("label" in val && typeof val.label === "string") {
                    resolve(val.label || undefined);
                    return;
                  }
                }
                const selected = typeof val === "string" ? val : String(val ?? "");
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
          askDialog: async (questions: ExtensionAskDialogQuestion[], dialogOptions?: ExtensionUIDialogOptions) => {
            const id = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const timestamp = new Date().toISOString();
            const primaryQ = questions[0];
            const serializedQuestions = questions.map((q) => ({
              id: q.id,
              question: q.question,
              ...(q.header ? { header: q.header } : {}),
              options: q.options.map((o) => ({
                label: o.label,
                ...(o.description ? { description: o.description } : {}),
                ...(o.preview ? { preview: o.preview } : {}),
              })),
              multi: Boolean(q.multi),
              ...(q.recommended !== undefined ? { recommended: q.recommended } : {}),
            }));

            const askPayload = {
              type: "ask_human",
              id,
              question: primaryQ?.question ?? "Please clarify:",
              options: serializedQuestions[0]?.options ?? [],
              questions: serializedQuestions,
              timestamp,
            };
            this.pendingAskRequest = askPayload;
            this.send(askPayload);

            const { promise, resolve, reject } = Promise.withResolvers<ExtensionAskDialogResult | undefined>();
            const signal = dialogOptions?.signal;
            const cleanup = () => {
              this.pendingUiRequests.delete(id);
              signal?.removeEventListener("abort", onAbort);
              if (this.pendingAskRequest?.id === id) {
                this.pendingAskRequest = null;
                this.send({ type: "ask_resolved", id });
              }
            };
            const onAbort = () => {
              cleanup();
              reject(new Error("Ask input was cancelled"));
            };
            if (signal?.aborted) {
              onAbort();
              return promise;
            }
            signal?.addEventListener("abort", onAbort, { once: true });

            this.pendingUiRequests.set(id, {
              resolve: (val: unknown) => {
                cleanup();
                if (val === null || val === undefined) {
                  resolve(undefined);
                  return;
                }
                if (typeof val === "object" && !Array.isArray(val)) {
                  const kindVal = "kind" in val && typeof val.kind === "string" ? val.kind : undefined;
                  if (kindVal === "cancel") {
                    resolve(undefined);
                    return;
                  }
                  if (kindVal === "chat") {
                    resolve({ kind: "chat" });
                    return;
                  }
                  if ("answers" in val && val.answers && typeof val.answers === "object") {
                    const answersMap = val.answers as Record<string, unknown>;
                    resolve({
                      kind: "submit",
                      results: questions.map((q) => {
                        const rawEntry = Object.hasOwn(answersMap, q.id) ? answersMap[q.id] : undefined;
                        const entryObj = rawEntry && typeof rawEntry === "object" ? rawEntry : undefined;
                        const selectedOptions =
                          entryObj && "selectedOptions" in entryObj && Array.isArray(entryObj.selectedOptions)
                            ? entryObj.selectedOptions.map(String).filter(Boolean)
                            : [];
                        const rawCustom =
                          entryObj && "customInput" in entryObj && typeof entryObj.customInput === "string"
                            ? entryObj.customInput.trim()
                            : "";
                        const customInput = rawCustom.length > 0 ? rawCustom : undefined;
                        const fallbackSelected =
                          selectedOptions.length === 0 && customInput === undefined && !q.multi
                            ? [q.options[q.recommended ?? 0]?.label ?? ""].filter(Boolean)
                            : selectedOptions;
                        return {
                          id: q.id,
                          question: q.question,
                          options: q.options.map((o) => o.label),
                          multi: q.multi ?? false,
                          selectedOptions: fallbackSelected,
                          ...(customInput !== undefined ? { customInput } : {}),
                          timedOut: false,
                        };
                      }),
                    });
                    return;
                  }
                }

                const answerList: string[] = Array.isArray(val)
                  ? val.map(String)
                  : typeof val === "string"
                  ? [val]
                  : val && typeof val === "object" && "label" in val && typeof val.label === "string"
                  ? [val.label]
                  : [];
                resolve({
                  kind: "submit",
                  results: questions.map((q) => ({
                    id: q.id,
                    question: q.question,
                    options: q.options.map((o) => o.label),
                    multi: q.multi ?? false,
                    selectedOptions: answerList.length > 0 ? answerList : [q.options[q.recommended ?? 0]?.label ?? ""].filter(Boolean),
                    customInput: typeof val === "string" && !q.options.some((o) => o.label === val) ? val : undefined,
                    timedOut: false,
                  })),
                });
              },
              reject: (err: unknown) => {
                cleanup();
                reject(err instanceof Error ? err : new Error(String(err)));
              },
            });
            return promise;
          },
          formDialog: async (html: string, dialogOptions?: ExtensionUIDialogOptions) => {
            const id = `ask_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
            const timestamp = new Date().toISOString();
            const form = parseHtmlForm(html);
            const questionsMap = fieldQuestions(form);
            const sectionTitleByField = new Map<FormField, string>();
            for (const section of form.sections) {
              const secTitle = section.fieldset ? spansText(section.title).replace(/\s+/g, " ").trim() : "";
              if (!secTitle) continue;
              for (const block of section.blocks) {
                if (block.kind === "field") {
                  sectionTitleByField.set(block.field, secTitle);
                }
              }
            }

            interface ChoiceOptionDisplay {
              label: string;
              fullText: string;
              value: string;
              description?: string;
              preview?: string;
            }
            const parseChoiceOptionDisplay = (opt: ChoiceOption): ChoiceOptionDisplay => {
              const spans = opt.label;
              let preview: string | undefined;
              let bodySpans = spans;
              if (spans.length > 1 && spans[spans.length - 1]?.style === "code") {
                const leadingText = spansText(spans.slice(0, -1)).trim();
                if (leadingText.length > 0) {
                  preview = spans[spans.length - 1]!.text.trim() || undefined;
                  bodySpans = spans.slice(0, -1);
                }
              }
              const fullText = spansText(bodySpans).replace(/\s+/g, " ").trim() || opt.value;
              const colonIdx = fullText.indexOf(": ");
              if (colonIdx > 0) {
                const label = fullText.slice(0, colonIdx).trim();
                const description = fullText.slice(colonIdx + 2).trim();
                return {
                  label: label || fullText,
                  fullText,
                  value: opt.value,
                  ...(description ? { description } : {}),
                  ...(preview ? { preview } : {}),
                };
              }
              return {
                label: fullText,
                fullText,
                value: opt.value,
                ...(preview ? { preview } : {}),
              };
            };

            const namedFields = form.fields.filter((f) => Boolean(f.name));
            const fieldMeta = namedFields.map((field) => {
              const qText = questionsMap.get(field) ?? field.name;
              const header = sectionTitleByField.get(field);
              if (field.kind === "choice") {
                const enabled = field.options.flatMap((opt, index) =>
                  opt.disabled ? [] : [{ index, opt, display: parseChoiceOptionDisplay(opt) }],
                );
                const checkedIdx = enabled.findIndex((e) => e.opt.checked);
                return {
                  field,
                  id: field.name,
                  question: qText,
                  ...(header && header !== qText ? { header } : {}),
                  multi: Boolean(field.multi),
                  ...(checkedIdx >= 0 ? { recommended: checkedIdx } : {}),
                  enabled,
                  options: enabled.map((e) => ({
                    label: e.display.label,
                    ...(e.display.description ? { description: e.display.description } : {}),
                    ...(e.display.preview ? { preview: e.display.preview } : {}),
                  })),
                };
              }
              return {
                field,
                id: field.name,
                question: qText,
                ...(header && header !== qText ? { header } : {}),
                multi: false,
                enabled: [] as Array<{ index: number; opt: ChoiceOption; display: ChoiceOptionDisplay }>,
                options: [] as Array<{ label: string; description?: string; preview?: string }>,
              };
            });

            const serializedQuestions = fieldMeta.map((m) => ({
              id: m.id,
              question: m.question,
              ...(m.header ? { header: m.header } : {}),
              options: m.options,
              multi: m.multi,
              ...(m.recommended !== undefined ? { recommended: m.recommended } : {}),
            }));

            const primaryQ = serializedQuestions[0];
            const askPayload = {
              type: "ask_human",
              id,
              question: primaryQ?.question ?? "Please clarify:",
              options: primaryQ?.options ?? [],
              questions: serializedQuestions,
              timestamp,
            };
            this.pendingAskRequest = askPayload;
            this.send(askPayload);

            const { promise, resolve, reject } = Promise.withResolvers<ExtensionFormDialogResult | undefined>();
            const signal = dialogOptions?.signal;
            const cleanup = () => {
              this.pendingUiRequests.delete(id);
              signal?.removeEventListener("abort", onAbort);
              if (this.pendingAskRequest?.id === id) {
                this.pendingAskRequest = null;
                this.send({ type: "ask_resolved", id });
              }
            };
            const onAbort = () => {
              cleanup();
              reject(new Error("Ask input was cancelled"));
            };
            if (signal?.aborted) {
              onAbort();
              return promise;
            }
            signal?.addEventListener("abort", onAbort, { once: true });

            this.pendingUiRequests.set(id, {
              resolve: (val: unknown) => {
                cleanup();
                if (val === null || val === undefined) {
                  resolve(undefined);
                  return;
                }
                if (typeof val === "object" && !Array.isArray(val)) {
                  const kindVal = "kind" in val && typeof val.kind === "string" ? val.kind : undefined;
                  if (kindVal === "cancel" || kindVal === "chat") {
                    resolve(undefined);
                    return;
                  }
                  if ("answers" in val && val.answers && typeof val.answers === "object") {
                    const answersMap = val.answers as Record<string, unknown>;
                    const data = defaultFormData(form);
                    const results: Array<Record<string, unknown>> = [];

                    for (const meta of fieldMeta) {
                      const rawEntry = Object.hasOwn(answersMap, meta.id) ? answersMap[meta.id] : undefined;
                      const entryObj = rawEntry && typeof rawEntry === "object" ? rawEntry : undefined;
                      const selectedOptions =
                        entryObj && "selectedOptions" in entryObj && Array.isArray(entryObj.selectedOptions)
                          ? entryObj.selectedOptions.map(String).filter(Boolean)
                          : [];
                      const rawCustom =
                        entryObj && "customInput" in entryObj && typeof entryObj.customInput === "string"
                          ? entryObj.customInput.trim()
                          : "";
                      const customInput = rawCustom.length > 0 ? rawCustom : undefined;

                      if (meta.field.kind === "choice") {
                        const fallbackSelected =
                          selectedOptions.length === 0 && customInput === undefined && !meta.multi
                            ? [meta.options[meta.recommended ?? 0]?.label ?? ""].filter(Boolean)
                            : selectedOptions;
                        const checked = new Set<number>();
                        for (const sel of fallbackSelected) {
                          const matched = meta.enabled.find(
                            (e) =>
                              e.display.label === sel ||
                              e.display.fullText === sel ||
                              e.display.value === sel,
                          );
                          if (matched) checked.add(matched.index);
                        }
                        const cVal = choiceValue(meta.field, checked, customInput);
                        if (cVal === undefined) delete data[meta.id];
                        else data[meta.id] = cVal;

                        results.push({
                          id: meta.id,
                          question: meta.question,
                          options: meta.options.map((o) => o.label),
                          multi: meta.multi,
                          selectedOptions: fallbackSelected,
                          ...(customInput !== undefined ? { customInput } : {}),
                          timedOut: false,
                        });
                      } else {
                        const textAns = customInput ?? selectedOptions[0] ?? meta.field.value;
                        data[meta.id] = textValue(meta.field, textAns);
                        results.push({
                          id: meta.id,
                          question: meta.question,
                          options: [],
                          multi: false,
                          selectedOptions: [],
                          ...(textAns ? { customInput: textAns } : {}),
                          timedOut: false,
                        });
                      }
                    }

                    this.lastAskFormResults = results;
                    resolve({ data, timedOut: false });
                    return;
                  }
                }

                const data = defaultFormData(form);
                resolve({ data, timedOut: false });
              },
              reject: (err: unknown) => {
                cleanup();
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
        this.emitTodoState("sync");
        this.send({
          type: "mcp_status",
          ...this.getMcpStatus(),
        });
        this.broadcastQueueUpdate();
        await this.broadcastSessionsList();
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
    const promptStartTime = Date.now();
    telemetry.track("agent_prompt_started", {
      has_attachments: Boolean(attachments && (attachments.images?.length || attachments.files?.length)),
      model: this.activeModel || "default",
    });
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
    if (promptText.trim() === "/clear") {
      await this.clear();
      return;
    }
    const session = this.session;
    if (!session) {
      this.send({
        message: "Authentication required: No model provider has active credentials. Please connect an API key or log in with OAuth to activate the agent.",
      });
      this.send({
        type: "assistant_error",
        error: "No active credentials",
        message: "⚠️ **No Provider Connected**\n\nNo model is currently unlocked with valid credentials.\n\n👉 **To fix this**: Click the **Model Selector (`✦`)** at the bottom of the chat and connect your provider (OAuth or API key).",
      });
      return;
    }

    // Process attachments via AttachmentService leveraging pi-harness markit & workspace storage
    const rawAttachments: RawAttachment[] = [];
    if (attachments?.images) {
      for (const img of attachments.images) {
        rawAttachments.push({
          name: (img as Record<string, unknown>).name as string || "image.png",
          data: img.data,
          mimeType: img.mimeType,
          isImage: true,
        });
      }
    }
    if (attachments?.videos) {
      for (const vid of attachments.videos) {
        rawAttachments.push({
          name: vid.name || "video.mp4",
          data: vid.data || "",
          path: vid.path,
          size: vid.size,
          mimeType: vid.mimeType || "video/mp4",
          isVideo: true,
          thumbnailUrl: vid.thumbnailUrl,
        });
      }
    }
    if (attachments?.files) {
      for (const file of attachments.files) {
        const base64Data = file.data || (file.content ? Buffer.from(file.content, "utf-8").toString("base64") : "");
        if (base64Data || file.path) {
          rawAttachments.push({
            name: file.name,
            data: base64Data || "",
            path: file.path,
            size: file.size,
            mimeType: file.mimeType,
            isImage: file.mimeType?.startsWith("image/"),
          });
        }
      }
    }

    const processed = await this.attachmentService.processAttachments(
      rawAttachments,
      this.activeProjectPath ?? undefined
    );

    let fullPromptText = promptText;
    if (processed.promptAdditions) {
      fullPromptText = fullPromptText ? `${fullPromptText}\n\n${processed.promptAdditions}` : processed.promptAdditions;
    }

    const images = processed.images;

    if (this.isGenerating) {
      // Agent is actively running: queue as follow-up in pi-harness
      const effectiveText = fullPromptText || "Analyze the attached media and proceed.";
      this.pendingFollowUps.push({ fullPromptText: effectiveText.trim(), promptText, attachments });
      await session.followUp(effectiveText, images.length > 0 ? images : undefined);
      this.broadcastQueueUpdate();
      return;
    }

    this.wasStoppedByUser = false;
    this.turnHadError = false;
    this.turnErrorMessage = null;
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
    if (attachments?.videos && attachments.videos.length > 0) {
      userMsg.videos = attachments.videos;
    }
    if (attachments?.files && attachments.files.length > 0) {
      userMsg.files = attachments.files;
    }
    this.activeTurns.push(userMsg);
    if (this.activeProjectPath) {
      await ChatHistoryManager.appendEvent(this.activeProjectPath, userMsg, this.activeBranchName, this.activeSessionId || undefined);
    }

    // Auto-derive session name from first prompt if untitled
    if (this.session && promptText.trim() && !this.session.sessionManager.getSessionName()) {
      const autoTitle = promptText.trim().replace(/\s+/g, " ").slice(0, 45);
      this.session.sessionManager.setSessionName(autoTitle, "auto").then(() => {
        this.broadcastSessionsList().catch(() => {});
      }).catch(() => {});
    }
    this.send({
      type: "status",
      content: "Running",
      timestamp: now,
    });
    this.send({
      type: "agent_status",
      status: "generating",
      timestamp: now,
    });
    const promptToSend = fullPromptText || "Analyze the attached media and proceed.";
    this.dispatchedPrompts.add(promptToSend.trim());
    try {
      await session.prompt(promptToSend, {
        images: images.length > 0 ? images : undefined,
      });
    } catch (err) {
      if (!this.wasStoppedByUser) {
        this.turnHadError = true;
        this.pendingFollowUps = [];
        if (this.session) {
          try {
            this.session.clearQueue({ forInterrupt: false });
          } catch {}
        }
        this.broadcastQueueUpdate();
        const errText = err instanceof Error ? err.message : String(err);
        this.turnErrorMessage = errText;
        telemetry.track("$exception", {
          $exception_message: errText,
          $exception_type: err instanceof Error ? err.name : "AgentExecutionError",
          $exception_stack_trace_raw: err instanceof Error ? err.stack : undefined,
          model: this.activeModel || "default",
          project_name: this.activeProjectName || undefined,
          session_id: this.activeSessionId || undefined,
        });
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
            this.activeBranchName,
            this.activeSessionId || undefined,
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
        this.send({
          type: "agent_status",
          status: "error",
          timestamp: errorAssistantMsg.timestamp,
        });
      }
    } finally {
      this.isGenerating = false;
      this.broadcastQueueUpdate();
      const usage = this.session?.getContextUsage();
      const totalTokens = usage?.totalTokens ?? 0;
      const contextWindow = usage?.contextWindow || 1_000_000;
      const usagePct = usage?.percent !== undefined ? Math.round(usage.percent * 10) / 10 : (contextWindow > 0 ? Math.round((totalTokens / contextWindow) * 100) : 0);

      const durationMs = Date.now() - promptStartTime;
      const durationSec = durationMs / 1000;
      const breakdown = this.session?.getContextBreakdown() as Record<string, unknown> | undefined;
      const promptTokens = Number(breakdown?.messagesTokens ?? 0);
      const completionTokens = Math.max(0, totalTokens - promptTokens);
      const activeModel = this.activeModel || this.session?.model?.id || "default";
      const provider = this.session?.model?.provider || "custom";

      telemetry.track("agent_turn_completed", {
        duration_ms: durationMs,
        had_error: this.turnHadError,
        was_stopped: this.wasStoppedByUser,
        model: activeModel,
        project_name: this.activeProjectName || undefined,
        session_id: this.activeSessionId || undefined,
        total_tokens: totalTokens,
        context_window: contextWindow,
        usage_pct: usagePct,
      });

      telemetry.track("$ai_generation", {
        $ai_model: activeModel,
        $ai_provider: provider,
        $ai_input_tokens: promptTokens,
        $ai_output_tokens: completionTokens,
        $ai_total_tokens: totalTokens,
        $ai_latency: durationSec,
        $ai_is_error: Boolean(this.turnHadError),
        $ai_error: this.turnErrorMessage || undefined,
        $ai_trace_id: this.activeSessionId ? `${this.activeSessionId}_${promptStartTime}` : `turn_${promptStartTime}`,
        $ai_session_id: this.activeSessionId || this.activeProjectName || "default",
        project_name: this.activeProjectName || undefined,
        had_error: this.turnHadError,
        was_stopped: this.wasStoppedByUser,
      });
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
    if (this.pendingAskRequest && typeof this.pendingAskRequest.id === "string") {
      this.send({ type: "ask_resolved", id: this.pendingAskRequest.id });
      this.pendingAskRequest = null;
    }
    for (const [, req] of this.pendingUiRequests.entries()) {
      req.reject(new Error("Agent execution stopped by user."));
    }
    this.pendingUiRequests.clear();
    this.pendingFollowUps = [];

    if (this.session) {
      this.wasStoppedByUser = true;
      this.isGenerating = false;
      try {
        this.session.clearQueue({ forInterrupt: true });
      } catch {}
      this.broadcastQueueUpdate();
      telemetry.track("agent_stopped_by_user", {
        model: this.activeModel || "default",
        project_name: this.activeProjectName || undefined,
        session_id: this.activeSessionId || undefined,
      });
      this.send({
        type: "status",
        content: "Stopped: Agent execution stopped by user.",
      });
      this.send({
        type: "agent_status",
        status: "idle",
      });
      await this.session.abort({ reason: USER_INTERRUPT_LABEL }).catch(() => {});
    }
  }

  async clear(): Promise<void> {
    if (!this.activeProjectPath) return;

    if (this.isGenerating || (this.session && this.session.isStreaming)) {
      this.send({
        type: "assistant_error",
        error: "Agent busy",
        message: "⚠️ Cannot clear context while the agent is running. Please stop the agent first.",
      });
      return;
    }

    if (this.session?.isCompacting) {
      this.session.abortCompaction();
      while (this.session.isCompacting) {
        await Bun.sleep(20);
      }
    }

    let droppedCount = 0;
    if (this.session) {
      try {
        const result = await this.session.resetSessionContext();
        if (!result) {
          console.warn("[SessionBridge] resetSessionContext returned undefined; forcing agent reset and boundary append");
          droppedCount = this.session.agent.state.messages.length;
          this.session.agent.reset();
          this.session.sessionManager.appendResetBoundary();
        } else {
          droppedCount = result.droppedCount;
        }
      } catch (err) {
        console.warn("[SessionBridge] Failed to reset AgentSession context:", err);
      }
    }

    if (this.currentPreviewUrl) {
      this.handlePreviewReady(this.currentPreviewUrl);
    }
    for (const [, req] of this.pendingUiRequests.entries()) {
      req.reject(new Error("Context reset by user."));
    }
    this.pendingUiRequests.clear();

    const boundaryEvent: Record<string, unknown> = {
      type: "reset_boundary",
      id: `reset_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    this.activeTurns.push(boundaryEvent);
    this.activeToolCalls.clear();
    this.pendingFollowUps = [];
    this.dispatchedPrompts.clear();

    await ChatHistoryManager.recordResetBoundary(this.activeProjectPath, this.activeBranchName, this.activeSessionId || undefined);

    this.send({
      type: "session_cleared",
      droppedCount,
      timestamp: new Date().toISOString(),
      boundaryId: boundaryEvent.id,
    });
    this.send({
      type: "chat_history_loaded",
      project: this.activeProjectPath,
      messages: this.activeTurns,
    });
    const messageNoun = droppedCount === 1 ? "message" : "messages";
    this.send({
      type: "status",
      content: `Context reset — ${droppedCount} ${messageNoun} dropped; session continues.`,
    });
    this.emitContextTelemetry();
    this.emitTodoState("sync");
  }

  async undoClear(): Promise<void> {
    if (!this.activeProjectPath) return;
    const history = await ChatHistoryManager.loadHistory(this.activeProjectPath, this.activeBranchName, { raw: true, sessionId: this.activeSessionId || undefined });
    const lastBoundaryIdx = history.ui_events.findLastIndex((ev) => ev.type === "reset_boundary");
    if (lastBoundaryIdx >= 0) {
      history.ui_events.splice(lastBoundaryIdx, 1);
      await ChatHistoryManager.saveHistory(this.activeProjectPath, history.ui_events, this.activeBranchName, { immediate: true, sessionId: this.activeSessionId || undefined });
      this.activeTurns = [...history.ui_events];
      this.send({
        type: "chat_history_loaded",
        project: this.activeProjectPath,
        messages: this.activeTurns,
      });
      this.send({
        type: "status",
        content: "Context reset undone. Prior messages restored to AI memory.",
      });
      this.emitContextTelemetry();
      this.emitTodoState("sync");
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
        this.activeSessionId || undefined,
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
      this.emitTodoState("sync");

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
    this.emitTodoState("sync");
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
    this.emitTodoState("sync");
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
      case "queue_update": {
        this.send({
          type: "queue_update",
          steering: event.steering || [],
          followUp: event.followUp || [],
          liveSteered: event.liveSteered || 0,
        });
        break;
      }

      case "message_start": {
        const msg = event.message;
        if (msg && msg.role === "user") {
          let text = "";
          if (typeof msg.content === "string") {
            text = msg.content;
          } else if (Array.isArray(msg.content)) {
            for (const b of msg.content) {
              if (b && typeof b === "object" && "type" in b && b.type === "text" && "text" in b && typeof b.text === "string") {
                text += b.text;
              }
            }
          }
          const trimmed = text.trim();

          // Check if this user prompt was already recorded & dispatched by bridge.prompt()
          if (this.dispatchedPrompts.has(trimmed)) {
            this.dispatchedPrompts.delete(trimmed);
            break;
          }

          // Check if this was a queued follow-up with attachments
          const followUpIdx = this.pendingFollowUps.findIndex((f) => f.fullPromptText === trimmed);
          let promptDisplay = trimmed;
          let turnFiles: unknown = undefined;
          let turnImages: unknown = undefined;

          if (followUpIdx >= 0) {
            const meta = this.pendingFollowUps.splice(followUpIdx, 1)[0];
            promptDisplay = meta.promptText;
            turnFiles = meta.attachments?.files;
            turnImages = meta.attachments?.images;
          } else if (trimmed.includes("--- Attached File:")) {
            promptDisplay = trimmed.replace(/--- Attached File: [\s\S]*?--- End Attached File ---/g, "").trim();
          }

          const alreadyRecorded = this.activeTurns.some(
            (t) => t.role === "user" && (t.content === promptDisplay || t.content === trimmed)
          );
          if (!alreadyRecorded && (promptDisplay || turnFiles || turnImages)) {
            this.isGenerating = true;
            this.lastPromptText = promptDisplay;
            const userMsg: Record<string, unknown> = {
              role: "user",
              content: promptDisplay,
              timestamp,
            };
            if (turnFiles) userMsg.files = turnFiles;
            if (turnImages) userMsg.images = turnImages;

            this.activeTurns.push(userMsg);
            if (this.activeProjectPath) {
              ChatHistoryManager.appendEvent(this.activeProjectPath, userMsg, this.activeBranchName, this.activeSessionId || undefined).catch(() => {});
            }
            this.send({
              type: "message",
              ...userMsg,
            });
            this.send({
              type: "status",
              content: "Running",
              timestamp,
            });
          }
        }
        break;
      }

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
            } else if (
              this.activeModel.startsWith("custom-") ||
              this.activeModel.startsWith("omniroute/") ||
              this.activeModel.startsWith("vllm/")
            ) {
              if (/401|403|unauthorized|forbidden|invalid.*api.?key/i.test(errMsg)) {
                friendlyError = `⚠️ **Custom Model Authentication Error**: ${errMsg}\n\n👉 **To fix**: Open **Custom Models** and check your API key.`;
              } else if (/404|not found/i.test(errMsg)) {
                friendlyError = `⚠️ **Custom Endpoint Not Found (404)**: ${errMsg}\n\n👉 **To fix**: Verify the **Base URL** (e.g. \`/v1\` suffix) and **Format** (OpenAI vs Anthropic) in **Custom Models**.`;
              } else if (/strict|store|reasoning_effort/i.test(errMsg)) {
                friendlyError = `⚠️ **Custom Endpoint Parameter Rejection**: ${errMsg}\n\n👉 **To fix**: Open **Custom Models → Advanced** and toggle **Disable strict tool schemas** or check the model format.`;
              }
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
                this.activeBranchName,
                this.activeSessionId || undefined,
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
                ChatHistoryManager.appendEvent(this.activeProjectPath, assistantMsg, this.activeBranchName, this.activeSessionId || undefined).catch(() => {});
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
          ChatHistoryManager.appendEvent(this.activeProjectPath, toolCallMsg, this.activeBranchName, this.activeSessionId || undefined).catch(() => {});
        }

        this.send(toolCallMsg);


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
        let resultDetails = event.result?.details ?? undefined;
        if (event.toolName === "ask" && this.lastAskFormResults) {
          const baseDetails =
            resultDetails && typeof resultDetails === "object"
              ? (resultDetails as Record<string, unknown>)
              : {};
          resultDetails = {
            ...baseDetails,
            results: baseDetails.results ?? this.lastAskFormResults,
          };
          this.lastAskFormResults = null;
        }
        const structuredResult = {
          content: event.result?.content ?? [{ type: "text", text: String(event.result ?? "") }],
          details: resultDetails,
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
          ChatHistoryManager.appendEvent(this.activeProjectPath, toolResultMsg, this.activeBranchName, this.activeSessionId || undefined).catch(() => {});
        }

        this.send(toolResultMsg);

        if (event.toolName === "todo" && !event.isError) {
          const details = event.result?.details as { op?: string; phases?: unknown } | undefined;
          if (details?.op !== "view") {
            const phases = this.session
              ? this.session.getTodoPhases()
              : Array.isArray(details?.phases)
              ? details.phases
              : [];
            this.send({
              type: "todo_update",
              op: details?.op ?? (cachedCall?.args?.op as string | undefined) ?? "update",
              phases,
              timestamp,
            });
          }
        } else if (event.toolName === "eval" && !event.isError && hasNestedTodo(event.result?.details)) {
          this.emitTodoState("eval");
        }

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
        this.emitTodoState("sync");
        break;
      }

      case "model_changed": {
        this.emitContextTelemetry();
        break;
      }

      case "auto_retry_start": {
        this.isGenerating = true;
        this.turnHadError = false;
        const attempt = "attempt" in event && typeof event.attempt === "number" ? event.attempt : 1;
        const maxAttempts = "maxAttempts" in event && typeof event.maxAttempts === "number" ? event.maxAttempts : 3;
        this.send({
          type: "status",
          content: `Retrying (${attempt}/${maxAttempts})...`,
          timestamp,
        });
        this.send({
          type: "agent_status",
          status: "retrying",
          attempt,
          maxAttempts,
          timestamp,
        });
        break;
      }

      case "auto_retry_end": {
        const isSuccess = !("success" in event) || Boolean(event.success);
        if (isSuccess) {
          this.isGenerating = true;
          this.turnHadError = false;
          this.send({
            type: "status",
            content: "Running",
            timestamp,
          });
          this.send({
            type: "agent_status",
            status: "generating",
            timestamp,
          });
        } else {
          this.turnHadError = true;
        }
        break;
      }

      case "agent_end": {
        const wasStopped = this.wasStoppedByUser;
        const hadError = this.turnHadError;
        const isTerminal = !("isTerminal" in event) || event.isTerminal !== false;

        if (!isTerminal && !wasStopped) {
          console.log("[SessionBridge] Agent turn ended with queued continuation, continuing...");
          this.emitContextTelemetry();
          return;
        }

        this.wasStoppedByUser = false;
        this.turnHadError = false;
        this.isGenerating = false;
        if (wasStopped) {
          this.pendingFollowUps = [];
          if (this.session) {
            try {
              this.session.clearQueue({ forInterrupt: true });
            } catch {}
          }
          this.broadcastQueueUpdate();
          this.send({
            type: "status",
            content: "Stopped: Agent execution stopped by user.",
            timestamp,
          });
          this.send({
            type: "agent_status",
            status: "idle",
            timestamp,
          });
        } else if (hadError) {
          console.log("[SessionBridge] Agent turn ended with error, clearing queues and sending error status");
          this.pendingFollowUps = [];
          if (this.session) {
            try {
              this.session.clearQueue({ forInterrupt: false });
            } catch {}
          }
          this.broadcastQueueUpdate();
          this.send({
            type: "status",
            content: "Error: Agent execution encountered an error.",
            timestamp,
          });
          this.send({
            type: "agent_status",
            status: "error",
            timestamp,
          });
        } else {
          this.send({
            type: "status",
            content: "Done",
            timestamp,
          });
          this.send({
            type: "agent_status",
            status: "done",
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
                  await ChatHistoryManager.saveHistory(this.activeProjectPath!, this.activeTurns, this.activeBranchName, { sessionId: this.activeSessionId || undefined });
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
      try {
        await this.session.abort({ reason: "Session disposed" }).catch(() => {});
      } catch {}
      this.unsubscribe?.();
      this.unsubscribe = null;
      await this.session.dispose().catch(() => {});
      this.session = null;
    }
    if (this.mcpStatusUnsubscribe) {
      this.mcpStatusUnsubscribe();
      this.mcpStatusUnsubscribe = null;
    }
    if (this.mcpManager) {
      try {
        await this.mcpManager.disconnectAll();
      } catch {}
      this.mcpManager = null;
    }
    this.devServerUnsubscribe?.();
    this.devServerUnsubscribe = null;
  }

  removeQueuedMessage(text: string, queue: "steering" | "followUp" = "followUp"): boolean {
    if (!this.session) return false;
    const removed = this.session.removeQueuedMessage(text, queue);
    this.broadcastQueueUpdate();
    return removed;
  }

  broadcastQueueUpdate(): void {
    if (!this.session) return;
    try {
      const q = this.session.getQueuedMessages();
      this.send({
        type: "queue_update",
        steering: [...q.steering],
        followUp: [...q.followUp],
        liveSteered: q.liveSteered,
      });
    } catch {}
  }

  private buildPreviewSystemPrompt(previewUrl: string, backendPort?: number | null): string {
    let templateName = "Web App";
    let isMobile = false;
    let templateAiRules: string[] = [];
    try {
      const tplPath = path.join(this.projectPath, "template.json");
      if (fs.existsSync(tplPath)) {
        const parsed = JSON.parse(fs.readFileSync(tplPath, "utf-8"));
        if (parsed.name) templateName = parsed.name;
        if (parsed.category === "mobile" || parsed.id === "mobile_expo") isMobile = true;
        if (Array.isArray(parsed.aiRules)) {
          templateAiRules = parsed.aiRules;
        }
      }
    } catch {}

    const portMatch = /:(\d+)/.exec(previewUrl);
    const frontendPort = portMatch ? portMatch[1] : "3000";

    const lines = [
      `# Managed Development Server & Live Preview Environment`,
      `- ACTIVE PORTS & RUNTIME STATUS:`,
      `  * Frontend (${templateName}): Running at ${previewUrl} (PORT ${frontendPort}).`,
      `  * Backend API Server: ${backendPort ? `Running at http://127.0.0.1:${backendPort} (PORT ${backendPort}).` : "Not running (starts automatically on PORT 5001 if server/index.js exists)."}`,
      `- LIVE RELOAD IS ACTIVE: Writing or editing code files automatically updates the running application in-memory on these exact ports without restarting the dev server.`,
    ];
    if (backendPort) {
      if (isMobile) {
        lines.push(
          `- In mobile screens, connect to the backend API using process.env.EXPO_PUBLIC_API_URL (which points to http://127.0.0.1:${backendPort}/api).`,
          `- Backend code in server/index.js automatically reloads when modified.`,
        );
      } else {
        lines.push(
          `- Frontend requests to '/api/*' are automatically proxied by Vite to http://127.0.0.1:${backendPort}.`,
          `- Backend code in server/index.js (or server/) automatically reloads when modified.`,
        );
      }
    } else {
      lines.push(
        `- Fullstack capability: If you create backend API endpoints (e.g., in server/index.js), the platform automatically detects, launches, and assigns dynamic ports.`,
      );
    }
    lines.push(
      `- DO NOT attempt to run dev servers in bash; dev servers are fully managed by the workspace.`,
      `- DO NOT alter port settings in server configurations or package.json.`,
      ``,
      `## CRITICAL NETWORK & PORT RULES (MANDATORY):`,
      `1. FRONTEND API CALLS: For web, use relative paths starting with '/api' (e.g. fetch('/api/items')). For React Native mobile screens, use process.env.EXPO_PUBLIC_API_URL (e.g. fetch(\`\${process.env.EXPO_PUBLIC_API_URL || 'http://127.0.0.1:5001/api'}/items\`)).`,
      `   - NEVER hardcode a static port number in URLs. The backend port is dynamically assigned.`,
      `2. BACKEND SERVER LISTEN PORT: When creating or editing backend servers:`,
      `   - ALWAYS read the port dynamically from environment variables: const PORT = process.env.BACKEND_PORT || process.env.PORT || 5001;`,
      `   - ALWAYS listen on that variable: app.listen(PORT, '0.0.0.0', ...);`,
      `   - NEVER hardcode a static port number in app.listen().`
    );

    if (templateAiRules.length > 0) {
      lines.push(...templateAiRules.map((r, i) => `${i + 3}. ${r}`));
    } else {
      lines.push(
        `3. DEV SERVER LIFECYCLE: Do not run dev servers in bash or alter port settings in vite.config.js or package.json.`,
        `4. BRAND ATTRIBUTION (MANDATORY): The project template contains a mandatory "Made on 80degrees" badge chip (#made-on-80degrees) in index.html. DO NOT remove, hide, alter, or cover this badge when editing index.html or application styles.`
      );
    }
    return lines.join("\n");
  }

  private buildMarketplaceSystemPrompt(): string {
    return [
      `# External Capabilities & Marketplace Ecosystem`,
      `You have access to a rich marketplace of official plugins and Model Context Protocol (MCP) servers.`,
      `Key operational domains available in the marketplace include:`,
      `- **Deployment & Hosting**: Vercel (\`vercel\`), Railway (\`railway\`), Cloudflare (\`cloudflare\`), Netlify (\`netlify\`), Render (\`render\`), AWS (\`aws\`), Azure (\`azure\`), Docker`,
      `- **Databases & Backends**: Supabase (\`supabase\`), Neon Postgres (\`neon\`), MongoDB (\`mongodb\`), SQLite (\`sqlite\`), Pinecone (\`pinecone\`), Convex (\`convex\`), Firebase (\`firebase\`)`,
      `- **Browsers & Testing**: Chrome DevTools (\`chrome-devtools-mcp\`), Puppeteer (\`puppeteer\`), Playwright (\`playwright\`)`,
      `- **3D Assets & Audio**: Poly Pizza 3D Models (\`poly-pizza\`), Sketchfab (\`sketchfab\`), Blender (\`blender\`), ElevenLabs Audio (\`elevenlabs\`)`,
      `- **Productivity & Dev Tools**: GitHub (\`github\`), Linear (\`linear\`), Sentry, Datadog`,
      ``,
      `## WORKFLOW RULE FOR EXTERNAL OPERATIONS & DEPLOYMENTS:`,
      `When the user requests an operation requiring external infrastructure (such as deploying the app, connecting to cloud databases, fetching 3D assets, automated browser inspection):`,
      `1. DO NOT guess CLI commands or claim that you cannot perform the deployment or operation.`,
      `2. Search available marketplace plugins and MCP servers using the \`marketplace_search\` tool.`,
      `3. Install the required plugin using \`marketplace_install_plugin\` or enable the MCP server using \`marketplace_configure_mcp\`.`,
      `4. Once installed, the plugin's skills (accessible as \`skill://<name>\`) and MCP tools become live immediately in this session. Read the relevant skill using the \`read\` tool to follow the platform's official instructions and complete the user's task.`,
    ].join("\n");
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
  public emitContextTelemetry(): void {
    if (!this.session) return;
    const usage = this.session.getContextUsage();
    const breakdown = this.session.getContextBreakdown() as Record<string, unknown> | undefined;
    const contextWindow = usage?.contextWindow ?? this.session.model?.contextWindow ?? 1_000_000;

    const lastBoundaryIdx = this.activeTurns.findLastIndex((t) => t.type === "reset_boundary");
    const activeTurnsAfterBoundary = lastBoundaryIdx >= 0 ? this.activeTurns.slice(lastBoundaryIdx + 1) : this.activeTurns;
    const isContextEmpty = activeTurnsAfterBoundary.length === 0;
    const providerPromptTokens = isContextEmpty ? 0 : Number(breakdown?.messagesTokens ?? 0);
    const totalTokens = isContextEmpty ? 0 : (usage?.tokens ?? 0);
    const usagePct = isContextEmpty
      ? 0
      : (usage?.percent !== undefined ? Math.round(usage.percent * 10) / 10 : Math.round((totalTokens / contextWindow) * 100));

    const staticTokens = Number(breakdown?.systemPromptTokens ?? 0);
    const schemaTokens = Number(breakdown?.systemToolsTokens ?? 0);
    const virtualRamTokens = Number(breakdown?.skillsTokens ?? 0);

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

  public emitTodoState(op = "view"): void {
    const phases = this.session ? this.session.getTodoPhases() : [];
    this.send({
      type: "todo_update",
      op,
      phases,
      timestamp: new Date().toISOString(),
    });
  }

  async listSessions(): Promise<SessionInfo[]> {
    if (!this.activeProjectPath) return [];
    const list = await SessionManager.list(this.activeProjectPath);
    if (this.activeSessionId && !list.some((s) => s.id === this.activeSessionId)) {
      list.unshift({
        id: this.activeSessionId,
        title: this.session?.sessionManager?.getSessionName() || "Untitled Session",
        cwd: this.activeProjectPath,
        created: new Date(),
        modified: new Date(),
        messageCount: this.activeTurns.length,
        firstMessage: "",
        allMessagesText: "",
        size: 0,
        path: this.activeSessionFile || "",
      });
    }
    return list;
  }
  async broadcastSessionsList(): Promise<void> {
    if (!this.activeProjectPath) return;
    const sessions = await this.listSessions();
    this.send({
      type: "sessions_list",
      project: this.activeProjectPath,
      activeSessionId: this.activeSessionId,
      sessions: sessions.map((s) => ({
        id: s.id,
        title: s.title || (s.firstMessage && s.firstMessage !== "(no messages)" ? s.firstMessage.slice(0, 50) : "Untitled Session"),
        created: s.created ? new Date(s.created).toISOString() : new Date().toISOString(),
        modified: s.modified ? new Date(s.modified).toISOString() : new Date().toISOString(),
        messageCount: s.messageCount || 0,
        firstMessage: s.firstMessage || "",
        path: s.path,
      })),
    });
  }

  async createSession(title?: string): Promise<{ session: { id: string; title: string; path: string } }> {
    if (this.isGenerating) {
      this.send({
        type: "assistant_error",
        error: "Agent busy",
        message: "Cannot create a new session while the agent is running. Please stop the agent first.",
      });
      throw new Error("Agent busy");
    }
    if (!this.session || !this.activeProjectPath) {
      throw new Error("No active project session");
    }

    await this.session.newSession();
    this.activeSessionId = this.session.sessionId || null;
    this.activeSessionFile = this.session.sessionFile || null;

    if (title && title.trim()) {
      await this.session.sessionManager.setSessionName(title.trim(), "user");
    }

    this.activeTurns = [];
    this.activeToolCalls.clear();
    this.pendingFollowUps = [];
    this.dispatchedPrompts.clear();

    if (this.activeSessionId) {
      await ChatHistoryManager.saveHistory(
        this.activeProjectPath,
        [],
        this.activeBranchName,
        { immediate: true, sessionId: this.activeSessionId },
      );
    }

    const sessionInfo = {
      id: this.activeSessionId || "",
      title: title?.trim() || "Untitled Session",
      path: this.activeSessionFile || "",
    };

    this.send({
      type: "session_created",
      session: sessionInfo,
    });
    this.send({
      type: "chat_history_loaded",
      project: this.activeProjectPath,
      sessionId: this.activeSessionId,
      messages: [],
    });
    this.emitTodoState("clear");
    await this.broadcastSessionsList();
    return { session: sessionInfo };
  }

  async switchSession(sessionIdOrPath: string): Promise<void> {
    if (this.isGenerating) {
      this.send({
        type: "assistant_error",
        error: "Agent busy",
        message: "Cannot switch sessions while the agent is running. Please stop the agent first.",
      });
      return;
    }
    if (!this.session || !this.activeProjectPath) return;

    let targetPath = sessionIdOrPath;
    if (!sessionIdOrPath.endsWith(".jsonl")) {
      const sessions = await SessionManager.list(this.activeProjectPath);
      const match = sessions.find((s) => s.id === sessionIdOrPath || s.path === sessionIdOrPath);
      if (!match) {
        console.warn(`[SessionBridge] Session not found for switch: ${sessionIdOrPath}`);
        return;
      }
      targetPath = match.path;
    }

    const switched = await this.session.switchSession(targetPath, { keepModel: true });
    if (switched === false) {
      console.warn(`[SessionBridge] Session switch cancelled by harness: ${targetPath}`);
      return;
    }

    this.activeSessionId = this.session.sessionId || null;
    this.activeSessionFile = this.session.sessionFile || null;
    this.activeToolCalls.clear();
    this.pendingFollowUps = [];
    this.dispatchedPrompts.clear();

    // Load turns for switched session
    const history = await ChatHistoryManager.loadHistory(
      this.activeProjectPath,
      this.activeBranchName,
      { sessionId: this.activeSessionId || undefined },
    );
    this.activeTurns = [...history.ui_events];

    this.send({
      type: "session_switched",
      sessionId: this.activeSessionId,
      messages: this.activeTurns,
    });
    this.send({
      type: "chat_history_loaded",
      project: this.activeProjectPath,
      sessionId: this.activeSessionId,
      messages: this.activeTurns,
    });
    this.emitContextTelemetry();
    this.emitTodoState("sync");
    await this.broadcastSessionsList();
  }

  async deleteSession(sessionIdOrPath: string): Promise<void> {
    if (this.isGenerating) {
      this.send({
        type: "assistant_error",
        error: "Agent busy",
        message: "Cannot delete a session while the agent is running. Please stop the agent first.",
      });
      return;
    }
    if (!this.activeProjectPath) return;

    const sessions = await SessionManager.list(this.activeProjectPath);
    const match = sessions.find((s) => s.id === sessionIdOrPath || s.path === sessionIdOrPath);
    if (!match) return;

    const isTargetActive = this.activeSessionId === match.id || this.activeSessionFile === match.path;
    if (this.session) {
      await this.session.sessionManager.dropSession(match.path).catch(() => {});
    }
    await ChatHistoryManager.deleteSessionHistory(this.activeProjectPath, match.id);

    if (isTargetActive) {
      const remaining = await SessionManager.list(this.activeProjectPath);
      if (remaining.length > 0) {
        await this.switchSession(remaining[0].path);
      } else {
        await this.createSession("New Session");
      }
    } else {
      await this.broadcastSessionsList();
    }

    this.send({
      type: "session_deleted",
      deletedSessionId: match.id,
      nextActiveSessionId: this.activeSessionId,
    });
  }

  async renameSession(sessionIdOrPath: string, newTitle: string): Promise<void> {
    if (!this.activeProjectPath || !newTitle.trim()) return;
    const sessions = await SessionManager.list(this.activeProjectPath);
    const match = sessions.find((s) => s.id === sessionIdOrPath || s.path === sessionIdOrPath);
    if (!match) return;

    if (this.session && (this.activeSessionId === match.id || this.activeSessionFile === match.path)) {
      await this.session.sessionManager.setSessionName(newTitle.trim(), "user");
    } else {
      const tempSm = await SessionManager.open(match.path);
      await tempSm.setSessionName(newTitle.trim(), "user");
      await tempSm.flush();
    }
    await this.broadcastSessionsList();
  }
}
