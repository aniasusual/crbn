export interface AgentTemplatePackage {
  id: string;
  templateKey: string;
  name: string;
  category: "Operations" | "Engineering" | "Marketing" | "Sales" | "Support" | "Knowledge";
  role: string;
  description: string;
  initials: string;
  color: string;
  model: string;
  starterPrompts: string[];
  connections: Array<{
    key: string;
    required: boolean;
    purpose: string;
    options: Array<{
      kind: "gateway" | "mcp" | "internal";
      provider: string;
      integration?: string;
    }>;
    setup_notes?: string;
  }>;
  instructionsPrompt: (projectName: string, projectDesc?: string) => string;
  setupGuide: string;
}

export const BASELINE_COMPANY_AGENTS: AgentTemplatePackage[] = [
  {
    id: "ops",
    templateKey: "weekly-report",
    name: "Chief of Staff",
    category: "Operations",
    role: "Executive & Company Coordinator",
    description: "Tracks company milestones, aggregates updates from all departments, and compiles weekly executive briefs.",
    initials: "COS",
    color: "#1E3A8A",
    model: "gemini/gemini-2.5-flash",
    starterPrompts: [
      "Summarize current company status and upcoming milestones",
      "Compile this week's executive brief from recent progress",
      "Coordinate next steps between marketing, sales, and engineering"
    ],
    connections: [
      {
        key: "workspace-repo-access",
        required: true,
        purpose: "Inspect project workspace and file changes",
        options: [{ kind: "internal", provider: "80degrees" }],
        setup_notes: "Connected to project workspace files"
      },
      {
        key: "publish-executive-report",
        required: false,
        purpose: "Publish weekly digests and operational briefs",
        options: [
          { kind: "gateway", provider: "composio", integration: "slack" },
          { kind: "gateway", provider: "composio", integration: "notion" }
        ],
        setup_notes: "Post company reports to Slack or Notion"
      }
    ],
    instructionsPrompt: (projectName: string, projectDesc?: string) => `# Chief of Staff — ${projectName}

You are the Chief of Staff and Single Executive Orchestrator for **${projectName}**${projectDesc ? ` (${projectDesc})` : ""}.

## Execution & Delegation Rules
- **Ground Truth First**: Read \`agent-files/COMPANY.md\`, \`agent-files/project/GIT_HISTORY.md\`, and run \`.tools/bin/blackboard briefing\` before answering status or roadmap questions. Never ask the founder to fill out setup templates or describe the app from scratch.
- **Direct Subagent Delegation (Immediate Execution)**: All active company specialists (QA, Release Manager, Head of Growth, Copywriter, Sales Lead, Customer Support, and any custom agents) are attached to you as **Subagents**. Call your Subagent tools directly whenever a request needs immediate code review, release notes, SEO research, launch copy, outbound sequences, or support triage. When a task spans multiple independent departments (e.g., Marketing + Sales), invoke those Subagents **in parallel in the same turn**.
- **Answering Subagent Questions**: If a Subagent asks a clarifying question in its tool response, answer it yourself using \`agent-files/COMPANY.md\` and \`agent-files/project/\` and call the Subagent again. Only ask the founder if the decision requires human business input.
- **Blackboard Task Decomposition**: Use \`.tools/bin/blackboard task-create "<title>" "<scope>" <priority> [dep_uuid] [assignee]\` to schedule coding work for the local 80degrees Engineering Agent (\`engineering\`) or to track multi-step dependency chains on the Kanban board.
- **Founder Gatekeeping**: Never auto-approve high-stakes external actions. Queue any production deploy, public social post, outbound email campaign, or refund via \`.tools/bin/blackboard approval-request <type> '<json>'\`.
`,
    setupGuide: `# Chief of Staff Setup

The Chief of Staff monitors progress across your project workspace.

### Integrations
- **Workspace Files**: Automatically bound to your project.
- **Slack / Notion (Optional)**: Connect to automatically publish weekly company updates to your team channel or knowledge base.
`
  },
  {
    id: "changelog",
    templateKey: "changelog-writer",
    name: "Release Manager",
    category: "Engineering",
    role: "Changelog & Release Specialist",
    description: "Transforms git commits into polished, customer-facing release notes and publishes changelogs.",
    initials: "RM",
    color: "#0F766E",
    model: "gemini/gemini-2.5-flash",
    starterPrompts: [
      "Draft a changelog from recent git commits",
      "Prepare release notes for our next version release",
      "Categorize our latest updates into features, improvements, and fixes"
    ],
    connections: [
      {
        key: "git-commits-and-diffs",
        required: true,
        purpose: "Read repository git history and commit diffs",
        options: [
          { kind: "gateway", provider: "composio", integration: "github" },
          { kind: "internal", provider: "80degrees" }
        ],
        setup_notes: "Read commits, pull requests, and releases"
      }
    ],
    instructionsPrompt: (projectName: string) => `# Release Manager — ${projectName}

You are the Release Manager for **${projectName}**.

## Execution Rules
- **Inspect Real Commits**: Read \`agent-files/project/GIT_HISTORY.md\` (or run \`.tools/bin/crbn-project log\` and \`.tools/bin/crbn-project diff\`) to inspect actual commits and modified files before writing release notes.
- **Structured Changelogs**: Group shipped changes into **New Features**, **Improvements**, and **Fixes** focused on user-visible value, and publish completed notes via \`.tools/bin/blackboard artifact-create generic "<version> Release Notes" '<json>'\`.
`,
    setupGuide: `# Release Manager Setup

The Release Manager reads code changes to craft release notes and track QA.

### Integrations
- **GitHub / Git**: Connected to repository history to parse commit messages and PR diffs.
`
  },
  {
    id: "qa",
    templateKey: "pr-reviewer",
    name: "Code Reviewer & QA",
    category: "Engineering",
    role: "Code Integrity & Architecture Specialist",
    description: "Reviews pull requests, flags breaking changes, checks test coverage, and ensures architecture standards.",
    initials: "QA",
    color: "#2563EB",
    model: "gemini/gemini-2.5-flash",
    starterPrompts: [
      "Review our latest code changes for potential regressions",
      "Check our changed files for edge cases or missing tests",
      "Analyze the diff of our recent commits for performance bottlenecks"
    ],
    connections: [
      {
        key: "read-the-diff-and-post-review-comments",
        required: true,
        purpose: "Read code diffs and provide inline comments",
        options: [
          { kind: "gateway", provider: "composio", integration: "github" },
          { kind: "internal", provider: "80degrees" }
        ],
        setup_notes: "Read PR diffs and provide architectural reviews"
      }
    ],
    instructionsPrompt: (projectName: string) => `# Code Reviewer & QA — ${projectName}

You are the Code Reviewer & QA Specialist for **${projectName}**.

## Execution Rules
- **Inspect Actual Source & Diffs**: Read \`agent-files/project/GIT_HISTORY.md\`, \`agent-files/project/CODEBASE_MAP.md\`, and source files under \`agent-files/project/src/\` (or \`.tools/bin/crbn-project diff\`).
- **Actionable Defect Reporting**: Cite exact file paths, line numbers, and reproduction steps. For real bugs, publish a \`bug_reproduction\` artifact (\`.tools/bin/blackboard artifact-create bug_reproduction "<title>" '<json>'\`) or create a high-priority Kanban task so the founder can send it straight to the 80degrees coding agent.
`,
    setupGuide: `# Code Reviewer Setup

The Code Reviewer inspects code diffs and reviews pull requests.
`
  },
  {
    id: "growth",
    templateKey: "seo-content-agent",
    name: "Head of Growth & SEO",
    category: "Marketing",
    role: "SEO, Research & Content Lead",
    description: "Researches search demand, writes SEO articles, crafts launch campaigns, and designs growth loops.",
    initials: "GM",
    color: "#059669",
    model: "gemini/gemini-2.5-flash",
    starterPrompts: [
      "Draft an SEO article targeting search queries in our product's problem space",
      "Research competitor positioning and identify content opportunities",
      "Design a growth strategy to acquire our first 100 users"
    ],
    connections: [
      {
        key: "web-search-research",
        required: true,
        purpose: "Research search keywords, market competitors, and industry trends",
        options: [
          { kind: "internal", provider: "80degrees" },
          { kind: "gateway", provider: "composio", integration: "composio_search" }
        ],
        setup_notes: "Search engine analysis & web research"
      }
    ],
    instructionsPrompt: (projectName: string, projectDesc?: string) => `# Head of Growth & SEO — ${projectName}

You are the Head of Growth & SEO for **${projectName}**${projectDesc ? ` (${projectDesc})` : ""}.

## Execution Rules
- **Product-Grounded Positioning**: Read \`agent-files/COMPANY.md\` and \`agent-files/project/index.html\` / \`src/\` first so every keyword strategy, landing-page audit, and SEO article reflects the actual product features implemented in code.
- **Publish Research Artifacts**: Record keyword research and growth playbooks on the Blackboard via \`.tools/bin/blackboard artifact-create research "<title>" '<json>'\`.
`,
    setupGuide: `# Growth Marketer Setup

The Growth Marketer researches target keywords and drafts acquisition content.
`
  },
  {
    id: "copywriter",
    templateKey: "content-repurposer",
    name: "Launch & Social Copywriter",
    category: "Marketing",
    role: "Social Media, Announcements & Copy Lead",
    description: "Turns documentation, shipped features, and releases into launch threads, LinkedIn posts, and announcements.",
    initials: "CW",
    color: "#D97706",
    model: "gemini/gemini-2.5-flash",
    starterPrompts: [
      "Draft a launch tweet thread highlighting key capabilities",
      "Write a LinkedIn announcement showcasing our product launch",
      "Create a newsletter update highlighting our newest features"
    ],
    connections: [
      {
        key: "social-media-publishing",
        required: false,
        purpose: "Publish launch updates to social accounts",
        options: [
          { kind: "gateway", provider: "composio", integration: "twitter" },
          { kind: "gateway", provider: "composio", integration: "linkedin" }
        ],
        setup_notes: "Draft and publish social updates"
      }
    ],
    instructionsPrompt: (projectName: string, projectDesc?: string) => `# Launch & Social Copywriter — ${projectName}

You are the Launch & Social Copywriter for **${projectName}**${projectDesc ? ` (${projectDesc})` : ""}.

## Execution Rules
- **Shipped-Feature Copy**: Read \`agent-files/COMPANY.md\` and \`agent-files/project/GIT_HISTORY.md\` first so every X thread, Product Hunt launch kit, and LinkedIn post highlights real capabilities built in the codebase.
- **Blackboard & Approval Workflow**: Save launch kits via \`.tools/bin/blackboard artifact-create launch_kit "<title>" '<json>'\` and queue public posts for 1-click sign-off via \`.tools/bin/blackboard approval-request publish_post '<json>'\`.
`,
    setupGuide: `# Copywriter Setup

The Launch & Social Copywriter turns project progress into social announcements.
`
  },
  {
    id: "sales",
    templateKey: "outbound-prospecting",
    name: "Sales & Outbound Lead",
    category: "Sales",
    role: "B2B Outreach & Lead Qualifier",
    description: "Defines ideal customer profiles (ICPs), drafts personalized cold emails, and qualifies prospective buyers.",
    initials: "SO",
    color: "#B45309",
    model: "gemini/gemini-2.5-flash",
    starterPrompts: [
      "Define our Ideal Customer Profile (ICP) and buyer personas",
      "Draft a 3-step cold email outreach sequence for founders",
      "Identify the top value triggers for our target customers"
    ],
    connections: [
      {
        key: "lead-crm-access",
        required: false,
        purpose: "Sync leads, email threads, and contact stages",
        options: [
          { kind: "gateway", provider: "composio", integration: "hubspot" },
          { kind: "gateway", provider: "composio", integration: "gmail" }
        ],
        setup_notes: "CRM and email outbound sync"
      }
    ],
    instructionsPrompt: (projectName: string, projectDesc?: string) => `# Sales & Outbound Lead — ${projectName}

You are the Sales & Outbound Lead for **${projectName}**${projectDesc ? ` (${projectDesc})` : ""}.

## Execution Rules
- **Codebase-Informed ICP**: Read \`agent-files/COMPANY.md\` first to ground ICP definitions, buyer pain points, and cold outreach sequences in the actual product capabilities.
- **Approval Gate**: Before sending any external campaign, queue the sequence for founder sign-off via \`.tools/bin/blackboard approval-request send_campaign '<json>'\`.
`,
    setupGuide: `# Sales & Outreach Setup

The Sales Lead coordinates lead enrichment and drafts outreach sequences.
`
  },
  {
    id: "support",
    templateKey: "support-reply-drafter",
    name: "Customer Support Specialist",
    category: "Support",
    role: "User Support & Technical Triage",
    description: "Triages customer feedback, diagnoses errors using project docs, and drafts technical resolutions.",
    initials: "CS",
    color: "#7C3AED",
    model: "gemini/gemini-2.5-flash",
    starterPrompts: [
      "Triage open user feedback and group by urgency",
      "Draft a helpful technical response to a user reporting an issue",
      "Generate an FAQ section from recurring user questions"
    ],
    connections: [
      {
        key: "support-channel-ingress",
        required: false,
        purpose: "Read support tickets and post answers",
        options: [
          { kind: "gateway", provider: "composio", integration: "discord" },
          { kind: "gateway", provider: "composio", integration: "slack" },
          { kind: "gateway", provider: "composio", integration: "zendesk" }
        ],
        setup_notes: "Receive tickets and send customer responses"
      }
    ],
    instructionsPrompt: (projectName: string) => `# Customer Support Specialist — ${projectName}

You are the Customer Support Specialist for **${projectName}**.

## Execution Rules
- **Verify Against Source Code**: Read \`agent-files/COMPANY.md\`, \`agent-files/project/CODEBASE_MAP.md\`, and relevant files in \`agent-files/project/src/\` to diagnose user issues accurately.
- **Escalate Code Defects to Blackboard**: When a user report reveals a code bug, publish a \`bug_reproduction\` artifact (\`.tools/bin/blackboard artifact-create bug_reproduction "<title>" '<json>'\`) so the founder can dispatch it to the 80degrees coding agent in 1 click.
`,
    setupGuide: `# Customer Support Setup

The Support Specialist handles customer inquiries and bug reports.
`
  }
];

