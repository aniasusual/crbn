import { getCoreDb, isPostgresConfigured } from "./db";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import {
  BASELINE_COMPANY_AGENTS,
  buildAgentPackageFiles,
  getCompanyRoster,
  resolveAgentMetadata,
  resolveAssigneeUuid,
  type AgentTemplatePackage,
  type ResolvedAgentMeta,
} from "./templates";
import {
  agentaProvisioner,
  type AgentaSessionHint,
  type AgentTurnDispatchResult,
} from "./agenta-provisioner";
export type { AgentaSessionHint, AgentTurnDispatchResult };
import { logCompany } from "./logger";
import { buildProjectContextBundle, type ProjectContextBundle } from "./project-context";
export type { ProjectContextBundle };

export interface CompanyAgentSummary {
  id: string;
  name: string;
  role: string;
  category: string;
  initials: string;
  color: string;
  model: string;
  starterPrompts: string[];
  workflowId?: string;
  slug?: string;
  templateKey?: string;
  isCustom?: boolean;
  isEngineering?: boolean;
}

export interface CompanyBlackboardMetrics {
  totalTasks: number;
  backlogTasks: number;
  inProgressTasks: number;
  reviewTasks: number;
  doneTasks: number;
  blockedTasks: number;
  pendingApprovals: number;
  totalArtifacts: number;
}

export interface CompanyInfo {
  id: string;
  name: string;
  tagline: string;
  projectName: string;
  projectPath: string;
  createdAt: string;
  agents: CompanyAgentSummary[];
  templateAgents: string[];
  agentaProjectId?: string;
  agentaWorkspaceId?: string;
  agentaUserId?: string;
  agentaApiKey?: string;
  agentaUrl: string;
  status: "active" | "provisioning";
  seeded?: boolean;
  autoTriggerAgents?: boolean;
  autoTriggerOnCommit?: boolean;
  blackboardMetrics?: CompanyBlackboardMetrics;
}

export class CompanyService {
  private inFlightProvisioning = new Map<string, Promise<CompanyInfo>>();
  private syncTimers = new Map<string, Timer>();
  private milestoneTriggerTimers = new Map<string, Timer>();
  private recentTaskDispatches = new Map<string, number>();
  private metricsCache = new Map<
    string,
    { expiresAt: number; metrics: CompanyBlackboardMetrics }
  >();

  clearDispatchCooldowns(): void {
    this.recentTaskDispatches.clear();
    this.metricsCache.clear();
    for (const timer of this.milestoneTriggerTimers.values()) {
      clearTimeout(timer);
    }
    this.milestoneTriggerTimers.clear();
  }

  private shouldAutoTrigger(company?: Partial<CompanyInfo> | null): boolean {
    if (process.env.CRBN_AUTO_TRIGGER_AGENTS === "false" || process.env.CRBN_AUTO_TRIGGER_AGENTS === "0") {
      return false;
    }
    if (company && company.autoTriggerAgents === false) {
      return false;
    }
    return true;
  }

  private canDispatchTaskTurn(agentaProjectId: string, taskId: string, cooldownMs = 15000): boolean {
    const key = `${agentaProjectId}:${taskId}`;
    const now = Date.now();
    const last = this.recentTaskDispatches.get(key) || 0;
    if (now - last < cooldownMs) {
      return false;
    }
    this.recentTaskDispatches.set(key, now);
    return true;
  }
  /**
   * Schedules a debounced background sync of the project's codebase & git context
   * to Agenta whenever the project has an initialized company workspace.
   */
  scheduleContextSync(
    projectPath: string,
    projectName: string,
    sessionHint?: AgentaSessionHint,
    delayMs = 2000
  ): void {
    const companyFilePath = path.join(projectPath, ".80degrees_company.json");
    if (!fsSync.existsSync(companyFilePath)) return;

    const key = path.resolve(projectPath);
    clearTimeout(this.syncTimers.get(key));
    const timer = setTimeout(() => {
      this.syncTimers.delete(key);
      this.syncCompanyContext(projectPath, projectName, sessionHint).catch((err) => {
        console.warn(`[CompanyService] Background context sync error for "${projectName}":`, err);
      });
    }, delayMs);

    this.syncTimers.set(key, timer);
  }

