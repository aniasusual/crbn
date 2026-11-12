import { getCoreDb } from "./db";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { BASELINE_COMPANY_AGENTS, buildAgentPackageFiles, type AgentTemplatePackage } from "./templates";
import { agentaProvisioner } from "./agenta-provisioner";
import { logCompany } from "./logger";

export interface CompanyAgentSummary {
  id: string;
  name: string;
  role: string;
  category: string;
  initials: string;
  color: string;
  model: string;
  starterPrompts: string[];
  isCustom?: boolean;
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
  agentaUrl: string;
  status: "active" | "provisioning";
}

export class CompanyService {
  /**
   * Reads package.json and README.md from the project folder to extract relevant context.
   */
  private async readProjectContext(projectPath: string): Promise<{
    name: string;
    description: string;
  }> {
    let description = "Autonomous company application";
    let name = path.basename(projectPath);

    try {
      const pkgPath = path.join(projectPath, "package.json");
      if (fsSync.existsSync(pkgPath)) {
        const pkgContent = await fs.readFile(pkgPath, "utf-8");
        const pkg = JSON.parse(pkgContent);
        if (pkg.name) name = pkg.name;
        if (pkg.description) description = pkg.description;
      }
    } catch {}

    try {
      const readmePath = path.join(projectPath, "README.md");
      if (fsSync.existsSync(readmePath) && description === "Autonomous company application") {
        const readme = await fs.readFile(readmePath, "utf-8");
        const lines = readme.split("\n").map((l) => l.trim()).filter(Boolean);
        for (const line of lines) {
          if (!line.startsWith("#") && line.length > 20) {
            description = line.slice(0, 160);
            break;
          }
        }
      }
    } catch {}

    return { name, description };
  }