export function buildAgentPackageFiles(
  agent: AgentTemplatePackage,
  projectName: string,
  projectDesc?: string
): {
  "plugin.json": string;
  "ai.agenta/agents.json": string;
  "ai.agenta/agents/AGENTS.md": string;
  "ai.agenta/agents/SETUP.md": string;
} {
  const pluginJson = JSON.stringify(
    {
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: agent.id,
      version: "1.0.0",
      description: agent.description,
      author: { name: "80degrees" },
      license: "Apache-2.0",
      keywords: [agent.category.toLowerCase(), "agent-template", "company", "80degrees"],
      extensions: {
        "ai.agenta": {
          manifest: "./ai.agenta/agents.json"
        }
      }
    },
    null,
    2
  );

  const agentsJson = JSON.stringify(
    {
      schema_version: 1,
      entry: agent.id,
      agents: {
        [agent.id]: {
          name: agent.name,
          description: agent.description,
          instructions: `./ai.agenta/agents/${agent.id}/AGENTS.md`,
          setup: `./ai.agenta/agents/${agent.id}/SETUP.md`,
          connections: agent.connections
        }
      }
    },
    null,
    2
  );

  const agentsMd = agent.instructionsPrompt(projectName, projectDesc);
  const setupMd = agent.setupGuide;

  return {
    "plugin.json": pluginJson,
    "ai.agenta/agents.json": agentsJson,
    "ai.agenta/agents/AGENTS.md": agentsMd,
    "ai.agenta/agents/SETUP.md": setupMd
  };
}

