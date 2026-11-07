import * as path from "node:path";
import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionFactory } from "../../pi-harness/packages/coding-agent/src/index";
import { updateMCPServer } from "../../pi-harness/packages/coding-agent/src/mcp/config-writer";
import type { MCPServerConfig } from "../../pi-harness/packages/coding-agent/src/mcp/types";
import type { PluginsService } from "./plugins-service";
import { getMcpPreset, MCP_PRESETS } from "./mcp-presets";
import { parsePluginId } from "../../pi-harness/packages/coding-agent/src/extensibility/plugins/marketplace/types";

export interface MarketplaceExtensionOptions {
  pluginsService: PluginsService;
  getProjectPath: () => string;
  onReloadPlugins: () => Promise<unknown>;
  onReloadMcp: () => Promise<unknown>;
}

export function createMarketplaceExtension(options: MarketplaceExtensionOptions): ExtensionFactory {
  return (pi: ExtensionAPI) => {
    const z = pi.zod;

    // 1. Tool: marketplace_search
    pi.registerTool({
      name: "marketplace_search",
      label: "Marketplace Search",
      description:
        "Search the official catalog for plugins and Model Context Protocol (MCP) servers to handle deployments (Vercel, Railway, Cloudflare, AWS), databases (Supabase, Postgres, SQLite), testing/browsers (Puppeteer, Chrome DevTools), 3D assets, audio, and tools.",
      parameters: z.object({
        query: z.string().optional().describe("Search keyword, e.g. 'vercel', 'deploy', 'database', 'postgres', '3d', 'browser', 'testing', 'github'"),
        category: z.string().optional().describe("Category filter, e.g. 'deployment', 'database', 'security', 'design', 'browser', 'tools', 'monitoring'"),
        type: z.enum(["all", "plugin", "mcp"]).optional().default("all").describe("Filter by 'plugin', 'mcp', or 'all'"),
        limit: z.number().optional().default(10).describe("Maximum number of results (default 10)"),
      }),
      execute: async (_toolCallId, params) => {
        try {
          const projectPath = options.getProjectPath();
          const results = await options.pluginsService.searchCapabilities({
            query: params.query,
            category: params.category,
            type: params.type || "all",
            projectPath,
            limit: params.limit || 10,
          });

          if (results.length === 0) {
            return {
              content: [
                {
                  type: "text",
                  text: `No matching capabilities found for query: "${params.query || ""}" ${params.category ? `in category '${params.category}'` : ""}. Try broader search keywords.`,
                },
              ],
            };
          }

          const lines = [
            `### Marketplace Search Results (${results.length} found)`,
            "",
          ];

          for (const item of results) {
            const statusBadge = item.installed ? "[INSTALLED]" : "[AVAILABLE]";
            const typeLabel = item.type === "plugin" ? "Plugin" : "MCP Server";
            lines.push(`- **${item.name}** (\`${item.id}\`) ${statusBadge}`);
            lines.push(`  - **Type**: ${typeLabel} | **Category**: ${item.category || "general"}`);
            if (item.description) {
              const snippet = item.description.length > 200 ? item.description.slice(0, 197) + "..." : item.description;
              lines.push(`  - **Description**: ${snippet}`);
            }
            if (item.requiresAuth) {
              lines.push(`  - **Auth**: Requires API key or token (${item.authHint || item.requiredEnvKeys?.join(", ") || "token required"})`);
            }
            if (item.type === "plugin") {
              lines.push(`  - **Action to Install**: \`marketplace_install_plugin(pluginId: "${item.id}")\``);
            } else {
              const presetId = item.id.replace(/^mcp:/, "");
              lines.push(`  - **Action to Enable**: \`marketplace_configure_mcp(presetId: "${presetId}")\``);
            }
            lines.push("");
          }

          return {
            content: [{ type: "text", text: lines.join("\n") }],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to search marketplace: ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    });

    // 2. Tool: marketplace_install_plugin
    pi.registerTool({
      name: "marketplace_install_plugin",
      label: "Install Marketplace Plugin",
      description:
        "Install a plugin from the marketplace (e.g. 'vercel', 'railway', 'cloudflare', 'supabase') and dynamically hot-reload its tools and skills into the active session.",
      parameters: z.object({
        pluginId: z.string().describe("The plugin name or ID, e.g. 'vercel' or 'vercel@claude-plugins-official'"),
        scope: z.enum(["project", "user"]).optional().default("project").describe("Install scope: 'project' (default) or 'user'"),
      }),
      execute: async (_toolCallId, params) => {
        try {
          const projectPath = options.getProjectPath();
          let spec = params.pluginId.trim();

          // If raw name provided without marketplace suffix, resolve the full ID from catalog
          if (!spec.includes("@")) {
            const matches = await options.pluginsService.discoverMarketplacePlugins({
              query: spec,
              projectPath,
            });
            const exact = matches.find((m) => m.name.toLowerCase() === spec.toLowerCase());
            if (exact) {
              spec = exact.id;
            } else if (matches.length > 0) {
              spec = matches[0].id;
            } else {
              spec = `${spec}@claude-plugins-official`;
            }
          }

          const parsed = parsePluginId(spec);
          const pluginName = parsed ? parsed.name : spec;

          // Install via PluginsService
          const installResult = await options.pluginsService.installPlugin({
            spec,
            type: "marketplace",
            scope: params.scope || "project",
            projectPath,
          });

          // Hot reload session
          await options.onReloadPlugins();

          return {
            content: [
              {
                type: "text",
                text: [
                  `Plugin "${installResult.id}" installed successfully in ${params.scope || "project"} scope.`,
                  "",
                  "Skills and tools from this plugin are now live in this session.",
                  `If this plugin provides documentation or deployment workflows, consult \`skill://${pluginName}\` using the \`read\` tool.`,
                ].join("\n"),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to install plugin "${params.pluginId}": ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    });

    // 3. Tool: marketplace_configure_mcp
    pi.registerTool({
      name: "marketplace_configure_mcp",
      label: "Configure MCP Server",
      description:
        "Enable and configure a Model Context Protocol (MCP) server preset (e.g. 'puppeteer', 'poly-pizza', 'sqlite', 'postgres', 'github', 'elevenlabs') and connect its tools to the live session.",
      parameters: z.object({
        presetId: z.string().describe("The MCP preset ID (e.g. 'puppeteer', 'poly-pizza', 'sqlite', 'postgres', 'github', 'fetch', 'memory', 'git', 'sketchfab', 'blender', 'elevenlabs', 'brave-search')"),
        serverName: z.string().optional().describe("Optional custom name for this server instance (defaults to preset name)"),
        env: z.record(z.string()).optional().describe("Environment variables or API keys required by this MCP server"),
        args: z.array(z.string()).optional().describe("Custom CLI arguments for this MCP server"),
      }),
      execute: async (_toolCallId, params) => {
        try {
          const preset = getMcpPreset(params.presetId);
          if (!preset) {
            const availableList = MCP_PRESETS.map((p) => `\`${p.id}\``).join(", ");
            return {
              content: [
                {
                  type: "text",
                  text: `Unknown MCP preset "${params.presetId}". Available presets: ${availableList}`,
                },
              ],
            };
          }

          // Check required environment variables
          const finalEnv: Record<string, string> = { ...(preset.env || {}) };
          if (params.env) {
            Object.assign(finalEnv, params.env);
          }

          if (preset.requiresKey && preset.requiredEnvKeys) {
            const missingKeys: string[] = [];
            for (const key of preset.requiredEnvKeys) {
              const val = finalEnv[key] || process.env[key];
              if (!val || val.trim().length === 0) {
                missingKeys.push(key);
              } else if (!finalEnv[key]) {
                finalEnv[key] = val;
              }
            }

            if (missingKeys.length > 0) {
              return {
                content: [
                  {
                    type: "text",
                    text: [
                      `Action Required: The MCP preset "${preset.name}" requires authentication.`,
                      `Missing secret(s): ${missingKeys.join(", ")}.`,
                      preset.keyHint ? `Hint: ${preset.keyHint}.` : "",
                      "Please ask the user for the key, then call marketplace_configure_mcp with the env parameter.",
                    ].filter(Boolean).join("\n"),
                  },
                ],
              };
            }
          }

          const targetServerName = params.serverName?.trim() || preset.defaultName;
          const projectPath = options.getProjectPath();
          const ompDir = path.join(projectPath, ".omp");
          fs.mkdirSync(ompDir, { recursive: true });
          const mcpConfigPath = path.join(ompDir, "mcp.json");

          const mcpServerConfig: MCPServerConfig = {
            command: preset.command,
            args: params.args || preset.args,
            env: Object.keys(finalEnv).length > 0 ? finalEnv : undefined,
            enabled: true,
          };

          await updateMCPServer(mcpConfigPath, targetServerName, mcpServerConfig);

          // Hot reload MCP in active session
          await options.onReloadMcp();

          return {
            content: [
              {
                type: "text",
                text: [
                  `MCP server "${targetServerName}" (${preset.name}) configured and connected successfully.`,
                  "Tools provided by this MCP server are now active in the session.",
                ].join("\n"),
              },
            ],
          };
        } catch (err) {
          return {
            content: [
              {
                type: "text",
                text: `Failed to configure MCP server "${params.presetId}": ${err instanceof Error ? err.message : String(err)}`,
              },
            ],
          };
        }
      },
    });
  };
}
