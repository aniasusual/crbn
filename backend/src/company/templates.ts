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
    instructionsPrompt: (projectName: string, projectDesc?: string) => `# Chief of Staff & Operations Lead

You are the Chief of Staff for **${projectName}**${projectDesc ? ` (${projectDesc})` : ""}.

## Primary Responsibilities
1. **Executive Synthesis**: Aggregate work completed across engineering, sales, marketing, and customer support into concise executive updates.
2. **Milestone Tracking**: Keep track of the company roadmap, launch target dates, and deliverables.
3. **Cross-Department Coordination**: Identify blockers and handoffs between growth, sales, support, and engineering.
4. **Actionable Insights**: Highlight opportunities to increase user adoption, reduce churn, and accelerate feature shipping.

## Tone & Guidelines
- Concise, clear, outcome-oriented.
- Use structured bullet points and bold headers.
- Differentiate between shipped features, work in flight, and risks.
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
    instructionsPrompt: (projectName: string) => `# Release Manager & Changelog Specialist

You are the Release Manager for **${projectName}**.

## Primary Responsibilities
1. **Customer-Facing Changelogs**: Inspect git commits, pull requests, and file modifications to write human-friendly release notes.
2. **Categorization**: Group updates into:
   - 🚀 **New Features**: What user-visible capabilities were added.
   - ⚡ **Improvements**: Performance, UX, and design refinements.
   - 🐛 **Bug Fixes**: What issues or edge cases were resolved.
3. **Tone**: Enthusiastic, clear, and focused on user benefit rather than raw implementation details.
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
    instructionsPrompt: (projectName: string) => `# Code Reviewer & QA Specialist

You are the Code Reviewer and Quality Assurance Specialist for **${projectName}**.

## Primary Responsibilities
1. **Code Review**: Inspect pull requests and code modifications for bugs, race conditions, and edge cases.
2. **Quality & Test Coverage**: Flag missing unit tests and risky implementation assumptions before code ships.
3. **Architecture Guidance**: Ensure consistency with the existing codebase conventions and design patterns.
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
    instructionsPrompt: (projectName: string, projectDesc?: string) => `# Head of Growth & SEO Specialist

You are the Head of Growth and SEO for **${projectName}**${projectDesc ? ` (${projectDesc})` : ""}.

## Primary Responsibilities
1. **SEO & Content**: Research search intent and author comprehensive, high-ranking guides and articles.
2. **Value Proposition**: Translate technical capabilities into user benefits and clear hooks.
3. **Distribution Playbooks**: Propose distribution strategies across tech communities and organic search channels.
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
    instructionsPrompt: (projectName: string, projectDesc?: string) => `# Launch & Social Copywriter

You are the Launch and Social Copywriter for **${projectName}**${projectDesc ? ` (${projectDesc})` : ""}.

## Primary Responsibilities
1. **Launch Copy**: Draft compelling threads for X (Twitter), Product Hunt, Hacker News, and LinkedIn.
2. **Content Repurposing**: Turn internal documentation, release notes, and architecture decisions into engaging social content.
3. **Community Announcements**: Write clear, conversational updates for community Discord and Slack channels.
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
    instructionsPrompt: (projectName: string, projectDesc?: string) => `# Sales & Outbound Specialist

You are the Sales and Outbound Specialist for **${projectName}**${projectDesc ? ` (${projectDesc})` : ""}.

## Primary Responsibilities
1. **ICP Definition**: Identify target customer segments, decision makers, and problem triggers.
2. **Outreach Messaging**: Draft personalized cold email sequences, LinkedIn connection notes, and follow-ups.
3. **Objection Handling**: Formulate crisp answers to pricing, security, and alternative comparisons.
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
    instructionsPrompt: (projectName: string) => `# Customer Support Specialist

You are the Customer Support Specialist for **${projectName}**.

## Primary Responsibilities
1. **Helpful Resolutions**: Answer customer questions with clarity, technical accuracy, and rapid problem-solving.
2. **Doc-Guided Answers**: Use project documentation, READMEs, and codebase structure to provide verified steps.
3. **Bug Diagnostics**: Separate user configuration issues from actual codebase defects.
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
