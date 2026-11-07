import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { PluginsService } from "../src/plugins-service";
import { createMarketplaceExtension } from "../src/marketplace-extension";
import { MCP_PRESETS, getMcpPreset } from "../src/mcp-presets";
import { readMCPConfigFile } from "../../pi-harness/packages/coding-agent/src/mcp/config-writer";
import type { ExtensionAPI } from "../../pi-harness/packages/coding-agent/src/index";

describe("Marketplace Agent Discovery & Configuration", () => {
  it("provides comprehensive MCP presets including browser, database, 3d, audio", () => {
    expect(MCP_PRESETS.length).toBeGreaterThan(10);
    const puppeteer = getMcpPreset("puppeteer");
    expect(puppeteer).toBeDefined();
    expect(puppeteer?.category).toBe("browser");
    expect(puppeteer?.command).toBe("npx");

    const polyPizza = getMcpPreset("poly-pizza");
    expect(polyPizza).toBeDefined();
    expect(polyPizza?.category).toBe("3d");

    const sqlite = getMcpPreset("sqlite");
    expect(sqlite).toBeDefined();
    expect(sqlite?.category).toBe("database");

    const github = getMcpPreset("github");
    expect(github).toBeDefined();
    expect(github?.requiresKey).toBe(true);
    expect(github?.requiredEnvKeys).toContain("GITHUB_PERSONAL_ACCESS_TOKEN");
  });

  it("PluginsService.searchCapabilities discovers plugins and MCP presets by keyword", async () => {
    const service = new PluginsService();

    // 1. Search for deployment plugins (e.g. vercel)
    const vercelResults = await service.searchCapabilities({ query: "vercel" });
    expect(vercelResults.length).toBeGreaterThan(0);
    const vercelPlugin = vercelResults.find((r) => r.name === "vercel" || r.id.includes("vercel"));
    expect(vercelPlugin).toBeDefined();
    expect(vercelPlugin?.type).toBe("plugin");
    expect(vercelPlugin?.category).toBe("deployment");

    // 2. Search for browser MCP servers (e.g. puppeteer)
    const puppeteerResults = await service.searchCapabilities({ query: "puppeteer" });
    expect(puppeteerResults.length).toBeGreaterThan(0);
    const puppeteerMcp = puppeteerResults.find((r) => r.id === "mcp:puppeteer");
    expect(puppeteerMcp).toBeDefined();
    expect(puppeteerMcp?.type).toBe("mcp");
    expect(puppeteerMcp?.category).toBe("browser");

    // 3. Search filtered by type
    const mcpOnly = await service.searchCapabilities({ query: "git", type: "mcp" });
    expect(mcpOnly.every((r) => r.type === "mcp")).toBe(true);

    const pluginOnly = await service.searchCapabilities({ query: "deploy", type: "plugin" });
    expect(pluginOnly.every((r) => r.type === "plugin")).toBe(true);

    // 4. Search filtered by category
    const dbResults = await service.searchCapabilities({ category: "database" });
    expect(dbResults.length).toBeGreaterThan(0);
    expect(dbResults.every((r) => r.category === "database" || r.id.includes("mcp"))).toBe(true);
  });

  it("createMarketplaceExtension registers discovery and installation tools", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "marketplace-test-"));
    let pluginsReloadCount = 0;
    let mcpReloadCount = 0;

    const pluginsService = new PluginsService();
    interface MockRegisteredTool {
      name: string;
      label: string;
      description: string;
      parameters: unknown;
      execute: (toolCallId: string, params: Record<string, unknown>) => Promise<{ content: Array<{ type: string; text: string }> }>;
    }
    const registeredTools = new Map<string, MockRegisteredTool>();

    interface MockSchemaField {
      type: string;
      optional: () => MockSchemaField;
      describe: (desc: string) => MockSchemaField;
      default?: (val: unknown) => MockSchemaField;
      values?: readonly string[];
    }

    const createMockField = (type: string, extra?: Record<string, unknown>): MockSchemaField => {
      const field: MockSchemaField = {
        type,
        ...extra,
        optional: () => field,
        describe: () => field,
        default: () => field,
      };
      return field;
    };

    const mockApi = {
      zod: {
        object: (fields: Record<string, unknown>) => ({ type: "object", fields }),
        string: () => createMockField("string"),
        enum: (values: readonly string[]) => createMockField("enum", { values }),
        number: () => createMockField("number"),
        record: () => createMockField("record"),
        array: () => createMockField("array"),
      },
      registerTool: (tool: MockRegisteredTool) => {
        registeredTools.set(tool.name, tool);
      },
    };

    const factory = createMarketplaceExtension({
      pluginsService,
      getProjectPath: () => tmpDir,
      onReloadPlugins: async () => {
        pluginsReloadCount++;
      },
      onReloadMcp: async () => {
        mcpReloadCount++;
      },
    });

    factory(mockApi as unknown as ExtensionAPI);

    expect(registeredTools.has("marketplace_search")).toBe(true);
    expect(registeredTools.has("marketplace_install_plugin")).toBe(true);
    expect(registeredTools.has("marketplace_configure_mcp")).toBe(true);

    // Test marketplace_search execution
    const searchTool = registeredTools.get("marketplace_search")!;
    const searchRes = await searchTool.execute("call-1", { query: "vercel", type: "all" });
    expect(searchRes.content[0].text).toContain("vercel");
    expect(searchRes.content[0].text).toContain("marketplace_install_plugin");

    // Test marketplace_configure_mcp validation for missing auth key
    const mcpTool = registeredTools.get("marketplace_configure_mcp")!;
    const githubResWithoutKey = await mcpTool.execute("call-2", { presetId: "github" });
    expect(githubResWithoutKey.content[0].text).toContain("requires authentication");
    expect(githubResWithoutKey.content[0].text).toContain("GITHUB_PERSONAL_ACCESS_TOKEN");

    // Test marketplace_configure_mcp for non-auth preset (e.g. poly-pizza)
    const polyPizzaRes = await mcpTool.execute("call-3", { presetId: "poly-pizza" });
    expect(polyPizzaRes.content[0].text).toContain("configured and connected successfully");
    expect(mcpReloadCount).toBe(1);

    // Verify .omp/mcp.json was created on disk with poly-pizza
    const mcpConfigPath = path.join(tmpDir, ".omp", "mcp.json");
    expect(fs.existsSync(mcpConfigPath)).toBe(true);
    const mcpConfig = await readMCPConfigFile(mcpConfigPath);
    expect(mcpConfig.mcpServers["poly-pizza"]).toBeDefined();
    expect(mcpConfig.mcpServers["poly-pizza"].command).toBe("npx");

    // Test unknown preset handling
    const unknownRes = await mcpTool.execute("call-4", { presetId: "nonexistent-preset-123" });
    expect(unknownRes.content[0].text).toContain("Unknown MCP preset");
    expect(unknownRes.content[0].text).toContain("Available presets");

    // Test marketplace_install_plugin execution with spy
    const installTool = registeredTools.get("marketplace_install_plugin")!;
    let installedSpec = "";
    pluginsService.installPlugin = async (opts: { spec: string; type: string; scope?: string; projectPath?: string }) => {
      installedSpec = opts.spec;
      return { success: true, id: opts.spec };
    };

    const installRes = await installTool.execute("call-5", { pluginId: "vercel" });
    expect(installedSpec).toContain("vercel");
    expect(installRes.content[0].text).toContain("installed successfully");
    expect(installRes.content[0].text).toContain("skill://vercel");
    expect(pluginsReloadCount).toBe(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