  /**
   * Rebuilds the project context bundle (COMPANY.md, CODEBASE_MAP.md, GIT_HISTORY.md,
   * and key source files), updates local company/COMPANY.md, and pushes changes to Agenta mounts.
   */
  async syncCompanyContext(
    projectPath: string,
    projectName: string,
    sessionHint?: AgentaSessionHint
  ): Promise<ProjectContextBundle | null> {
    const companyFilePath = path.join(projectPath, ".80degrees_company.json");
    if (!fsSync.existsSync(companyFilePath)) return null;

    let company: Partial<CompanyInfo> = {};
    try {
      company = JSON.parse(await fs.readFile(companyFilePath, "utf-8"));
    } catch {
      return null;
    }

    const formattedName =
      company.name ||
      projectName
        .split(/[-_]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
        .trim();

    const bundle = await buildProjectContextBundle(
      projectPath,
      projectName,
      formattedName,
      company.tagline,
      company.agents
    );

    try {
      const companyDir = path.join(projectPath, "company");
      await fs.mkdir(companyDir, { recursive: true });
      await fs.writeFile(path.join(companyDir, "COMPANY.md"), bundle.companyMd, "utf-8");
    } catch {}

    const effectiveHint: AgentaSessionHint = {
      ...sessionHint,
      userId: company.agentaUserId,
      orgId: company.agentaWorkspaceId,
      projectId: company.agentaProjectId,
      apiKey: company.agentaApiKey,
    };

    const provisionResult = await agentaProvisioner.provisionCompanyAgents(
      formattedName,
      projectName,
      BASELINE_COMPANY_AGENTS,
      bundle.description,
      effectiveHint,
      bundle,
      { alreadySeeded: Boolean(company.seeded) }
    );
    if (provisionResult.success) {
      try {
        const latest = JSON.parse(await fs.readFile(companyFilePath, "utf-8")) as CompanyInfo;
        latest.agentaUserId = provisionResult.agentaUserId || latest.agentaUserId;
        latest.agentaApiKey = provisionResult.agentaApiKey || latest.agentaApiKey;
        latest.seeded = true;
        if (Array.isArray(provisionResult.agents)) {
          latest.agents = provisionResult.agents.map((ag) => ({
            id: ag.id,
            name: ag.name,
            role: ag.role,
            category: ag.category,
            initials: ag.initials,
            color: ag.color,
            model: ag.model || "gemini/gemini-2.5-flash",
            starterPrompts: ag.starterPrompts || [],
            workflowId: ag.workflowId,
            slug: ag.slug,
            templateKey: ag.templateKey,
            isCustom: Boolean(ag.isCustom),
          }));
          latest.templateAgents = latest.agents.map((a) => a.id);
        }
        await fs.writeFile(companyFilePath, JSON.stringify(latest, null, 2), "utf-8");
      } catch {}
    }

    return bundle;
  }

  /**
   * Publishes a git_milestone artifact to the company's Agenta Blackboard when a new
   * engineering checkpoint is committed in crbn.
   */
  async recordGitMilestoneOnBlackboard(
    projectPath: string,
    projectName: string,
    step: {
      step_id: string;
      step_number: number;
      commit_hash: string;
      prompt: string;
      timestamp: string;
    },
    blackboardTaskId?: string,
    fullPromptText?: string,
    options?: { immediateMilestoneTriggers?: boolean }
  ): Promise<{
    resolvedTaskId?: string;
    unblockedDispatches: AgentTurnDispatchResult[];
    milestoneDispatches: AgentTurnDispatchResult[];
  }> {
    const result = {
      resolvedTaskId: undefined as string | undefined,
      unblockedDispatches: [] as AgentTurnDispatchResult[],
      milestoneDispatches: [] as AgentTurnDispatchResult[],
    };
    const companyFilePath = path.join(projectPath, ".80degrees_company.json");
    if (!fsSync.existsSync(companyFilePath)) return result;
    try {
      const company = JSON.parse(await fs.readFile(companyFilePath, "utf-8")) as Partial<CompanyInfo>;
      if (!company.agentaProjectId) return result;
      const projId = company.agentaProjectId;

      const authCtx = {
        userId: company.agentaUserId,
        apiKey: company.agentaApiKey,
      };
      let resolvedTaskId = blackboardTaskId;
      let matchedTaskObj: Record<string, unknown> | null = null;

      // If no explicit task ID was tagged, check if an in_progress Blackboard task matches this prompt
      if (!resolvedTaskId) {
        try {
          const listRes = await agentaProvisioner.callBlackboardApi(
            projId,
            "/tasks?status=in_progress",
            "GET",
            undefined,
            authCtx
          );
          const rawData = listRes.data;
          const rawTasks =
            rawData && typeof rawData === "object" && "tasks" in rawData && Array.isArray(rawData.tasks)
              ? rawData.tasks
              : [];
          const haystack = `${step.prompt} ${fullPromptText || ""}`.toLowerCase();
          for (const item of rawTasks) {
            if (item && typeof item === "object" && "id" in item && "title" in item) {
              const itemId = typeof item.id === "string" ? item.id : undefined;
              const itemTitle = typeof item.title === "string" ? item.title : undefined;
              if (itemId && itemTitle && haystack.includes(itemTitle.toLowerCase().trim())) {
                resolvedTaskId = itemId;
                matchedTaskObj = item as Record<string, unknown>;
                break;
              }
            }
          }
        } catch {}
      }
      result.resolvedTaskId = resolvedTaskId;

      // Snapshot currently blocked tasks before completing resolvedTaskId so we detect newly unblocked tasks
      const blockedBefore = resolvedTaskId
        ? await this.fetchBlockedTaskIds(projId, authCtx)
        : new Set<string>();

      await agentaProvisioner.callBlackboardApi(
        projId,
        "/artifacts",
        "POST",
        {
          type: "git_milestone",
          title: `Step ${step.step_number} (${step.commit_hash.slice(0, 8)}): ${step.prompt}`,
          ...(resolvedTaskId ? { task_id: resolvedTaskId } : {}),
          data: {
            project_name: projectName,
            step_id: step.step_id,
            step_number: step.step_number,
            commit_hash: step.commit_hash,
            prompt: step.prompt,
            timestamp: step.timestamp,
            ...(resolvedTaskId ? { task_id: resolvedTaskId } : {}),
          },
        },
        authCtx
      );
      logCompany(
        "Service",
        `Published git_milestone artifact for Step ${step.step_number} to Blackboard (${projId})`
      );

      // Auto-complete the linked Blackboard task (which also unblocks dependent tasks in Agenta)
      if (resolvedTaskId) {
        const patchRes = await agentaProvisioner.callBlackboardApi(
          projId,
          `/tasks/${encodeURIComponent(resolvedTaskId)}`,
          "PATCH",
          {
            status: "done",
            step_id: step.step_id,
            commit_hash: step.commit_hash,
          },
          authCtx
        );
        if (
          !matchedTaskObj &&
          patchRes.data &&
          typeof patchRes.data === "object" &&
          "task" in patchRes.data &&
          patchRes.data.task &&
          typeof patchRes.data.task === "object"
        ) {
          matchedTaskObj = patchRes.data.task as Record<string, unknown>;
        }
        logCompany(
          "Service",
          `Auto-completed Blackboard task ${resolvedTaskId} on commit ${step.commit_hash.slice(0, 8)}`
        );

        if (this.shouldAutoTrigger(company) && blockedBefore.size > 0) {
          result.unblockedDispatches = await this.dispatchNewlyUnblockedTasks(
            projId,
            blockedBefore,
            company.agents,
            authCtx,
            {
              completedTask: matchedTaskObj,
              milestoneStep: step,
            }
          );
        }
      }

      // Only trigger post-commit specialists (QA, Release Manager, Copywriter) when explicitly requested
      // (options.immediateMilestoneTriggers or company.autoTriggerOnCommit), avoiding unrequested runs on every save.
      const shouldTriggerCommitSpecialists =
        this.shouldAutoTrigger(company) &&
        (options?.immediateMilestoneTriggers === true || company.autoTriggerOnCommit === true);
      if (shouldTriggerCommitSpecialists) {
        const isImmediate =
          options?.immediateMilestoneTriggers === true ||
          process.env.NODE_ENV === "test" ||
          process.env.BUN_ENV === "test";
        if (isImmediate) {
          result.milestoneDispatches = await this.triggerGitMilestoneSpecialists(
            company,
            step,
            matchedTaskObj,
            result.unblockedDispatches
          );
        } else {
          const key = path.resolve(projectPath);
          clearTimeout(this.milestoneTriggerTimers.get(key));
          const timer = setTimeout(() => {
            this.milestoneTriggerTimers.delete(key);
            this.triggerGitMilestoneSpecialists(
              company,
              step,
              matchedTaskObj,
              result.unblockedDispatches
            ).catch((err) => {
              console.warn("[CompanyService] Milestone specialist trigger error:", err);
            });
          }, 2500);
          this.milestoneTriggerTimers.set(key, timer);
        }
      }
    } catch (err) {
      console.warn("[CompanyService] Could not record git milestone on Blackboard:", err);
    }
    return result;
  }

  buildTaskExecutionPrompt(
    task: Record<string, unknown>,
    options?: {
      completedTask?: Record<string, unknown> | null;
      milestoneStep?: {
        step_number: number;
        commit_hash: string;
        prompt: string;
      } | null;
    }
  ): string {
    const taskId = String(task.id || "");
    const title = String(task.title || "Execute assigned task");
    const description =
      typeof task.description === "string" && task.description.trim()
        ? task.description.trim()
        : "(Execute based on task title and company context)";
    const priority = String(task.priority || "medium");

    const lines: string[] = [
      `[Blackboard Task Unblocked & Ready: IN PROGRESS]`,
      `You are assigned to execute Blackboard Task #${taskId}: "${title}"`,
      `Priority: ${priority}`,
      `Scope / Description:\n${description}`,
    ];

    if (options?.completedTask?.title) {
      lines.push(
        `Upstream Dependency Completed: "${String(options.completedTask.title)}"${
          typeof options.completedTask.commit_hash === "string"
            ? ` (commit ${options.completedTask.commit_hash.slice(0, 8)})`
            : ""
        }`
      );
    }
    if (options?.milestoneStep) {
      lines.push(
        `Latest Engineering Milestone: Step ${options.milestoneStep.step_number} (${options.milestoneStep.commit_hash.slice(
          0,
          8
        )}) — ${options.milestoneStep.prompt}`
      );
    }

    lines.push(
      `Instructions:\n1. Inspect \`agent-files/COMPANY.md\` and \`agent-files/project/GIT_HISTORY.md\` (or run \`.tools/bin/blackboard briefing\`) for context.\n2. Execute this task now.\n3. Publish your deliverable artifact to the shared Blackboard via \`.tools/bin/blackboard artifact-create <type> "<title>" '<json>' ${taskId}\`.\n4. If your output requires founder sign-off (e.g., \`publish_post\`, \`send_campaign\`, \`deploy_prod\`, \`refund\`), queue it via \`.tools/bin/blackboard approval-request <action_type> '<json>' ${taskId}\` and set the task status to \`review\`. Otherwise mark the task \`done\` via \`.tools/bin/blackboard task-update ${taskId} done\`.`
    );
    return lines.join("\n\n");
  }

  buildGitMilestonePrompt(
    role: "qa" | "changelog" | "copywriter",
    step: {
      step_id: string;
      step_number: number;
      commit_hash: string;
      prompt: string;
      timestamp: string;
    },
    completedTask?: Record<string, unknown> | null
  ): string {
    const shortSha = step.commit_hash.slice(0, 8);
    const taskNote = completedTask?.title
      ? `\nCompleted Kanban Task: "${String(completedTask.title)}" (#${String(completedTask.id || "")})`
      : "";

    if (role === "qa") {
      return [
        `[Automated Git Milestone Trigger: Code Review & QA]`,
        `A new engineering commit was just shipped in 80degrees: Step ${step.step_number} (\`${shortSha}\`) — "${step.prompt}".${taskNote}`,
        `Instructions:\n1. Read the latest commit diff in \`agent-files/project/GIT_HISTORY.md\` (or run \`.tools/bin/crbn-project diff\`).\n2. Review the changes for regressions, edge cases, or missing error handling.\n3. Publish a concise QA review artifact via \`.tools/bin/blackboard artifact-create research "QA Review: Step ${step.step_number} (${shortSha})" '<json>'\` (or \`bug_reproduction\` if you find a concrete bug that needs fixing).`,
      ].join("\n\n");
    }

    if (role === "changelog") {
      return [
        `[Automated Git Milestone Trigger: Release Notes]`,
        `A new engineering commit was just shipped in 80degrees: Step ${step.step_number} (\`${shortSha}\`) — "${step.prompt}".${taskNote}`,
        `Instructions:\n1. Inspect the commit details in \`agent-files/project/GIT_HISTORY.md\` (or run \`.tools/bin/crbn-project log\`).\n2. Draft concise, user-facing release notes categorized into Features, Improvements, or Fixes.\n3. Publish the release notes artifact to the Blackboard via \`.tools/bin/blackboard artifact-create launch_kit "Changelog: Step ${step.step_number} (${shortSha})" '<json>'\`.`,
      ].join("\n\n");
    }

    return [
      `[Automated Git Milestone Trigger: Launch Announcement]`,
      `Engineering just completed Step ${step.step_number} (\`${shortSha}\`) — "${step.prompt}".${taskNote}`,
      `Instructions:\n1. Read \`agent-files/COMPANY.md\` and \`agent-files/project/GIT_HISTORY.md\` to see what shipped.\n2. Draft a compelling social launch post / announcement highlighting the user value.\n3. Publish the draft as a \`launch_kit\` artifact and queue a founder approval via \`.tools/bin/blackboard approval-request publish_post '<json>'\`.`,
    ].join("\n\n");
  }

  private async fetchBlockedTaskIds(
    agentaProjectId: string,
    authCtx: { userId?: string; apiKey?: string; accessToken?: string }
  ): Promise<Set<string>> {
    const ids = new Set<string>();
    try {
      const res = await agentaProvisioner.callBlackboardApi(
        agentaProjectId,
        "/tasks?status=blocked",
        "GET",
        undefined,
        authCtx
      );
      const rawData = res.data;
      const rawTasks =
        rawData && typeof rawData === "object" && "tasks" in rawData && Array.isArray(rawData.tasks)
          ? rawData.tasks
          : [];
      for (const item of rawTasks) {
        if (item && typeof item === "object" && "id" in item && typeof item.id === "string") {
          ids.add(item.id);
        }
      }
    } catch {}
    return ids;
  }

  private async dispatchNewlyUnblockedTasks(
    agentaProjectId: string,
    previouslyBlockedIds: Set<string>,
    activeAgents: Array<Partial<ResolvedAgentMeta>> | undefined,
    authCtx: { userId?: string; apiKey?: string; accessToken?: string },
    upstreamContext?: {
      completedTask?: Record<string, unknown> | null;
      milestoneStep?: { step_number: number; commit_hash: string; prompt: string } | null;
    }
  ): Promise<AgentTurnDispatchResult[]> {
    const dispatches: AgentTurnDispatchResult[] = [];
    if (previouslyBlockedIds.size === 0) return dispatches;

    try {
      const inProgRes = await agentaProvisioner.callBlackboardApi(
        agentaProjectId,
        "/tasks?status=in_progress",
        "GET",
        undefined,
        authCtx
      );
      const rawData = inProgRes.data;
      const inProgTasks =
        rawData && typeof rawData === "object" && "tasks" in rawData && Array.isArray(rawData.tasks)
          ? rawData.tasks
          : [];

      const dispatchPromises: Array<Promise<AgentTurnDispatchResult>> = [];
      for (const item of inProgTasks) {
        if (!item || typeof item !== "object" || !("id" in item)) continue;
        const taskObj = item as Record<string, unknown>;
        const taskId = typeof taskObj.id === "string" ? taskObj.id : undefined;
        if (!taskId || !previouslyBlockedIds.has(taskId)) continue;

        const enriched = this.enrichBlackboardTask(taskObj, activeAgents);
        const targetAgent =
          (typeof enriched.assignee_workflow_id === "string" && enriched.assignee_workflow_id) ||
          (typeof enriched.assignee_role === "string" && enriched.assignee_role);

        if (
          !targetAgent ||
          enriched.assignee_is_engineering ||
          enriched.assignee_role === "engineering" ||
          enriched.assignee_removed
        ) {
          continue;
        }

        if (!this.canDispatchTaskTurn(agentaProjectId, taskId)) continue;

        const prompt = this.buildTaskExecutionPrompt(enriched, upstreamContext);
        dispatchPromises.push(
          agentaProvisioner.dispatchAgentTurn(agentaProjectId, targetAgent, prompt, {
            companyAgents: activeAgents,
            authContext: authCtx,
          })
        );
      }
      if (dispatchPromises.length > 0) {
        const settled = await Promise.all(dispatchPromises);
        dispatches.push(...settled);
      }
    } catch (err) {
      console.warn("[CompanyService] Failed to dispatch newly unblocked tasks:", err);
    }

    return dispatches;
  }

  private async triggerGitMilestoneSpecialists(
    company: Partial<CompanyInfo>,
    step: {
      step_id: string;
      step_number: number;
      commit_hash: string;
      prompt: string;
      timestamp: string;
    },
    completedTask?: Record<string, unknown> | null,
    unblockedDispatches: AgentTurnDispatchResult[] = []
  ): Promise<AgentTurnDispatchResult[]> {
    const dispatches: AgentTurnDispatchResult[] = [];
    if (!company.agentaProjectId) return dispatches;
    const projId = company.agentaProjectId;
    const authCtx = {
      userId: company.agentaUserId,
      apiKey: company.agentaApiKey,
    };

    const liveAgents = await agentaProvisioner.fetchLiveProjectAgents(projId, authCtx);
    const activeAgents = Array.isArray(liveAgents) ? liveAgents : company.agents;
    const roster = getCompanyRoster(activeAgents);

    const rolesToTrigger: Array<"qa" | "changelog" | "copywriter"> = ["qa", "changelog"];
    const alreadyWokeCopywriter = unblockedDispatches.some((d) => d.agentId === "copywriter");
    if (completedTask && !alreadyWokeCopywriter) {
      rolesToTrigger.push("copywriter");
    }

    const dispatchPromises: Array<Promise<AgentTurnDispatchResult>> = [];
    for (const role of rolesToTrigger) {
      // Only trigger if this specialist currently exists in the live roster (not deleted by user)
      const presentInRoster = roster.find(
        (r) => r.id === role && !r.isEngineering && r.workflowId
      );
      if (!presentInRoster) continue;

      const prompt = this.buildGitMilestonePrompt(role, step, completedTask);
      dispatchPromises.push(
        agentaProvisioner.dispatchAgentTurn(projId, presentInRoster.workflowId || role, prompt, {
          companyAgents: activeAgents,
          authContext: authCtx,
        })
      );
    }
    if (dispatchPromises.length > 0) {
      const settled = await Promise.all(dispatchPromises);
      dispatches.push(...settled);
    }
    return dispatches;
  }

  private enrichBlackboardTask(
    rawTask: unknown,
    activeAgents?: Array<Partial<ResolvedAgentMeta>>
  ): Record<string, unknown> {
    if (!rawTask || typeof rawTask !== "object") return {};
    const task = rawTask as Record<string, unknown>;
    const rawAssigneeId =
      typeof task.assignee_agent_id === "string" ? task.assignee_agent_id : null;
    const rawAssigneeRole =
      typeof task.assignee_role === "string" ? task.assignee_role : null;
    const meta = resolveAgentMetadata(rawAssigneeId || rawAssigneeRole, activeAgents);
    return {
      ...task,
      assignee_role: meta?.id || rawAssigneeRole || null,
      assignee_name: meta?.name || null,
      assignee_initials: meta?.initials || null,
      assignee_color: meta?.color || null,
      assignee_workflow_id: meta?.workflowId || rawAssigneeId || null,
      assignee_is_custom: Boolean(meta?.isCustom),
      assignee_is_engineering: Boolean(meta?.isEngineering),
      assignee_removed: Boolean(rawAssigneeId && !meta),
    };
  }

  private enrichBlackboardApproval(
    rawApproval: unknown,
    activeAgents?: Array<Partial<ResolvedAgentMeta>>
  ): Record<string, unknown> {
    if (!rawApproval || typeof rawApproval !== "object") return {};
    const approval = rawApproval as Record<string, unknown>;
    const payload =
      approval.payload && typeof approval.payload === "object"
        ? (approval.payload as Record<string, unknown>)
        : {};
    const rawAgentId = typeof approval.agent_id === "string" ? approval.agent_id : null;
    const rawRole = typeof payload.agent_role === "string" ? payload.agent_role : null;
    const rawName = typeof payload.agent_name === "string" ? payload.agent_name : null;
    const meta = resolveAgentMetadata(rawAgentId || rawRole || rawName, activeAgents);
    return {
      ...approval,
      agent_role: meta?.id || rawRole || null,
      agent_name: meta?.name || rawName || null,
      agent_initials: meta?.initials || null,
      agent_color: meta?.color || null,
      agent_workflow_id: meta?.workflowId || rawAgentId || null,
    };
  }

  private enrichBlackboardArtifact(
    rawArtifact: unknown,
    activeAgents?: Array<Partial<ResolvedAgentMeta>>
  ): Record<string, unknown> {
    if (!rawArtifact || typeof rawArtifact !== "object") return {};
    const artifact = rawArtifact as Record<string, unknown>;
    const data =
      artifact.data && typeof artifact.data === "object"
        ? (artifact.data as Record<string, unknown>)
        : {};
    const rawAgentId = typeof artifact.agent_id === "string" ? artifact.agent_id : null;
    const rawRole = typeof data.agent_role === "string" ? data.agent_role : null;
    const rawName = typeof data.agent_name === "string" ? data.agent_name : null;
    const meta = resolveAgentMetadata(rawAgentId || rawRole || rawName, activeAgents);
    return {
      ...artifact,
      agent_role: meta?.id || rawRole || null,
      agent_name: meta?.name || rawName || null,
      agent_initials: meta?.initials || null,
      agent_color: meta?.color || null,
      agent_workflow_id: meta?.workflowId || rawAgentId || null,
    };
  }

  buildApprovalContinuationPrompt(
    approval: Record<string, unknown>,
    linkedTask?: Record<string, unknown> | null
  ): string {
    const status = String(approval.status || "approved").toLowerCase();
    const isApproved = status === "approved";
    const actionType = String(approval.action_type || "action");
    const approvalId = String(approval.id || "");
    const founderNotes =
      typeof approval.founder_notes === "string" ? approval.founder_notes.trim() : "";
    const rawPayload =
      approval.payload && typeof approval.payload === "object"
        ? { ...(approval.payload as Record<string, unknown>) }
        : {};
    delete rawPayload.agent_role;
    delete rawPayload.agent_name;
    delete rawPayload.session_id;

    const taskId =
      typeof approval.task_id === "string"
        ? approval.task_id
        : typeof linkedTask?.id === "string"
        ? linkedTask.id
        : undefined;
    const taskTitle =
      typeof linkedTask?.title === "string" ? linkedTask.title : undefined;

    const lines: string[] = [
      `[Founder Approval Resolved: ${isApproved ? "APPROVED" : "REJECTED"}]`,
      `Your approval request for "${actionType}" (Approval ID: ${approvalId}) has been ${
        isApproved ? "APPROVED" : "REJECTED"
      } by the founder.`,
    ];
    if (taskId) {
      lines.push(
        `Linked Blackboard Task: ${taskTitle ? `"${taskTitle}" ` : ""}(#${taskId})`
      );
    }
    if (founderNotes) {
      lines.push(`Founder Notes: "${founderNotes}"`);
    }
    lines.push(`Action Payload:\n${JSON.stringify(rawPayload, null, 2)}`);

    if (isApproved) {
      lines.push(
        `Instructions: Proceed immediately to execute this approved "${actionType}" action. Once completed, publish any resulting output artifact via \`.tools/bin/blackboard artifact-create\`${
          taskId
            ? ` and mark task ${taskId} as done via \`.tools/bin/blackboard task-update ${taskId} done\`.`
            : "."
        }`
      );
    } else {
      lines.push(
        `Instructions: Do NOT execute this "${actionType}" action as-is. Review the founder's notes above, revise your draft or approach accordingly, and submit a new approval request via \`.tools/bin/blackboard approval-request\` when ready.`
      );
    }
    return lines.join("\n\n");
  }