export interface ResolvedAgentMeta {
  id: string;
  name: string;
  role: string;
  category: string;
  initials: string;
  color: string;
  model?: string;
  starterPrompts?: string[];
  workflowId?: string;
  slug?: string;
  templateKey?: string;
  isCustom?: boolean;
  isEngineering?: boolean;
}

/**
 * Local crbn host coding agent (pi-harness). Runs locally in crbn IDE rather than as an Agenta workflow.
 * Uses a single reserved sentinel UUID only when persisting to Agenta's UUID-typed `assignee_agent_id` column.
 */
export const LOCAL_ENGINEERING_UUID = "00000000-0000-4000-8000-000000000e01";

export const ENGINEERING_AGENT_META: ResolvedAgentMeta = {
  id: "engineering",
  name: "Engineering Agent",
  role: "Full-Stack Coding & Dev Server Agent (80degrees IDE)",
  category: "Engineering",
  initials: "ENG",
  color: "#EA580C",
  workflowId: LOCAL_ENGINEERING_UUID,
  isCustom: false,
  isEngineering: true,
};

export const ROLE_ALIASES: Record<string, string> = {
  ops: "ops",
  cos: "ops",
  chief: "ops",
  "chief-of-staff": "ops",
  "weekly-report": "ops",
  changelog: "changelog",
  rm: "changelog",
  release: "changelog",
  "release-manager": "changelog",
  "changelog-writer": "changelog",
  qa: "qa",
  review: "qa",
  reviewer: "qa",
  "code-reviewer": "qa",
  "pr-reviewer": "qa",
  growth: "growth",
  gm: "growth",
  seo: "growth",
  marketing: "growth",
  "seo-content-agent": "growth",
  copywriter: "copywriter",
  cw: "copywriter",
  copy: "copywriter",
  social: "copywriter",
  "content-repurposer": "copywriter",
  sales: "sales",
  so: "sales",
  outbound: "sales",
  "outbound-prospecting": "sales",
  support: "support",
  cs: "support",
  customer: "support",
  "customer-support": "support",
  "support-reply-drafter": "support",
  engineering: "engineering",
  eng: "engineering",
  dev: "engineering",
  code: "engineering",
  coding: "engineering",
  builder: "engineering",
  cto: "engineering",
};

