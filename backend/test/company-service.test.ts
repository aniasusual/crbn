import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { companyService } from "../src/company/company-service";

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

});