  async proxyBlackboardRequest(
    projectPath: string,
    subPath: string,
    method: string,
    body?: unknown,
    sessionHint?: AgentaSessionHint
  ): Promise<{ status: number; data: unknown }> {
    const lockKey = path.resolve(projectPath);
    const companyFilePath = path.join(projectPath, ".80degrees_company.json");
    let company: Partial<CompanyInfo> | null = null;
    if (fsSync.existsSync(companyFilePath)) {
      try {
        company = JSON.parse(await fs.readFile(companyFilePath, "utf-8")) as Partial<CompanyInfo>;
      } catch {}
    }

    // If provisioning is currently in flight and agentaProjectId is not yet written (or on write requests), await it
    if ((!company || !company.agentaProjectId) && this.inFlightProvisioning.has(lockKey)) {
      try {
        company = await this.inFlightProvisioning.get(lockKey)!;
      } catch {}
    }

    // On write requests (e.g. POST /tasks) or when company file exists without agentaProjectId, resolve/provision on the spot
    if (company && !company.agentaProjectId && method !== "GET") {
      const projName = company.projectName || path.basename(projectPath);
      try {
        const ensured = await this.ensureCompanyProvisioned(projectPath, projName, sessionHint);
        if (ensured?.agentaProjectId) {
          company = ensured;
        } else {
          const initialized = await this.initializeCompany(
            projectPath,
            projName,
            { name: company.name, tagline: company.tagline },
            sessionHint
          );
          if (initialized?.agentaProjectId) {
            company = initialized;
          }
        }
      } catch {}
    }

    const fallbackRoster = getCompanyRoster(company?.agents);

    if (!company || !company.agentaProjectId) {
      if (method === "GET") {
        if (subPath.startsWith("/tasks")) {
          return { status: 200, data: { count: 0, tasks: [], agents: fallbackRoster } };
        }
        if (subPath.startsWith("/approvals")) {
          return { status: 200, data: { count: 0, approvals: [] } };
        }
        if (subPath.startsWith("/artifacts")) {
          return { status: 200, data: { count: 0, artifacts: [] } };
        }
        if (subPath.startsWith("/briefing")) {
          return {
            status: 200,
            data: {
              summary: "Provisioning company workspace…",
              metrics: {
                total_tasks: 0,
                backlog: 0,
                in_progress: 0,
                review: 0,
                done: 0,
                blocked: 0,
                pending_approvals: 0,
                total_artifacts: 0,
              },
              pending_approvals: [],
              active_tasks: [],
              blocked_tasks: [],
              recent_artifacts: [],
              agents: fallbackRoster,
            },
          };
        }
      }
      return !company
        ? { status: 404, data: { detail: "Company not initialized for this project" } }
        : { status: 409, data: { detail: "Company is still provisioning in Agenta" } };
    }
    const authCtx = {
      userId: company.agentaUserId,
      apiKey: company.agentaApiKey,
      accessToken: sessionHint?.accessToken,
    };

    // Refresh live project agents from Agenta so newly created custom agents or deleted agents are reflected immediately
    const liveAgents = await agentaProvisioner.fetchLiveProjectAgents(
      company.agentaProjectId,
      authCtx
    );
    let activeAgents: Array<Partial<ResolvedAgentMeta>> | undefined = company.agents;
    if (Array.isArray(liveAgents)) {
      activeAgents = liveAgents;
      const prevIds = (company.agents || [])
        .map((a) => `${a.id}:${a.workflowId || ""}:${a.slug || ""}:${a.name}`)
        .join("|");
      const nextIds = liveAgents
        .map((a) => `${a.id}:${a.workflowId || ""}:${a.slug || ""}:${a.name}`)
        .join("|");
      if (prevIds !== nextIds) {
        try {
          const latest = JSON.parse(await fs.readFile(companyFilePath, "utf-8")) as CompanyInfo;
          latest.agents = liveAgents.map((ag) => ({
            id: ag.id,
            name: ag.name,
            role: ag.role,
            category: ag.category,
            initials: ag.initials,
            color: ag.color,
            model: ag.model || "gemini/gemini-2.5-flash",
            starterPrompts: ag.starterPrompts || [],
            workflowId: ag.workflowId,
            slug: ag.slug,
            templateKey: ag.templateKey,
            isCustom: Boolean(ag.isCustom),
          }));
          latest.templateAgents = latest.agents.map((a) => a.id);
          latest.seeded = true;
          await fs.writeFile(companyFilePath, JSON.stringify(latest, null, 2), "utf-8");
          // Trigger background context sync so any newly created custom agent gets COMPANY.md & .tools/bin/blackboard mounted
          this.scheduleContextSync(
            projectPath,
            company.projectName || path.basename(projectPath),
            sessionHint,
            500
          );
        } catch {}
      }
    }

    const fullRoster = getCompanyRoster(activeAgents);

    // Normalize task create / update payload to resolve assignee role/name/initials -> real workflow UUID
    let outboundBody = body;
    if (
      (method === "POST" || method === "PATCH") &&
      subPath.startsWith("/tasks") &&
      body &&
      typeof body === "object" &&
      !Array.isArray(body)
    ) {
      const b = { ...(body as Record<string, unknown>) };
      const rawAssignee =
        b.assignee_agent_id !== undefined
          ? b.assignee_agent_id
          : b.assignee_role !== undefined
          ? b.assignee_role
          : b.assignee;
      if (rawAssignee === null || rawAssignee === "") {
        b.assignee_agent_id = null;
      } else if (typeof rawAssignee === "string") {
        const resolvedUuid = resolveAssigneeUuid(rawAssignee, activeAgents);
        if (resolvedUuid) {
          b.assignee_agent_id = resolvedUuid;
          const deps = Array.isArray(b.dependencies) ? b.dependencies : [];
          const assigneeMeta = resolveAgentMetadata(resolvedUuid, activeAgents);
          if (
            method === "POST" &&
            !b.status &&
            deps.length === 0 &&
            assigneeMeta &&
            !assigneeMeta.isEngineering &&
            assigneeMeta.id !== "engineering"
          ) {
            b.status = "in_progress";
          }
        } else {
          delete b.assignee_agent_id;
        }
      }
      delete b.assignee_role;
      delete b.assignee;
      outboundBody = b;
    }

    const isTaskCreate = method === "POST" && /^\/tasks(\?|$)/.test(subPath);
    // Before PATCH /tasks/:id, snapshot blocked tasks (if marking done) or check prior task state (if marking in_progress)
    const isTaskPatch = method === "PATCH" && /^\/tasks\/[^/?]+(\?|$)/.test(subPath);
    const patchStatus =
      isTaskPatch &&
      outboundBody &&
      typeof outboundBody === "object" &&
      "status" in outboundBody &&
      typeof (outboundBody as Record<string, unknown>).status === "string"
        ? String((outboundBody as Record<string, unknown>).status)
        : undefined;

    let blockedBeforePatch = new Set<string>();
    if (isTaskPatch && patchStatus === "done" && this.shouldAutoTrigger(company)) {
      blockedBeforePatch = await this.fetchBlockedTaskIds(company.agentaProjectId, authCtx);
    }

    const res = await agentaProvisioner.callBlackboardApi(
      company.agentaProjectId,
      subPath,
      method,
      outboundBody,
      authCtx
    );

    if (method !== "GET") {
      this.metricsCache.delete(company.agentaProjectId);
    }

    if (res.status >= 200 && res.status < 300 && res.data && typeof res.data === "object") {
      const payload = { ...(res.data as Record<string, unknown>) };
      if (Array.isArray(payload.tasks)) {
        payload.tasks = payload.tasks.map((t) => this.enrichBlackboardTask(t, activeAgents));
        payload.agents = fullRoster;
      }
      if (payload.task && typeof payload.task === "object") {
        const enrichedTask = this.enrichBlackboardTask(payload.task, activeAgents);
        payload.task = enrichedTask;

        if ((isTaskPatch || isTaskCreate) && this.shouldAutoTrigger(company)) {
          const effectiveStatus = isTaskPatch
            ? patchStatus
            : typeof enrichedTask.status === "string"
            ? enrichedTask.status
            : undefined;
          if (isTaskPatch && effectiveStatus === "done" && blockedBeforePatch.size > 0) {
            const unblockedDispatches = await this.dispatchNewlyUnblockedTasks(
              company.agentaProjectId,
              blockedBeforePatch,
              activeAgents,
              authCtx,
              { completedTask: enrichedTask }
            );
            if (unblockedDispatches.length > 0) {
              payload.unblocked_dispatches = unblockedDispatches;
              payload.continuation = unblockedDispatches[0];
            }
          } else if (effectiveStatus === "in_progress") {
            const taskId = typeof enrichedTask.id === "string" ? enrichedTask.id : undefined;
            const targetAgent =
              (typeof enrichedTask.assignee_workflow_id === "string" &&
                enrichedTask.assignee_workflow_id) ||
              (typeof enrichedTask.assignee_role === "string" && enrichedTask.assignee_role);
            if (
              taskId &&
              targetAgent &&
              !enrichedTask.assignee_is_engineering &&
              enrichedTask.assignee_role !== "engineering" &&
              !enrichedTask.assignee_removed &&
              this.canDispatchTaskTurn(company.agentaProjectId, taskId)
            ) {
              const prompt = this.buildTaskExecutionPrompt(enrichedTask);
              const dispatchRes = await agentaProvisioner.dispatchAgentTurn(
                company.agentaProjectId,
                targetAgent,
                prompt,
                {
                  companyAgents: activeAgents,
                  authContext: authCtx,
                }
              );
              payload.continuation = dispatchRes;
            }
          }
        }
      }
      if (Array.isArray(payload.approvals)) {
        payload.approvals = payload.approvals.map((a) => this.enrichBlackboardApproval(a, activeAgents));
      }
      if (payload.approval && typeof payload.approval === "object") {
        const enrichedApproval = this.enrichBlackboardApproval(payload.approval, activeAgents);
        const isResolveEndpoint =
          method === "POST" && /^\/approvals\/[^/?]+\/resolve(\?|$)/.test(subPath);

        if (isResolveEndpoint) {
          let linkedTask: Record<string, unknown> | null = null;
          const linkedTaskId =
            typeof enrichedApproval.task_id === "string" ? enrichedApproval.task_id : undefined;

          if (linkedTaskId) {
            try {
              const taskRes = await agentaProvisioner.callBlackboardApi(
                company.agentaProjectId,
                `/tasks/${encodeURIComponent(linkedTaskId)}`,
                "GET",
                undefined,
                authCtx
              );
              if (
                taskRes.status === 200 &&
                taskRes.data &&
                typeof taskRes.data === "object" &&
                "task" in taskRes.data &&
                taskRes.data.task &&
                typeof taskRes.data.task === "object"
              ) {
                linkedTask = taskRes.data.task as Record<string, unknown>;
              }
            } catch {}

            const currentTaskStatus =
              typeof linkedTask?.status === "string" ? linkedTask.status : undefined;
            const approvalStatus = String(enrichedApproval.status || "").toLowerCase();
            const rawAppPayload =
              enrichedApproval.payload && typeof enrichedApproval.payload === "object"
                ? (enrichedApproval.payload as Record<string, unknown>)
                : {};

            if (approvalStatus === "approved") {
              const nextTaskStatus =
                rawAppPayload.complete_task_on_approve === true
                  ? "done"
                  : currentTaskStatus === "review" || currentTaskStatus === "blocked"
                  ? "in_progress"
                  : undefined;
              if (nextTaskStatus) {
                await agentaProvisioner
                  .callBlackboardApi(
                    company.agentaProjectId,
                    `/tasks/${encodeURIComponent(linkedTaskId)}`,
                    "PATCH",
                    { status: nextTaskStatus },
                    authCtx
                  )
                  .catch(() => {});
              }
            } else if (approvalStatus === "rejected" && currentTaskStatus === "review") {
              await agentaProvisioner
                .callBlackboardApi(
                  company.agentaProjectId,
                  `/tasks/${encodeURIComponent(linkedTaskId)}`,
                  "PATCH",
                  { status: "in_progress" },
                  authCtx
                )
                .catch(() => {});
            }
          }

          const actionTypeLower = String(enrichedApproval.action_type || "").toLowerCase();
          const inferredRoleFromAction =
            actionTypeLower === "publish_post"
              ? "copywriter"
              : actionTypeLower === "send_campaign"
              ? "sales"
              : actionTypeLower === "refund"
              ? "support"
              : actionTypeLower === "deploy_prod"
              ? "ops"
              : undefined;

          const targetAgent =
            (typeof enrichedApproval.agent_workflow_id === "string" &&
              enrichedApproval.agent_workflow_id) ||
            (typeof enrichedApproval.agent_role === "string" && enrichedApproval.agent_role) ||
            (typeof enrichedApproval.agent_name === "string" && enrichedApproval.agent_name) ||
            (typeof linkedTask?.assignee_agent_id === "string" && linkedTask.assignee_agent_id) ||
            inferredRoleFromAction;

          if (targetAgent) {
            const rawAppPayload =
              enrichedApproval.payload && typeof enrichedApproval.payload === "object"
                ? (enrichedApproval.payload as Record<string, unknown>)
                : {};
            const sessionId =
              typeof rawAppPayload.session_id === "string" ? rawAppPayload.session_id : undefined;
            const continuationPrompt = this.buildApprovalContinuationPrompt(
              enrichedApproval,
              linkedTask
            );
            const dispatchResult = await agentaProvisioner.dispatchAgentTurn(
              company.agentaProjectId,
              targetAgent,
              continuationPrompt,
              {
                sessionId,
                companyAgents: activeAgents,
                authContext: authCtx,
              }
            );
            enrichedApproval.continuation = dispatchResult;
            payload.continuation = dispatchResult;
          }
        }

        payload.approval = enrichedApproval;
      }
      if (Array.isArray(payload.artifacts)) {
        payload.artifacts = payload.artifacts.map((art) => this.enrichBlackboardArtifact(art, activeAgents));
      }
      if (payload.artifact && typeof payload.artifact === "object") {
        payload.artifact = this.enrichBlackboardArtifact(payload.artifact, activeAgents);
      }
      if (subPath.startsWith("/briefing")) {
        if (Array.isArray(payload.active_tasks)) {
          payload.active_tasks = payload.active_tasks.map((t) => this.enrichBlackboardTask(t, activeAgents));
        }
        if (Array.isArray(payload.blocked_tasks)) {
          payload.blocked_tasks = payload.blocked_tasks.map((t) => this.enrichBlackboardTask(t, activeAgents));
        }
        if (Array.isArray(payload.pending_approvals)) {
          payload.pending_approvals = payload.pending_approvals.map((a) =>
            this.enrichBlackboardApproval(a, activeAgents)
          );
        }
        if (Array.isArray(payload.recent_artifacts)) {
          payload.recent_artifacts = payload.recent_artifacts.map((art) =>
            this.enrichBlackboardArtifact(art, activeAgents)
          );
        }
        payload.agents = fullRoster;
        this.metricsCache.set(company.agentaProjectId, {
          expiresAt: Date.now() + 3000,
          metrics: this.parseBriefingMetrics(payload.metrics),
        });
      }
      return { status: res.status, data: payload };
    }

    return res;
  }