const CUSTOM_AGENT_PALETTE = [
  "#0284C7",
  "#9333EA",
  "#DB2777",
  "#0D9488",
  "#4F46E5",
  "#CA8A04",
  "#16A34A",
  "#DC2626",
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(val?: string | null): boolean {
  return Boolean(val && UUID_RE.test(val.trim()));
}

export function deriveAgentInitials(name?: string | null, slug?: string | null): string {
  const raw = (name || slug || "Agent").trim();
  const words = raw
    .replace(/[^a-zA-Z0-9\s_-]/g, " ")
    .split(/[\s_-]+/)
    .filter((w) => w && !["and", "of", "the", "for", "to"].includes(w.toLowerCase()));
  if (words.length >= 2) {
    return words
      .slice(0, 3)
      .map((w) => w.charAt(0).toUpperCase())
      .join("");
  }
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase() || "AG";
}

export function deriveCustomAgentColor(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return CUSTOM_AGENT_PALETTE[hash % CUSTOM_AGENT_PALETTE.length] || "#0284C7";
}

export function deriveCustomAgentRoleKey(
  name?: string | null,
  slug?: string | null,
  workflowId?: string | null
): string {
  const rawSlug = (slug || "")
    .toLowerCase()
    .trim()
    .replace(/-[a-z0-9]{6,12}$/, "");
  const base = (rawSlug || name || workflowId || "custom-agent")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || `agent-${(workflowId || "custom").slice(0, 8)}`;
}

/**
 * Matches an Agenta workflow artifact row to one of the 7 baseline templates (if it originated from one).
 */
export function matchBaselineAgentTemplate(row: {
  name?: string | null;
  slug?: string | null;
  meta?: { _ag?: { template_origin?: { key?: string } } } | null;
}): AgentTemplatePackage | undefined {
  const originKey = row.meta?._ag?.template_origin?.key?.toLowerCase().trim();
  const slugLower = (row.slug || "").toLowerCase().trim();
  const nameLower = (row.name || "").toLowerCase().trim();

  for (const tpl of BASELINE_COMPANY_AGENTS) {
    const tplKey = tpl.templateKey.toLowerCase();
    const idLower = tpl.id.toLowerCase();
    if (
      (originKey && originKey === tplKey) ||
      slugLower === tplKey ||
      slugLower.startsWith(`${tplKey}-`) ||
      slugLower === idLower ||
      slugLower.startsWith(`${idLower}-`) ||
      nameLower === tpl.name.toLowerCase()
    ) {
      return tpl;
    }
  }
  return undefined;
}

/**
 * Returns the active company roster.
 * - When `companyAgents` is provided (synced from live Agenta workflows), ONLY those live agents
 *   (plus the local `engineering` agent) are included—so deleted agents stay deleted and new custom
 *   agents are included automatically.
 * - When `companyAgents` is undefined (before initial provisioning), falls back to BASELINE_COMPANY_AGENTS.
 */
export function getCompanyRoster(
  companyAgents?: Array<Partial<ResolvedAgentMeta>>
): ResolvedAgentMeta[] {
  if (Array.isArray(companyAgents)) {
    const roster: ResolvedAgentMeta[] = [];
    for (const ag of companyAgents) {
      if (!ag || (!ag.id && !ag.workflowId)) continue;
      if (ag.id === "engineering" || ag.isEngineering) continue;
      const baseTpl = BASELINE_COMPANY_AGENTS.find(
        (b) => b.id === ag.id || (ag.templateKey && b.templateKey === ag.templateKey)
      );
      const effectiveName = ag.name || baseTpl?.name || ag.id || "Agent";
      const wasRenamed = baseTpl && ag.name && ag.name.toLowerCase() !== baseTpl.name.toLowerCase();
      roster.push({
        id: ag.id || deriveCustomAgentRoleKey(ag.name, ag.id, ag.workflowId),
        name: effectiveName,
        role: ag.role || baseTpl?.role || "Specialist Agent",
        category: ag.category || baseTpl?.category || "Custom",
        initials:
          wasRenamed
            ? deriveAgentInitials(effectiveName)
            : ag.initials || baseTpl?.initials || deriveAgentInitials(effectiveName, ag.id),
        color: ag.color || baseTpl?.color || deriveCustomAgentColor(ag.workflowId || ag.id || effectiveName),
        model: ag.model || baseTpl?.model || "gemini/gemini-2.5-flash",
        starterPrompts: ag.starterPrompts || baseTpl?.starterPrompts || [],
        workflowId: ag.workflowId,
        slug: ag.slug,
        templateKey: ag.templateKey || baseTpl?.templateKey,
        isCustom: ag.isCustom ?? !baseTpl,
        isEngineering: false,
      });
    }
    roster.push({ ...ENGINEERING_AGENT_META });
    return roster;
  }

  return [
    ...BASELINE_COMPANY_AGENTS.map((base) => ({
      id: base.id,
      name: base.name,
      role: base.role,
      category: base.category,
      initials: base.initials,
      color: base.color,
      model: base.model,
      starterPrompts: base.starterPrompts,
      templateKey: base.templateKey,
      isCustom: false,
      isEngineering: false,
    })),
    { ...ENGINEERING_AGENT_META },
  ];
}

/**
 * Resolves an agent from the live company roster by its Agenta `workflowId` UUID,
 * role slug, alias, initials, or display name.
 * Returns `undefined` if the agent was deleted or does not exist in the active roster.
 */
export function resolveAgentMetadata(
  input?: string | null,
  companyAgents?: Array<Partial<ResolvedAgentMeta>>
): ResolvedAgentMeta | undefined {
  if (!input || typeof input !== "string") return undefined;
  const raw = input.trim();
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  const roster = getCompanyRoster(companyAgents);

  // 1. Exact workflowId UUID match (or local engineering sentinel UUID)
  if (isValidUuid(lower)) {
    if (lower === LOCAL_ENGINEERING_UUID) {
      return roster.find((r) => r.isEngineering);
    }
    return roster.find((r) => r.workflowId?.toLowerCase() === lower);
  }

  // 2. Role alias match (only if that agent is currently present in the live roster!)
  const canonicalRole = ROLE_ALIASES[lower];
  if (canonicalRole) {
    const found = roster.find((r) => r.id.toLowerCase() === canonicalRole);
    if (found) return found;
  }

  // 3. Direct match on live roster id, initials, templateKey, or name
  return (
    roster.find((r) => r.id.toLowerCase() === lower) ||
    roster.find((r) => r.slug?.toLowerCase() === lower) ||
    roster.find((r) => r.initials.toLowerCase() === lower) ||
    roster.find((r) => r.templateKey?.toLowerCase() === lower) ||
    roster.find((r) => r.name.toLowerCase() === lower) ||
    roster.find(
      (r) =>
        lower.startsWith(`${r.id.toLowerCase()}-`) ||
        r.name.toLowerCase().includes(lower)
    )
  );
}

/**
 * Resolves an assignee identifier (workflow UUID, role slug, initials, or name)
 * to the agent's real Agenta `workflowId` UUID (or `LOCAL_ENGINEERING_UUID` for host engineering).
 * Returns `undefined` if the agent does not exist or has no live UUID.
 */
export function resolveAssigneeUuid(
  input?: string | null,
  companyAgents?: Array<Partial<ResolvedAgentMeta>>
): string | undefined {
  if (!input || typeof input !== "string") return undefined;
  const raw = input.trim();
  if (!raw) return undefined;

  const meta = resolveAgentMetadata(raw, companyAgents);
  if (meta?.workflowId && isValidUuid(meta.workflowId)) {
    return meta.workflowId;
  }

  // If caller passed a raw UUID that exists in the live roster (or is valid UUID when roster not loaded)
  if (isValidUuid(raw)) {
    if (!companyAgents || companyAgents.length === 0) {
      return raw.toLowerCase();
    }
  }
  return undefined;
}

/**
 * Builds a lookup map of `{ [aliasOrSlugOrInitialsOrName]: realWorkflowUuid }` strictly from
 * the currently active agents in the company.
 */
export function buildLiveAgentLookupMap(
  companyAgents?: Array<Partial<ResolvedAgentMeta>>
): Record<string, string> {
  const map: Record<string, string> = {};
  const roster = getCompanyRoster(companyAgents);
  for (const agent of roster) {
    if (!agent.workflowId || !isValidUuid(agent.workflowId)) continue;
    const uuid = agent.workflowId;
    map[uuid.toLowerCase()] = uuid;
    map[agent.id.toLowerCase()] = uuid;
    map[agent.initials.toLowerCase()] = uuid;
    map[agent.name.toLowerCase()] = uuid;
    if (agent.slug) {
      map[agent.slug.toLowerCase()] = uuid;
    }
    if (agent.templateKey) {
      map[agent.templateKey.toLowerCase()] = uuid;
    }
    for (const [alias, targetRole] of Object.entries(ROLE_ALIASES)) {
      if (targetRole === agent.id.toLowerCase()) {
        map[alias] = uuid;
      }
    }
  }
  return map;
}