  /**
   * Initializes or refreshes the company workspace inside the project.
   */
  async initializeCompany(
    projectPath: string,
    projectName: string,
    data: { name?: string; tagline?: string } = {}
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

    const { description: projectDesc } = await this.readProjectContext(projectPath);

    const formattedName =
      (data.name || existing.name || projectName)
        .split(/[-_]+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ")
        .trim();

    const companyId = existing.id || `comp_${projectName.toLowerCase().replace(/[^a-z0-9_-]/g, "_")}`;
    const tagline =
      data.tagline || existing.tagline || `Autonomous business running ${formattedName}`;

    // 1. Scaffold company/COMPANY.md
    const companyMdPath = path.join(companyDir, "COMPANY.md");
    if (!fsSync.existsSync(companyMdPath)) {
      const companyMdContent = `# ${formattedName}

${tagline}

## Product Overview
${projectDesc}

## Autonomous Operating Departments
- **Chief of Staff (\`ops\`)**: Tracks operational roadmap, milestone progress, and cross-team synthesis.
- **Release Manager (\`changelog\`)**: Analyzes git commits, categorizes updates, and publishes clean release notes.
- **Code Reviewer & QA (\`qa\`)**: Reviews pull requests and diffs, flags regressions, and ensures test coverage.
- **Head of Growth & SEO (\`growth\`)**: Researches SEO search opportunities, crafts content marketing, and manages launches.
- **Launch & Social Copywriter (\`copywriter\`)**: Converts docs and feature releases into social threads and launch announcements.
- **Sales & Outbound Lead (\`sales\`)**: Defines Ideal Customer Profiles (ICPs) and drafts personalized outreach.
- **Customer Support Specialist (\`support\`)**: Triages customer inquiries, categorizes feedback, and drafts technical resolutions.
## Custom & Specialized Agents
Additional specialized agents live in \`company/custom/\` and can be configured through the Agenta dashboard.
`;
      await fs.writeFile(companyMdPath, companyMdContent, "utf-8");
    }

    // 2. Scaffold all 7 baseline Agenta packages in company/agents/<id>
    const agentSummaries: CompanyAgentSummary[] = [];

    for (const agent of BASELINE_COMPANY_AGENTS) {
      const agentFolder = path.join(agentsDir, agent.id);
      const agentPackageFiles = buildAgentPackageFiles(agent, formattedName, projectDesc);

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

    // 3. Resolve Agenta Web URL and provision baseline agents in Agenta dashboard
    const agentaBase = (process.env.AGENTA_WEB_URL || "http://localhost").replace(/\/$/, "");
    let agentaUrl = `${agentaBase}/m?project=${encodeURIComponent(projectName)}&company=${encodeURIComponent(companyId)}`;
    let status: "active" | "provisioning" = "provisioning";
    let agentaProjectId: string | undefined = undefined;
    let agentaWorkspaceId: string | undefined = undefined;

    try {
      logCompany("Service", `Calling agentaProvisioner.provisionCompanyAgents for "${formattedName}"...`);
      const provisionResult = await agentaProvisioner.provisionCompanyAgents(
        formattedName,
        projectName,
        BASELINE_COMPANY_AGENTS,
        projectDesc
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
      } else {
        status = "provisioning";
      }
    } catch (err) {
      logCompany("Service", `agentaProvisioner threw exception:`, err);
      status = "provisioning";
    }

    const companyInfo: CompanyInfo = {
      id: companyId,
      name: formattedName,
      tagline,
      projectName,
      projectPath,
      createdAt: existing.createdAt || new Date().toISOString(),
      agents: agentSummaries,
      templateAgents: agentSummaries.map((a) => a.id),
      agentaProjectId,
      agentaWorkspaceId,
      agentaUrl,
      status,
    };
    // 4. Save .80degrees_company.json
    await fs.writeFile(companyFilePath, JSON.stringify(companyInfo, null, 2), "utf-8");

    return companyInfo;
  }

  /**
   * If the user previously saw the login screen and has now logged in,
   * this builds the project and baseline templates in their newly authenticated organization.
   */
  async ensureCompanyProvisioned(
    projectPath: string,
    projectName: string
  ): Promise<CompanyInfo | null> {
    const companyFilePath = path.join(projectPath, ".80degrees_company.json");
    if (!fsSync.existsSync(companyFilePath)) {
      return null;
    }
    const company: CompanyInfo = JSON.parse(await fs.readFile(companyFilePath, "utf-8"));
    const tenant = await agentaProvisioner.resolveActiveTenant();

    if (!tenant) {
      company.status = "provisioning";
      const agentaBase = (process.env.AGENTA_WEB_URL || "http://localhost").replace(/\/$/, "");
      company.agentaUrl = `${agentaBase}/m`;
      return company;
    }

    // If already active in the currently logged in user's organization, reuse it
    if (
      company.status === "active" &&
      company.agentaProjectId &&
      company.agentaWorkspaceId === tenant.orgId &&
      company.agentaUrl.includes(`/w/${tenant.orgId}/p/${company.agentaProjectId}`)
    ) {
      logCompany("Service", `Company "${projectName}" is already provisioned in user org ${tenant.orgId}. Reusing.`);
      return company;
    }

    logCompany("Service", `Re-provisioning company project in active user org ${tenant.orgId} (${tenant.orgName})...`);
    // User logged in or switched organization; provision company project & baseline agents for active user
    const { description: projectDesc } = await this.readProjectContext(projectPath);
    const provisionResult = await agentaProvisioner.provisionCompanyAgents(
      company.name,
      projectName,
      BASELINE_COMPANY_AGENTS,
      projectDesc
    );
    logCompany("Service", `ensureCompanyProvisioned outcome:`, provisionResult);

    if (provisionResult.success && provisionResult.agentaProjectId) {
      company.status = "active";
      company.agentaProjectId = provisionResult.agentaProjectId;
      company.agentaWorkspaceId = provisionResult.agentaWorkspaceId;
      company.agentaUrl = provisionResult.agentaUrl;
    } else {
      company.status = "provisioning";
      company.agentaUrl = provisionResult.agentaUrl || `${process.env.AGENTA_WEB_URL || "http://localhost"}/m`;
    }
    await fs.writeFile(companyFilePath, JSON.stringify(company, null, 2), "utf-8");

    return company;
  }

  /**
   * Deletes a company workspace, removes local files, and purges the project & agents from Agenta.
   */
  async deleteCompany(projectPath: string, projectName: string): Promise<boolean> {
    const companyFilePath = path.join(projectPath, ".80degrees_company.json");
    const companyDir = path.join(projectPath, "company");

    // 1. Read agentaProjectId before deleting file
    let agentaProjectId: string | undefined;
    logCompany("Service", `deleteCompany called for "${projectName}" (agentaProjectId: ${agentaProjectId})`);
    if (fsSync.existsSync(companyFilePath)) {
      try {
        const company = JSON.parse(await fs.readFile(companyFilePath, "utf-8"));
        agentaProjectId = company.agentaProjectId;
      } catch {}
    }

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

    // Fallback: Safe database deletion (never delete an organization's default project)
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
    return true;
  }

}

export const companyService = new CompanyService();