  private parseBriefingMetrics(rawMetrics?: unknown): CompanyBlackboardMetrics {
    const m =
      rawMetrics && typeof rawMetrics === "object"
        ? (rawMetrics as Record<string, unknown>)
        : {};
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
    return {
      totalTasks: num(m.total_tasks ?? m.totalTasks),
      backlogTasks: num(m.backlog ?? m.backlogTasks),
      inProgressTasks: num(m.in_progress ?? m.inProgressTasks),
      reviewTasks: num(m.review ?? m.reviewTasks),
      doneTasks: num(m.done ?? m.doneTasks),
      blockedTasks: num(m.blocked ?? m.blockedTasks),
      pendingApprovals: num(m.pending_approvals ?? m.pendingApprovals),
      totalArtifacts: num(m.total_artifacts ?? m.totalArtifacts),
    };
  }

  /**
   * Queries live Blackboard summary counts for a company (cached for 3s, graceful fallback).
   */
  async getCompanyBlackboardMetrics(
    company: Partial<CompanyInfo> | null | undefined,
    sessionHint?: AgentaSessionHint
  ): Promise<CompanyBlackboardMetrics> {
    const empty = this.parseBriefingMetrics();
    if (!company || !company.agentaProjectId || company.status !== "active") {
      return empty;
    }
    const projId = company.agentaProjectId;
    const now = Date.now();
    const cached = this.metricsCache.get(projId);
    if (cached && cached.expiresAt > now) {
      return cached.metrics;
    }

    try {
      const res = await agentaProvisioner.callBlackboardApi(
        projId,
        "/briefing",
        "GET",
        undefined,
        {
          userId: company.agentaUserId,
          apiKey: company.agentaApiKey,
          accessToken: sessionHint?.accessToken,
        }
      );
      if (res.status >= 200 && res.status < 300 && res.data && typeof res.data === "object") {
        const data = res.data as Record<string, unknown>;
        const metrics = this.parseBriefingMetrics(data.metrics);
        this.metricsCache.set(projId, {
          expiresAt: Date.now() + 3000,
          metrics,
        });
        return metrics;
      }
    } catch {}
    return empty;
  }

