import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { companyService } from "../src/company/company-service";
import {
  agentaProvisioner,
  buildSubagentReferenceTools,
  workflowRowToAgentMeta,
  type AgentTurnDispatchResult,
} from "../src/company/agenta-provisioner";
import {
  BASELINE_COMPANY_AGENTS,
  getCompanyRoster,
  LOCAL_ENGINEERING_UUID,
  resolveAgentMetadata,
  resolveAssigneeUuid,
} from "../src/company/templates";
import {
  buildBlackboardCliScript,
  buildProjectContextBundle,
  mergeCompanyContextIntoAgentsMd,
} from "../src/company/project-context";

describe("CompanyService & Template Scaffolding", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "company-test-"));
    // Create a mock package.json
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ name: "super-analytics", description: "Realtime web analytics engine" }, null, 2),
      "utf-8"
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  test("initializes company and scaffolds all 7 baseline Agenta packages", async () => {
    const company = await companyService.initializeCompany(tempDir, "super-analytics");

    expect(company.name).toBe("Super Analytics");
    expect(company.projectName).toBe("super-analytics");
    expect(company.agents.length).toBe(7);

    const agentIds = company.agents.map((a) => a.id);
    expect(agentIds).toEqual(["ops", "changelog", "qa", "growth", "copywriter", "sales", "support"]);

    // Verify company/COMPANY.md exists
    const companyMdPath = path.join(tempDir, "company", "COMPANY.md");
    expect(fsSync.existsSync(companyMdPath)).toBe(true);
    const companyMd = await fs.readFile(companyMdPath, "utf-8");
    expect(companyMd).toContain("Super Analytics");
    expect(companyMd).toContain("Realtime web analytics engine");

    // Verify .80degrees_company.json exists
    const companyJsonPath = path.join(tempDir, ".80degrees_company.json");
    expect(fsSync.existsSync(companyJsonPath)).toBe(true);
    const companyJson = JSON.parse(await fs.readFile(companyJsonPath, "utf-8"));
    expect(companyJson.agents.length).toBe(7);
    expect(companyJson.templateAgents.length).toBe(7);

    // Verify each agent has valid Agenta-native package structure
    for (const agentId of ["ops", "changelog", "qa", "growth", "copywriter", "sales", "support"]) {
      const agentDir = path.join(tempDir, "company", "agents", agentId);
      const pluginJsonPath = path.join(agentDir, "plugin.json");
      const agentsJsonPath = path.join(agentDir, "ai.agenta", "agents.json");
      const agentsMdPath = path.join(agentDir, "ai.agenta", "agents", agentId, "AGENTS.md");
      const setupMdPath = path.join(agentDir, "ai.agenta", "agents", agentId, "SETUP.md");

      expect(fsSync.existsSync(pluginJsonPath)).toBe(true);
      expect(fsSync.existsSync(agentsJsonPath)).toBe(true);
      expect(fsSync.existsSync(agentsMdPath)).toBe(true);
      expect(fsSync.existsSync(setupMdPath)).toBe(true);

      const pluginJson = JSON.parse(await fs.readFile(pluginJsonPath, "utf-8"));
      expect(pluginJson.name).toBe(agentId);
      expect(pluginJson.extensions?.["ai.agenta"]?.manifest).toBe("./ai.agenta/agents.json");

      const agentsJson = JSON.parse(await fs.readFile(agentsJsonPath, "utf-8"));
      expect(agentsJson.entry).toBe(agentId);
      expect(agentsJson.agents[agentId]).toBeDefined();
    }
  }, 30000);

  test("handles existing company project idempotently without creating duplicates", async () => {
    const first = await companyService.initializeCompany(tempDir, "super-analytics");
    const second = await companyService.initializeCompany(tempDir, "super-analytics");

    expect(first.agentaUrl).toBe(second.agentaUrl);
    expect(first.agents.length).toBe(7);
    expect(second.agents.length).toBe(7);
  }, 30000);

  test("deletes company workspace files and cascades deletion", async () => {
    await companyService.initializeCompany(tempDir, "super-analytics");
    expect(fsSync.existsSync(path.join(tempDir, ".80degrees_company.json"))).toBe(true);
    expect(fsSync.existsSync(path.join(tempDir, "company"))).toBe(true);

    const success = await companyService.deleteCompany(tempDir, "super-analytics");
    expect(success).toBe(true);
    expect(fsSync.existsSync(path.join(tempDir, ".80degrees_company.json"))).toBe(false);
    expect(fsSync.existsSync(path.join(tempDir, "company"))).toBe(false);
  }, 30000);


  test("maps live Agenta workflows (baseline, renamed, and custom) and respects deleted agents", async () => {
    const claimed = new Set<string>();

    const opsMeta = workflowRowToAgentMeta(
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Chief of Staff",
        slug: "weekly-report-abc123",
        description: "Executive & Company Coordinator",
        meta: { _ag: { template_origin: { key: "weekly-report" } } },
      },
      claimed
    );
    expect(opsMeta.id).toBe("ops");
    expect(opsMeta.initials).toBe("COS");
    expect(opsMeta.workflowId).toBe("11111111-1111-4111-8111-111111111111");
    expect(opsMeta.isCustom).toBe(false);

    const customMeta = workflowRowToAgentMeta(
      {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Reddit Growth Bot",
        slug: "reddit-growth-bot-xyz987",
        description: "Monitors subreddits and drafts helpful replies",
        meta: null,
      },
      claimed
    );
    expect(customMeta.id).toBe("reddit-growth-bot");
    expect(customMeta.initials).toBe("RGB");
    expect(customMeta.workflowId).toBe("22222222-2222-4222-8222-222222222222");
    expect(customMeta.isCustom).toBe(true);

    // Live roster with ONLY ops + custom agent (simulating that other baseline agents were deleted in Agenta)
    const liveList = [opsMeta, customMeta];
    const roster = getCompanyRoster(liveList);

    // Should contain ops, reddit-growth-bot, and local engineering — NOT deleted sales/qa/etc.
    expect(roster.map((r) => r.id)).toEqual(["ops", "reddit-growth-bot", "engineering"]);

    // Resolving active custom agent by slug, initials, name, or UUID returns its real workflowId
    expect(resolveAssigneeUuid("reddit-growth-bot", liveList)).toBe(
      "22222222-2222-4222-8222-222222222222"
    );
    expect(resolveAssigneeUuid("RGB", liveList)).toBe("22222222-2222-4222-8222-222222222222");
    expect(resolveAssigneeUuid("COS", liveList)).toBe("11111111-1111-4111-8111-111111111111");
    expect(resolveAssigneeUuid("ENG", liveList)).toBe(LOCAL_ENGINEERING_UUID);

    // Resolving a deleted agent ("sales" / "SO") against liveList returns undefined
    expect(resolveAgentMetadata("sales", liveList)).toBeUndefined();
    expect(resolveAssigneeUuid("sales", liveList)).toBeUndefined();

    // Context bundle COMPANY.md lists the custom agent and omits deleted agents
    const bundle = await buildProjectContextBundle(
      tempDir,
      "super-analytics",
      "Super Analytics",
      undefined,
      liveList
    );
    expect(bundle.companyMd).toContain("Reddit Growth Bot (`reddit-growth-bot` / `RGB`)");
    expect(bundle.companyMd).not.toContain("Sales & Outbound Lead");

    // Blackboard CLI script stamps selfAgentId and selfRole
    const cliFile = buildBlackboardCliScript(
      "super-analytics",
      8000,
      "00000000-0000-0000-0000-000000000001",
      "ApiKey test-key",
      {
        selfRole: customMeta.id,
        selfAgentId: customMeta.workflowId,
        selfAgentName: customMeta.name,
      }
    );
    expect(cliFile.path).toBe(".tools/bin/blackboard");
    expect(cliFile.content).toContain("22222222-2222-4222-8222-222222222222");
    expect(cliFile.content).toContain("reddit-growth-bot");
  });

  test("wakes up requesting agent with continuation turn when founder resolves approval", async () => {
    const company = await companyService.initializeCompany(tempDir, "super-analytics");
    const cwAgent = company.agents.find((a) => a.id === "copywriter")!;
    expect(cwAgent).toBeDefined();
    expect(cwAgent.workflowId).toBeDefined();

    const approvedPrompt = companyService.buildApprovalContinuationPrompt(
      {
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        action_type: "publish_post",
        status: "approved",
        founder_notes: "Looks great, ship it!",
        payload: {
          text: "Introducing Super Analytics v1.0",
          agent_role: "copywriter",
          session_id: "sess_cw_active_123",
        },
      },
      { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", title: "Draft launch tweet" }
    );
    expect(approvedPrompt).toContain("[Founder Approval Resolved: APPROVED]");
    expect(approvedPrompt).toContain('Founder Notes: "Looks great, ship it!"');
    expect(approvedPrompt).toContain("Draft launch tweet");
    expect(approvedPrompt).not.toContain("sess_cw_active_123");

    const rejectedPrompt = companyService.buildApprovalContinuationPrompt({
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      action_type: "publish_post",
      status: "rejected",
      founder_notes: "Make the hook shorter",
      payload: { text: "Long draft..." },
    });
    expect(rejectedPrompt).toContain("[Founder Approval Resolved: REJECTED]");
    expect(rejectedPrompt).toContain('Founder Notes: "Make the hook shorter"');
    expect(rejectedPrompt).toContain("Do NOT execute");

    // Mock callBlackboardApi for /approvals/:id/resolve and /tasks/:id
    const origCallBb = agentaProvisioner.callBlackboardApi.bind(agentaProvisioner);
    const bbCalls: Array<{ subPath: string; method: string; body?: unknown }> = [];
    agentaProvisioner.callBlackboardApi = async (_projId, subPath, method = "GET", body) => {
      bbCalls.push({ subPath, method, body });
      if (subPath.startsWith("/tasks/") && method === "GET") {
        return {
          status: 200,
          data: {
            task: {
              id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
              title: "Draft launch tweet",
              status: "review",
              assignee_agent_id: cwAgent.workflowId,
            },
          },
        };
      }
      if (subPath.startsWith("/tasks/") && method === "PATCH") {
        return { status: 200, data: { task: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ...(body as object) } } };
      }
      return {
        status: 200,
        data: {
          approval: {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            agent_id: cwAgent.workflowId,
            task_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            action_type: "publish_post",
            status: "approved",
            founder_notes: "Ship it now",
            payload: {
              text: "Launching Super Analytics!",
              agent_role: "copywriter",
              session_id: "sess_cw_live_999",
            },
          },
        },
      };
    };

    try {
      const res = await companyService.proxyBlackboardRequest(
        tempDir,
        "/approvals/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/resolve",
        "POST",
        { status: "approved", founder_notes: "Ship it now" }
      );
      expect(res.status).toBe(200);
      const data = res.data as { continuation?: AgentTurnDispatchResult };
      expect(data.continuation).toBeDefined();
      expect(data.continuation?.dispatched).toBe(true);
      expect(data.continuation?.agentId).toBe("copywriter");
      expect(data.continuation?.agentInitials).toBe("CW");
      expect(data.continuation?.workflowId).toBe(cwAgent.workflowId);
      expect(data.continuation?.sessionId).toBe("sess_cw_live_999");

      // Verify linked task was transitioned from review -> in_progress
      const patchCall = bbCalls.find((c) => c.method === "PATCH" && c.subPath.startsWith("/tasks/"));
      expect(patchCall).toBeDefined();
      const patchBody = patchCall?.body as { status?: string } | undefined;
      expect(patchBody?.status).toBe("in_progress");
    } finally {
      agentaProvisioner.callBlackboardApi = origCallBb;
    }
  });

  test("auto-triggers assigned specialist agents on task unblocking and git milestones", async () => {
    companyService.clearDispatchCooldowns();
    const company = await companyService.initializeCompany(tempDir, "super-analytics");
    const growthAgent = company.agents.find((a) => a.id === "growth")!;
    const cwAgent = company.agents.find((a) => a.id === "copywriter")!;

    const engTaskId = "10000000-0000-4000-8000-000000000001";
    const gtmTaskId = "20000000-0000-4000-8000-000000000002";
    const cwTaskId = "30000000-0000-4000-8000-000000000003";

    let gtmTaskUnblocked = false;
    const origCallBb = agentaProvisioner.callBlackboardApi.bind(agentaProvisioner);

    agentaProvisioner.callBlackboardApi = async (_projId, subPath, method = "GET", body) => {
      if (subPath === "/tasks?status=blocked" && method === "GET") {
        return {
          status: 200,
          data: {
            tasks: gtmTaskUnblocked
              ? []
              : [
                  {
                    id: gtmTaskId,
                    title: "Write SEO launch guide",
                    description: "Target analytics keywords",
                    status: "blocked",
                    priority: "high",
                    assignee_agent_id: growthAgent.workflowId,
                    dependencies: [engTaskId],
                  },
                ],
          },
        };
      }
      if (subPath === "/tasks?status=in_progress" && method === "GET") {
        return {
          status: 200,
          data: {
            tasks: gtmTaskUnblocked
              ? [
                  {
                    id: gtmTaskId,
                    title: "Write SEO launch guide",
                    description: "Target analytics keywords",
                    status: "in_progress",
                    priority: "high",
                    assignee_agent_id: growthAgent.workflowId,
                    dependencies: [engTaskId],
                  },
                ]
              : [
                  {
                    id: engTaskId,
                    title: "Build realtime funnel chart",
                    status: "in_progress",
                    priority: "high",
                  },
                ],
          },
        };
      }
      if (subPath === `/tasks/${engTaskId}` && method === "PATCH") {
        gtmTaskUnblocked = true;
        return {
          status: 200,
          data: {
            task: {
              id: engTaskId,
              title: "Build realtime funnel chart",
              status: "done",
              ...(body as object),
            },
          },
        };
      }
      if (subPath === `/tasks/${cwTaskId}` && method === "PATCH") {
        return {
          status: 200,
          data: {
            task: {
              id: cwTaskId,
              title: "Draft Product Hunt announcement",
              description: "Highlight funnel chart",
              status: "in_progress",
              priority: "urgent",
              assignee_agent_id: cwAgent.workflowId,
            },
          },
        };
      }
      return { status: 201, data: { artifact: { id: "art-1" } } };
    };

    try {
      // 1a. Default Git Milestone recording: auto-completes engTaskId and wakes newly unblocked gtmTaskId (GM),
      // WITHOUT spamming unrequested QA/RM/CW runs on every save.
      const defaultMilestoneRes = await companyService.recordGitMilestoneOnBlackboard(
        tempDir,
        "super-analytics",
        {
          step_id: "step_1",
          step_number: 1,
          commit_hash: "abcdef1234567890",
          prompt: "Build realtime funnel chart",
          timestamp: new Date().toISOString(),
        }
      );

      expect(defaultMilestoneRes.resolvedTaskId).toBe(engTaskId);
      expect(defaultMilestoneRes.unblockedDispatches.length).toBe(1);
      expect(defaultMilestoneRes.unblockedDispatches[0]?.dispatched).toBe(true);
      expect(defaultMilestoneRes.unblockedDispatches[0]?.agentId).toBe("growth");
      expect(defaultMilestoneRes.unblockedDispatches[0]?.agentInitials).toBe("GM");
      expect(defaultMilestoneRes.milestoneDispatches.length).toBe(0);

      // 1b. Explicit immediateMilestoneTriggers: true triggers QA + RM + CW in parallel
      companyService.clearDispatchCooldowns();
      gtmTaskUnblocked = false;
      const explicitMilestoneRes = await companyService.recordGitMilestoneOnBlackboard(
        tempDir,
        "super-analytics",
        {
          step_id: "step_2",
          step_number: 2,
          commit_hash: "fedcba0987654321",
          prompt: "Build realtime funnel chart",
          timestamp: new Date().toISOString(),
        },
        undefined,
        undefined,
        { immediateMilestoneTriggers: true }
      );
      const milestoneAgentIds = explicitMilestoneRes.milestoneDispatches.map((d) => d.agentId);
      expect(milestoneAgentIds).toContain("qa");
      expect(milestoneAgentIds).toContain("changelog");
      expect(milestoneAgentIds).toContain("copywriter");

      // 2. Test direct PATCH /tasks/:id to in_progress (clicking [ Unblock ] in UI) wakes assigned Copywriter
      const patchRes = await companyService.proxyBlackboardRequest(
        tempDir,
        `/tasks/${cwTaskId}`,
        "PATCH",
        { status: "in_progress" }
      );
      expect(patchRes.status).toBe(200);
      const patchData = patchRes.data as { continuation?: AgentTurnDispatchResult };
      expect(patchData.continuation?.dispatched).toBe(true);
      expect(patchData.continuation?.agentId).toBe("copywriter");
      expect(patchData.continuation?.agentInitials).toBe("CW");
    } finally {
      agentaProvisioner.callBlackboardApi = origCallBb;
    }
  });

  test("wires 1-hop Subagent references on Chief of Staff (ops) and auto-starts unblocked specialist tasks", async () => {
    companyService.clearDispatchCooldowns();
    const company = await companyService.initializeCompany(tempDir, "super-analytics");

    const customAgent = workflowRowToAgentMeta({
      id: "99999999-9999-4999-8999-999999999999",
      name: "Security Auditor",
      slug: "security-auditor-sec001",
      description: "Audits dependencies and auth flows",
      meta: null,
    });

    const activeRoster = [...company.agents, customAgent];
    const opsTools = buildSubagentReferenceTools("ops", activeRoster, [
      {
        type: "agenta_tools",
        tools: { get_current_session: "allow", rename_session: "allow" },
      },
      {
        type: "reference",
        ref_by: "variant",
        slug: "deleted-old-agent-xyz",
        description: "Stale deleted agent that should be removed",
      },
    ]);

    const refTools = opsTools.filter((t) => t.type === "reference");
    // 6 baseline specialists (changelog, qa, growth, copywriter, sales, support) + 1 custom agent = 7 subagents
    expect(refTools.length).toBe(7);
    expect(refTools.some((t) => t.slug === "security-auditor-sec001")).toBe(true);
    expect(refTools.some((t) => t.slug === "deleted-old-agent-xyz")).toBe(false);
    for (const ref of refTools) {
      expect(ref.ref_by).toBe("variant");
      const schema = ref.input_schema as {
        properties?: { messages?: { "x-ag-type-ref"?: string } };
      };
      expect(schema?.properties?.messages?.["x-ag-type-ref"]).toBe("messages");
    }

    // Specialist agents have 0 subagents (strictly 1-hop star topology)
    const qaTools = buildSubagentReferenceTools("qa", activeRoster);
    expect(qaTools.filter((t) => t.type === "reference").length).toBe(0);

    // Chief of Staff AGENTS.md lists attached subagents including custom agent
    const bundle = await buildProjectContextBundle(
      tempDir,
      "super-analytics",
      "Super Analytics",
      undefined,
      activeRoster
    );
    const opsTemplate = BASELINE_COMPANY_AGENTS.find((a) => a.id === "ops")!;
    const opsMd = mergeCompanyContextIntoAgentsMd(opsTemplate, bundle);
    expect(opsMd).toContain("Attached Subagents (1-Hop Direct Delegation)");
    expect(opsMd).toContain("**Security Auditor** (`security-auditor-sec001` / `SA`, Custom Agent)");

    // Creating a new unblocked task assigned to Sales (SO) via POST /tasks auto-sets status=in_progress and dispatches turn
    const salesAgent = company.agents.find((a) => a.id === "sales")!;
    const origCallBb = agentaProvisioner.callBlackboardApi.bind(agentaProvisioner);
    let capturedPostBody: Record<string, unknown> | undefined;
    agentaProvisioner.callBlackboardApi = async (_projId, subPath, method = "GET", body) => {
      if (subPath === "/tasks" && method === "POST") {
        capturedPostBody = body as Record<string, unknown>;
        return {
          status: 201,
          data: {
            task: {
              id: "55555555-5555-4555-8555-555555555555",
              title: "Draft outbound sequence",
              status: (capturedPostBody?.status as string) || "backlog",
              priority: "high",
              assignee_agent_id: salesAgent.workflowId,
              dependencies: [],
            },
          },
        };
      }
      return { status: 200, data: {} };
    };

    try {
      const createRes = await companyService.proxyBlackboardRequest(
        tempDir,
        "/tasks",
        "POST",
        {
          title: "Draft outbound sequence",
          priority: "high",
          assignee_role: "sales",
          dependencies: [],
        }
      );
      expect(createRes.status).toBe(201);
      expect(capturedPostBody?.status).toBe("in_progress");
      expect(capturedPostBody?.assignee_agent_id).toBe(salesAgent.workflowId);
      const createData = createRes.data as { continuation?: AgentTurnDispatchResult };
      expect(createData.continuation?.dispatched).toBe(true);
      expect(createData.continuation?.agentId).toBe("sales");
      expect(createData.continuation?.agentInitials).toBe("SO");
    } finally {
      agentaProvisioner.callBlackboardApi = origCallBb;
    }
  });

  test("fetches live Blackboard operating metrics for Companies Hub and invalidates cache on mutation", async () => {
    companyService.clearDispatchCooldowns();
    const company = await companyService.initializeCompany(tempDir, "super-analytics");

    let currentPendingApprovals = 2;
    let currentInProgress = 3;
    let briefingCalls = 0;
    const origCallBb = agentaProvisioner.callBlackboardApi.bind(agentaProvisioner);

    agentaProvisioner.callBlackboardApi = async (_projId, subPath, method = "GET") => {
      if (subPath.startsWith("/briefing") && method === "GET") {
        briefingCalls++;
        return {
          status: 200,
          data: {
            summary: "Operating normally",
            metrics: {
              total_tasks: 6,
              backlog: 1,
              in_progress: currentInProgress,
              review: 0,
              done: 1,
              blocked: 1,
              pending_approvals: currentPendingApprovals,
              total_artifacts: 4,
            },
          },
        };
      }
      return { status: 200, data: { approval: { id: "app-1", status: "approved" } } };
    };

    try {
      const metrics1 = await companyService.getCompanyBlackboardMetrics(company);
      expect(metrics1.totalTasks).toBe(6);
      expect(metrics1.inProgressTasks).toBe(3);
      expect(metrics1.pendingApprovals).toBe(2);
      expect(metrics1.blockedTasks).toBe(1);
      expect(metrics1.doneTasks).toBe(1);
      expect(metrics1.totalArtifacts).toBe(4);
      expect(briefingCalls).toBe(1);

      // Second call within TTL uses cache
      const metricsCached = await companyService.getCompanyBlackboardMetrics(company);
      expect(metricsCached.pendingApprovals).toBe(2);
      expect(briefingCalls).toBe(1);

      // Mutation via proxyBlackboardRequest invalidates metrics cache
      currentPendingApprovals = 1;
      currentInProgress = 4;
      await companyService.proxyBlackboardRequest(
        tempDir,
        "/approvals/11111111-1111-4111-8111-111111111111/resolve",
        "POST",
        { status: "approved" }
      );

      const metrics2 = await companyService.getCompanyBlackboardMetrics(company);
      expect(metrics2.pendingApprovals).toBe(1);
      expect(metrics2.inProgressTasks).toBe(4);
      expect(briefingCalls).toBe(2);
    } finally {
      agentaProvisioner.callBlackboardApi = origCallBb;
    }
  });

  test("dispatches multiple newly unblocked tasks (Sales + Growth) in parallel and executes CLI scripts in subprocess", async () => {
    companyService.clearDispatchCooldowns();
    const company = await companyService.initializeCompany(tempDir, "super-analytics");
    const growthAgent = company.agents.find((a) => a.id === "growth")!;
    const salesAgent = company.agents.find((a) => a.id === "sales")!;

    const engTaskId = "10000000-0000-4000-8000-000000000010";
    const gtmTaskId = "20000000-0000-4000-8000-000000000020";
    const salesTaskId = "30000000-0000-4000-8000-000000000030";

    let tasksUnblocked = false;
    const origCallBb = agentaProvisioner.callBlackboardApi.bind(agentaProvisioner);

    agentaProvisioner.callBlackboardApi = async (_projId, subPath, method = "GET", body) => {
      if (subPath === "/tasks?status=blocked" && method === "GET") {
        return {
          status: 200,
          data: {
            tasks: tasksUnblocked
              ? []
              : [
                  {
                    id: gtmTaskId,
                    title: "Launch SEO campaign",
                    status: "blocked",
                    priority: "high",
                    assignee_agent_id: growthAgent.workflowId,
                    dependencies: [engTaskId],
                  },
                  {
                    id: salesTaskId,
                    title: "Send outbound founder sequence",
                    status: "blocked",
                    priority: "urgent",
                    assignee_agent_id: salesAgent.workflowId,
                    dependencies: [engTaskId],
                  },
                ],
          },
        };
      }
      if (subPath === "/tasks?status=in_progress" && method === "GET") {
        return {
          status: 200,
          data: {
            tasks: tasksUnblocked
              ? [
                  {
                    id: gtmTaskId,
                    title: "Launch SEO campaign",
                    status: "in_progress",
                    priority: "high",
                    assignee_agent_id: growthAgent.workflowId,
                    dependencies: [engTaskId],
                  },
                  {
                    id: salesTaskId,
                    title: "Send outbound founder sequence",
                    status: "in_progress",
                    priority: "urgent",
                    assignee_agent_id: salesAgent.workflowId,
                    dependencies: [engTaskId],
                  },
                ]
              : [
                  {
                    id: engTaskId,
                    title: "Ship billing API",
                    status: "in_progress",
                    priority: "high",
                  },
                ],
          },
        };
      }
      if (subPath === `/tasks/${engTaskId}` && method === "PATCH") {
        tasksUnblocked = true;
        return {
          status: 200,
          data: {
            task: {
              id: engTaskId,
              title: "Ship billing API",
              status: "done",
              ...(body as object),
            },
          },
        };
      }
      return { status: 201, data: { artifact: { id: "art-parallel" } } };
    };

    try {
      const res = await companyService.recordGitMilestoneOnBlackboard(
        tempDir,
        "super-analytics",
        {
          step_id: "step_parallel",
          step_number: 3,
          commit_hash: "1122334455667788",
          prompt: "Ship billing API",
          timestamp: new Date().toISOString(),
        }
      );
      expect(res.unblockedDispatches.length).toBe(2);
      const dispatchedRoles = res.unblockedDispatches.map((d) => d.agentId).sort();
      expect(dispatchedRoles).toEqual(["growth", "sales"]);
    } finally {
      agentaProvisioner.callBlackboardApi = origCallBb;
    }

    // Verify .tools/bin/crbn-project fallback execution in a real shell subprocess
    const bundle = await buildProjectContextBundle(tempDir, "super-analytics", "Super Analytics");
    const agentFilesDir = path.join(tempDir, "agent-files", "project");
    await fs.mkdir(agentFilesDir, { recursive: true });
    await fs.writeFile(path.join(tempDir, "agent-files", "COMPANY.md"), bundle.companyMd, "utf-8");
    await fs.writeFile(path.join(agentFilesDir, "CODEBASE_MAP.md"), bundle.codebaseMapMd, "utf-8");

    const crbnProjectFile = bundle.mountFiles.find((m) => m.path === ".tools/bin/crbn-project")!;
    expect(crbnProjectFile).toBeDefined();
    const scriptPath = path.join(tempDir, "crbn-project");
    await fs.writeFile(scriptPath, crbnProjectFile.content, { mode: 0o755 });

    const proc = Bun.spawn(["sh", scriptPath, "summary"], {
      cwd: tempDir,
      env: { ...process.env, CRBN_BACKEND_PORT: "59998" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdout = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Super Analytics");
    expect(stdout).toContain("Realtime web analytics engine");
  });
});