  /**
   * Initializes or refreshes the company workspace inside the project.
   */
  async initializeCompany(
    projectPath: string,
    projectName: string,
    data: { name?: string; tagline?: string } = {},
    sessionHint?: AgentaSessionHint
  ): Promise<CompanyInfo> {
    const lockKey = path.resolve(projectPath);
    const existingLock = this.inFlightProvisioning.get(lockKey);
    if (existingLock) {
      logCompany("Service", `initializeCompany awaiting in-flight provisioning for "${projectName}"`);
      return await existingLock;
    }

    const task = this._doInitializeCompany(projectPath, projectName, data, sessionHint);
    this.inFlightProvisioning.set(lockKey, task);
    try {
      return await task;
    } finally {
      if (this.inFlightProvisioning.get(lockKey) === task) {
        this.inFlightProvisioning.delete(lockKey);
      }
    }
  }

  private async _doInitializeCompany(
    projectPath: string,
    projectName: string,
    data: { name?: string; tagline?: string } = {},
    sessionHint?: AgentaSessionHint
  ): Promise<CompanyInfo> {
    logCompany("Service", `initializeCompany started for "${projectName}"`, { projectPath, data });
    const companyFilePath = path.join(projectPath, ".80degrees_company.json");
    const companyDir = path.join(projectPath, "company");
    const agentsDir = path.join(companyDir, "agents");
    const customDir = path.join(companyDir, "custom");

    // Ensure directory skeleton exists
    await fs.mkdir(agentsDir, { recursive: true });
    await fs.mkdir(customDir, { recursive: true });

    let existing: Partial<CompanyInfo> = {};
    if (fsSync.existsSync(companyFilePath)) {
      try {
        existing = JSON.parse(await fs.readFile(companyFilePath, "utf-8"));
      } catch {}
    }

    const formattedName =
      (data.name || existing.name || projectName)
        .split(/[-_]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
        .trim();

    const contextBundle = await buildProjectContextBundle(
      projectPath,
      projectName,
      data.name || existing.name || formattedName,
      data.tagline || existing.tagline
    );
    const resolvedCompanyName = contextBundle.companyName || formattedName;
    const projectDesc = contextBundle.description;

    const companyId = existing.id || `comp_${projectName.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
    const tagline = contextBundle.tagline;

    // 1. Write enriched company/COMPANY.md
    const companyMdPath = path.join(companyDir, "COMPANY.md");
    await fs.writeFile(companyMdPath, contextBundle.companyMd, "utf-8");

    // 2. Scaffold all 7 baseline Agenta packages in company/agents/<id>
    const agentSummaries: CompanyAgentSummary[] = [];

    for (const agent of BASELINE_COMPANY_AGENTS) {
      const agentFolder = path.join(agentsDir, agent.id);
      const agentPackageFiles = buildAgentPackageFiles(agent, resolvedCompanyName, projectDesc);
      await fs.mkdir(path.join(agentFolder, "ai.agenta", "agents", agent.id), { recursive: true });

      // Write plugin.json
      await fs.writeFile(
        path.join(agentFolder, "plugin.json"),
        agentPackageFiles["plugin.json"],
        "utf-8"
      );

      // Write ai.agenta/agents.json
      await fs.writeFile(
        path.join(agentFolder, "ai.agenta", "agents.json"),
        agentPackageFiles["ai.agenta/agents.json"],
        "utf-8"
      );

      // Write ai.agenta/agents/<id>/AGENTS.md
      await fs.writeFile(
        path.join(agentFolder, "ai.agenta", "agents", agent.id, "AGENTS.md"),
        agentPackageFiles["ai.agenta/agents/AGENTS.md"],
        "utf-8"
      );

      // Write ai.agenta/agents/<id>/SETUP.md
      await fs.writeFile(
        path.join(agentFolder, "ai.agenta", "agents", agent.id, "SETUP.md"),
        agentPackageFiles["ai.agenta/agents/SETUP.md"],
        "utf-8"
      );

      agentSummaries.push({
        id: agent.id,
        name: agent.name,
        role: agent.role,
        category: agent.category,
        initials: agent.initials,
        color: agent.color,
        model: agent.model,
        starterPrompts: agent.starterPrompts,
        isCustom: false,
      });
    }

    // Retain any already-registered custom agents
    if (Array.isArray(existing.agents)) {
      for (const ag of existing.agents) {
        if (ag.isCustom && !agentSummaries.some((a) => a.id === ag.id)) {
          agentSummaries.push(ag);
        }
      }
    }

    // 3. Save initial .80degrees_company.json before provisioning so concurrent readers see it
    const agentaBase = (process.env.AGENTA_WEB_URL || "http://localhost").replace(/\/$/, "");
    let agentaUrl = existing.agentaUrl || `${agentaBase}/m?project=${encodeURIComponent(projectName)}&company=${encodeURIComponent(companyId)}`;
    let status: "active" | "provisioning" = "provisioning";
    let agentaProjectId: string | undefined = existing.agentaProjectId;
    let agentaWorkspaceId: string | undefined = existing.agentaWorkspaceId;
    let agentaUserId: string | undefined = existing.agentaUserId;
    let agentaApiKey: string | undefined = existing.agentaApiKey;

    const initialCompanyInfo: CompanyInfo = {
      id: companyId,
      name: resolvedCompanyName,
      tagline,
      projectName,
      projectPath,
      createdAt: existing.createdAt || new Date().toISOString(),
      agents: agentSummaries,
      templateAgents: agentSummaries.map((a) => a.id),
      agentaProjectId,
      agentaWorkspaceId,
      agentaUserId,
      agentaApiKey,
      agentaUrl,
      status,
    };
    await fs.writeFile(companyFilePath, JSON.stringify(initialCompanyInfo, null, 2), "utf-8");
    let finalAgents = agentSummaries;
    let seeded = Boolean(existing.seeded);
    try {
      logCompany("Service", `Calling agentaProvisioner.provisionCompanyAgents for "${resolvedCompanyName}"...`);
      const provisionResult = await agentaProvisioner.provisionCompanyAgents(
        resolvedCompanyName,
        projectName,
        BASELINE_COMPANY_AGENTS,
        projectDesc,
        sessionHint,
        contextBundle,
        { alreadySeeded: Boolean(existing.seeded) }
      );
      logCompany("Service", `agentaProvisioner returned:`, {
        success: provisionResult.success,
        needsAuth: provisionResult.needsAuth,
        agentaProjectId: provisionResult.agentaProjectId,
        agentaUrl: provisionResult.agentaUrl,
        error: provisionResult.error,
      });
      if (provisionResult.agentaUrl) {
        agentaUrl = provisionResult.agentaUrl;
      }
      if (provisionResult.success && provisionResult.agentaProjectId) {
        status = "active";
        agentaProjectId = provisionResult.agentaProjectId;
        agentaWorkspaceId = provisionResult.agentaWorkspaceId;
        agentaUserId = provisionResult.agentaUserId || agentaUserId;
        agentaApiKey = provisionResult.agentaApiKey || agentaApiKey;
        seeded = true;
        if (Array.isArray(provisionResult.agents)) {
          finalAgents = provisionResult.agents.map((ag) => ({
            id: ag.id,
            name: ag.name,
            role: ag.role,
            category: ag.category,
            initials: ag.initials,
            color: ag.color,
            model: ag.model || "gemini/gemini-2.5-flash",
            starterPrompts: ag.starterPrompts || [],
            workflowId: ag.workflowId,
            slug: ag.slug,
            templateKey: ag.templateKey,
            isCustom: Boolean(ag.isCustom),
          }));
        }
      } else {
        status = "provisioning";
      }
    } catch (err) {
      logCompany("Service", `agentaProvisioner threw exception:`, err);
      status = "provisioning";
    }

    const companyInfo: CompanyInfo = {
      id: companyId,
      name: resolvedCompanyName,
      tagline,
      projectName,
      projectPath,
      createdAt: existing.createdAt || new Date().toISOString(),
      agents: finalAgents,
      templateAgents: finalAgents.map((a) => a.id),
      agentaProjectId,
      agentaWorkspaceId,
      agentaUserId,
      agentaApiKey,
      agentaUrl,
      status,
      seeded,
    };
    await fs.writeFile(companyFilePath, JSON.stringify(companyInfo, null, 2), "utf-8");
    return companyInfo;
  }

  /**
   * If the user previously saw the login screen and has now logged in,
   * this builds the project and baseline templates in their newly authenticated organization.
   */
  async ensureCompanyProvisioned(
    projectPath: string,
    projectName: string,
    sessionHint?: AgentaSessionHint
  ): Promise<CompanyInfo | null> {
    const lockKey = path.resolve(projectPath);
    const existingLock = this.inFlightProvisioning.get(lockKey);
    if (existingLock) {
      logCompany("Service", `ensureCompanyProvisioned awaiting in-flight provisioning for "${projectName}"`);
      return await existingLock;
    }

    const companyFilePath = path.join(projectPath, ".80degrees_company.json");
    if (!fsSync.existsSync(companyFilePath)) {
      return null;
    }
    const company: CompanyInfo = JSON.parse(await fs.readFile(companyFilePath, "utf-8"));
    const effectiveHint: AgentaSessionHint | undefined =
      sessionHint?.authState === "logged-out"
        ? sessionHint
        : {
            ...sessionHint,
            userId: company.agentaUserId,
            orgId: company.agentaWorkspaceId,
            projectId: company.agentaProjectId,
            apiKey: company.agentaApiKey,
          };
    const tenant = await agentaProvisioner.resolveActiveTenant(effectiveHint);
    if (!tenant) {
      company.status = "provisioning";
      const agentaBase = (process.env.AGENTA_WEB_URL || "http://localhost").replace(/\/$/, "");
      company.agentaUrl = `${agentaBase}/m`;
      return company;
    }

    // Verify the project still exists in Agenta before reusing it
    let projectStillExists = true;
    if (company.agentaProjectId) {
      if (tenant.projects && tenant.projects.length > 0) {
        projectStillExists = tenant.projects.some((p) => p.project_id === company.agentaProjectId);
      } else if (isPostgresConfigured()) {
        try {
          const dbCore = getCoreDb();
          const rows = await dbCore`SELECT id FROM projects WHERE id = ${company.agentaProjectId} LIMIT 1`;
          projectStillExists = Boolean(rows && rows.length > 0 && rows[0]?.id);
        } catch {}
      }
    }

    // If already active in the currently logged in user's organization, reuse it
    if (
      projectStillExists &&
      company.status === "active" &&
      company.agentaProjectId &&
      company.agentaWorkspaceId === tenant.orgId &&
      company.agentaUrl.includes(`/w/${tenant.orgId}/p/${company.agentaProjectId}`)
    ) {
      let updated = false;
      if (!company.agentaUserId && tenant.userId) {
        company.agentaUserId = tenant.userId;
        updated = true;
      }
      const liveAgents = await agentaProvisioner.fetchLiveProjectAgents(
        company.agentaProjectId,
        {
          userId: company.agentaUserId,
          apiKey: company.agentaApiKey,
          accessToken: sessionHint?.accessToken,
        }
      );
      if (Array.isArray(liveAgents)) {
        company.agents = liveAgents.map((ag) => ({
          id: ag.id,
          name: ag.name,
          role: ag.role,
          category: ag.category,
          initials: ag.initials,
          color: ag.color,
          model: ag.model || "gemini/gemini-2.5-flash",
          starterPrompts: ag.starterPrompts || [],
          workflowId: ag.workflowId,
          slug: ag.slug,
          templateKey: ag.templateKey,
          isCustom: Boolean(ag.isCustom),
        }));
        company.templateAgents = company.agents.map((a) => a.id);
        company.seeded = true;
        updated = true;
      }
      if (updated) {
        await fs.writeFile(companyFilePath, JSON.stringify(company, null, 2), "utf-8").catch(() => {});
      }
      logCompany("Service", `Company "${projectName}" is already provisioned in user org ${tenant.orgId}. Reusing & scheduling context sync.`);
      this.scheduleContextSync(projectPath, projectName, sessionHint, 300);
      return company;
    }
    // Double-check lock after async resolveActiveTenant
    const postTenantLock = this.inFlightProvisioning.get(lockKey);
    if (postTenantLock) {
      return await postTenantLock;
    }

    const reprovisionTask = (async (): Promise<CompanyInfo> => {
      logCompany("Service", `Re-provisioning company project in active user org ${tenant.orgId} (${tenant.orgName})...`);
      const contextBundle = await buildProjectContextBundle(
        projectPath,
        projectName,
        company.name,
        company.tagline,
        company.agents
      );
      const provisionResult = await agentaProvisioner.provisionCompanyAgents(
        company.name,
        projectName,
        BASELINE_COMPANY_AGENTS,
        contextBundle.description,
        sessionHint,
        contextBundle,
        { alreadySeeded: Boolean(company.seeded) }
      );
      logCompany("Service", `ensureCompanyProvisioned outcome:`, provisionResult);

      if (provisionResult.success && provisionResult.agentaProjectId) {
        company.status = "active";
        company.agentaProjectId = provisionResult.agentaProjectId;
        company.agentaWorkspaceId = provisionResult.agentaWorkspaceId;
        company.agentaUserId = provisionResult.agentaUserId || company.agentaUserId;
        company.agentaApiKey = provisionResult.agentaApiKey || company.agentaApiKey;
        company.agentaUrl = provisionResult.agentaUrl;
        company.seeded = true;
        if (Array.isArray(provisionResult.agents)) {
          company.agents = provisionResult.agents.map((ag) => ({
            id: ag.id,
            name: ag.name,
            role: ag.role,
            category: ag.category,
            initials: ag.initials,
            color: ag.color,
            model: ag.model || "gemini/gemini-2.5-flash",
            starterPrompts: ag.starterPrompts || [],
            workflowId: ag.workflowId,
            slug: ag.slug,
            templateKey: ag.templateKey,
            isCustom: Boolean(ag.isCustom),
          }));
          company.templateAgents = company.agents.map((a) => a.id);
        }
      } else {
        company.status = "provisioning";
        company.agentaUrl = provisionResult.agentaUrl || `${process.env.AGENTA_WEB_URL || "http://localhost"}/m`;
      }
      await fs.writeFile(companyFilePath, JSON.stringify(company, null, 2), "utf-8");
      return company;
    })();

    this.inFlightProvisioning.set(lockKey, reprovisionTask);
    try {
      return await reprovisionTask;
    } finally {
      if (this.inFlightProvisioning.get(lockKey) === reprovisionTask) {
        this.inFlightProvisioning.delete(lockKey);
      }
    }
  }

  /**
   * Deletes a company workspace, removes local files, and purges the project & agents from Agenta.
   */
  async deleteCompany(projectPath: string, projectName: string): Promise<boolean> {
    const companyFilePath = path.join(projectPath, ".80degrees_company.json");
    const companyDir = path.join(projectPath, "company");

    // 1. Read agentaProjectId before deleting file
    let agentaProjectId: string | undefined;
    if (fsSync.existsSync(companyFilePath)) {
      try {
        const company = JSON.parse(await fs.readFile(companyFilePath, "utf-8"));
        agentaProjectId = company.agentaProjectId;
      } catch {}
    }
    logCompany("Service", `deleteCompany called for "${projectName}" (agentaProjectId: ${agentaProjectId})`);

    // 2. Remove local files on disk
    if (fsSync.existsSync(companyFilePath)) {
      await fs.rm(companyFilePath, { force: true });
    }
    if (fsSync.existsSync(companyDir)) {
      await fs.rm(companyDir, { recursive: true, force: true });
    }

    // 3. Purge company project and its agents from Agenta via Admin API
    const apiUrl = (process.env.AGENTA_API_URL || "http://localhost/api").replace(/\/$/, "");
    const authKey = process.env.AGENTA_AUTH_KEY || "";

    if (agentaProjectId && authKey) {
      try {
        const delRes = await fetch(`${apiUrl}/admin/simple/accounts/projects/${agentaProjectId}`, {
          method: "DELETE",
          headers: {
            Authorization: `Access ${authKey}`,
          },
        });
        if (delRes.ok) {
          return true;
        }
      } catch (apiErr) {
        console.warn("[CompanyService] Could not delete company project via Agenta Admin API:", apiErr);
      }
    }

    // Fallback: Safe database deletion (only when local Postgres is enabled)
    if (isPostgresConfigured()) {
      try {
        const dbCore = getCoreDb();
        if (agentaProjectId) {
          await dbCore`DELETE FROM projects WHERE id = ${agentaProjectId} AND is_default = false`;
        } else {
          const legacyNameInAgenta = `${projectName} (Company)`;
          await dbCore`DELETE FROM projects WHERE (project_name ILIKE ${projectName} OR project_name ILIKE ${legacyNameInAgenta}) AND is_default = false`;
        }
      } catch (err) {
        console.warn("[CompanyService] Could not delete company project from Agenta DB:", err);
      }
    }
    return true;
  }

}

export const companyService = new CompanyService();
