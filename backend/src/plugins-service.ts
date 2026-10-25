import * as path from "node:path";
import * as fs from "node:fs";
import { PluginManager } from "../../pi-harness/packages/coding-agent/src/extensibility/plugins/manager";
import {
  MarketplaceManager,
  getInstalledPluginsRegistryPath,
  getMarketplacesCacheDir,
  getMarketplacesRegistryPath,
  getPluginsCacheDir,
} from "../../pi-harness/packages/coding-agent/src/extensibility/plugins/marketplace";
import {
  parsePluginId,
  type MarketplacePluginEntry,
  type MarketplaceRegistryEntry,
  type MarketplacesRegistry,
} from "../../pi-harness/packages/coding-agent/src/extensibility/plugins/marketplace/types";
import defaultMarketplaceCatalog from "./default-marketplace.json" with { type: "json" };
import {
  clearPluginRootsAndCaches,
  resolveOrDefaultProjectRegistryPath,
} from "../../pi-harness/packages/coding-agent/src/discovery/helpers";
import { setInstalledPluginEnabled } from "../../pi-harness/packages/coding-agent/src/extensibility/plugins/toggle";
import type {
  UnifiedPlugin,
  PluginCapabilities,
  PluginScope,
  PluginSourceType,
  MarketplaceCatalogSummary,
  MarketplacePluginListing,
} from "./plugins-types";

function inspectPluginCapabilities(installPath: string, manifest?: Record<string, unknown>): PluginCapabilities {
  const exists = (sub: string) => {
    try {
      return fs.existsSync(path.join(installPath, sub));
    } catch {
      return false;
    }
  };

  const hasTools = exists("tools") || Boolean(manifest?.tools);
  const hasSkills = exists("skills");
  const hasHooks = exists("hooks");
  const hasCommands = exists("commands") || (Array.isArray(manifest?.commands) && manifest.commands.length > 0);
  const hasAgents = exists("agents");
  const hasMcp =
    exists("mcp.json") ||
    exists(".mcp.json") ||
    Boolean(manifest?.mcpServers && Object.keys(manifest.mcpServers as object).length > 0);
  const hasExtensions =
    Boolean(manifest?.extensions && Array.isArray(manifest.extensions) && manifest.extensions.length > 0) ||
    Boolean((manifest?.omp as Record<string, unknown> | undefined)?.extensions);

  return {
    hasTools,
    hasSkills,
    hasHooks,
    hasCommands,
    hasAgents,
    hasMcp,
    hasExtensions,
  };
}

function readJsonFile<T = Record<string, unknown>>(filePath: string): T | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(content) as T;
  } catch {
    return null;
  }
}

export class PluginsService {
  private async getMarketplaceManager(projectPath?: string): Promise<MarketplaceManager> {
    const cwd = projectPath || process.cwd();
    return new MarketplaceManager({
      marketplacesRegistryPath: getMarketplacesRegistryPath(),
      installedRegistryPath: getInstalledPluginsRegistryPath(),
      projectInstalledRegistryPath: await resolveOrDefaultProjectRegistryPath(cwd),
      marketplacesCacheDir: getMarketplacesCacheDir(),
      pluginsCacheDir: getPluginsCacheDir(),
      clearPluginRootsCache: clearPluginRootsAndCaches,
    });
  }
  private defaultMarketplaceSeeded = false;

  /**
   * Ensure default marketplace (claude-plugins-official) is seeded on disk and in registry.
   * Self-heals if the user runs on a clean machine or has broken/migrated catalog paths.
   */
  async ensureDefaultMarketplace(): Promise<void> {
    if (this.defaultMarketplaceSeeded) return;
    try {
      const regPath = getMarketplacesRegistryPath();
      const cacheDir = getMarketplacesCacheDir();
      const defaultMarketplaceDir = path.join(cacheDir, "claude-plugins-official");
      const defaultCatalogPath = path.join(defaultMarketplaceDir, "marketplace.json");

      // 1. Ensure the default catalog file exists in user's cache dir
      if (!fs.existsSync(defaultCatalogPath)) {
        fs.mkdirSync(defaultMarketplaceDir, { recursive: true });
        fs.writeFileSync(defaultCatalogPath, JSON.stringify(defaultMarketplaceCatalog, null, 2) + "\n", "utf-8");
      }

      // 2. Read marketplaces registry
      let registry: MarketplacesRegistry = { version: 1, marketplaces: [] };
      if (fs.existsSync(regPath)) {
        try {
          const content = fs.readFileSync(regPath, "utf-8");
          const parsed = JSON.parse(content) as MarketplacesRegistry;
          if (parsed && parsed.version === 1 && Array.isArray(parsed.marketplaces)) {
            registry = parsed;
          }
        } catch {}
      }

      // 3. Check if claude-plugins-official or any marketplace exists
      const existingIdx = registry.marketplaces.findIndex(
        (m) => m.name.toLowerCase() === "claude-plugins-official"
      );

      const now = new Date().toISOString();
      const defaultEntry: MarketplaceRegistryEntry = {
        name: "claude-plugins-official",
        sourceType: "github",
        sourceUri: "anthropics/claude-plugins-official",
        catalogPath: defaultCatalogPath,
        addedAt: now,
        updatedAt: now,
      };

      let needsWrite = false;
      if (existingIdx >= 0) {
        // If it exists but catalogPath points to non-existent file or someone else's machine, fix it
        if (!fs.existsSync(registry.marketplaces[existingIdx].catalogPath)) {
          registry.marketplaces[existingIdx].catalogPath = defaultCatalogPath;
          needsWrite = true;
        }
      } else {
        registry.marketplaces.push(defaultEntry);
        needsWrite = true;
      }

      if (needsWrite || !fs.existsSync(regPath)) {
        fs.mkdirSync(path.dirname(regPath), { recursive: true });
        const tmpPath = `${regPath}.tmp.${Date.now()}`;
        fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2) + "\n", "utf-8");
        try {
          fs.renameSync(tmpPath, regPath);
        } catch {
          fs.copyFileSync(tmpPath, regPath);
          try { fs.unlinkSync(tmpPath); } catch {}
        }
      }

      this.defaultMarketplaceSeeded = true;
    } catch (err) {
      console.warn("[PluginsService] Failed to seed default marketplace:", err);
    }
  }

  private async refreshCatalogOverHttp(name: string, sourceUri: string): Promise<boolean> {
    try {
      const cacheDir = getMarketplacesCacheDir();
      const catalogPath = path.join(cacheDir, name, "marketplace.json");
      const rawUrls = [
        `https://raw.githubusercontent.com/${sourceUri}/main/.omp-plugin/marketplace.json`,
        `https://raw.githubusercontent.com/${sourceUri}/main/.claude-plugin/marketplace.json`,
        `https://raw.githubusercontent.com/${sourceUri}/main/marketplace.json`,
      ];
      for (const url of rawUrls) {
        try {
          const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
          if (res.ok) {
            const text = await res.text();
            fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
            fs.writeFileSync(catalogPath, text, "utf-8");
            return true;
          }
        } catch {}
      }
    } catch {}
    return false;
  }

  private getNpmPluginManager(projectPath?: string): PluginManager {
    return new PluginManager(projectPath || process.cwd());
  }

  /**
   * List all installed plugins (both marketplace and npm/git/link).
   */
  async listInstalledPlugins(projectPath?: string): Promise<UnifiedPlugin[]> {
    const result: UnifiedPlugin[] = [];
    const cwd = projectPath || process.cwd();

    const marketplaceManager = await this.getMarketplaceManager(cwd);
    const npmManager = this.getNpmPluginManager(cwd);

    // 1. Fetch marketplace plugins
    let marketplaceUpdates: Array<{ pluginId: string; scope: "user" | "project"; from: string; to: string }> = [];
    try {
      marketplaceUpdates = await marketplaceManager.checkForUpdates();
    } catch {
      // Offline or network error: continue without update badges
    }
    const updateMap = new Map(marketplaceUpdates.map((u) => [`${u.pluginId}:${u.scope}`, u.to]));

    const marketplacePlugins = await marketplaceManager.listInstalledPlugins();
    for (const plugin of marketplacePlugins) {
      const entry = plugin.entries[0];
      if (!entry) continue;

      let pkgJson: Record<string, unknown> | null = null;
      let manifest: Record<string, unknown> | null = null;
      if (entry.installPath) {
        pkgJson = readJsonFile(path.join(entry.installPath, "package.json"));
        const pluginJson = readJsonFile(path.join(entry.installPath, "plugin.json")) ||
                           readJsonFile(path.join(entry.installPath, ".claude-plugin", "plugin.json")) ||
                           readJsonFile(path.join(entry.installPath, ".omp-plugin", "plugin.json"));
        manifest = (pkgJson?.omp as Record<string, unknown>) ||
                   (pkgJson?.pi as Record<string, unknown>) ||
                   pluginJson ||
                   pkgJson;
      }

      const updateKey = `${plugin.id}:${plugin.scope}`;
      const hasUpdate = updateMap.has(updateKey);
      const updateVersion = updateMap.get(updateKey);

      const parsed = parsePluginId(plugin.id);
      const displayName = parsed ? parsed.name : plugin.id;

      result.push({
        id: plugin.id,
        name: displayName,
        version: entry.version || (pkgJson?.version as string) || "0.0.0",
        description: (manifest?.description as string) || (pkgJson?.description as string) || undefined,
        author: (pkgJson?.author as string) || undefined,
        homepage: (pkgJson?.homepage as string) || undefined,
        sourceType: "marketplace",
        scope: plugin.scope,
        enabled: entry.enabled !== false,
        shadowed: plugin.shadowedBy === "project",
        category: (manifest?.category as string) || undefined,
        tags: Array.isArray(manifest?.tags) ? (manifest.tags as string[]) : (Array.isArray(manifest?.keywords) ? (manifest.keywords as string[]) : undefined),
        marketplace: parsed?.marketplace,
        features: {
          available: [],
          enabled: null,
        },
        capabilities: inspectPluginCapabilities(entry.installPath, manifest || pkgJson || undefined),
        hasUpdate,
        updateVersion,
        installPath: entry.installPath,
      });
    }

    // 2. Fetch npm/git/link plugins
    try {
      const npmPlugins = await npmManager.list();
      for (const npmPlugin of npmPlugins) {
        // Skip if already in list under marketplace
        if (result.some((p) => p.id === npmPlugin.name)) continue;

        const pkgJson = readJsonFile(path.join(npmPlugin.path, "package.json"));
        const availableFeatures = Object.keys(npmPlugin.manifest?.features || {});

        result.push({
          id: npmPlugin.name,
          name: npmPlugin.name,
          version: npmPlugin.version || "0.0.0",
          description: npmPlugin.manifest?.description || (pkgJson?.description as string) || undefined,
          author: (pkgJson?.author as string) || undefined,
          homepage: (pkgJson?.homepage as string) || undefined,
          sourceType: "npm",
          scope: "user",
          enabled: npmPlugin.enabled !== false,
          features: {
            available: availableFeatures,
            enabled: npmPlugin.enabledFeatures,
          },
          category: (npmPlugin.manifest as unknown as Record<string, unknown>)?.category as string || (pkgJson?.category as string) || undefined,
          tags: Array.isArray(pkgJson?.keywords) ? (pkgJson.keywords as string[]) : undefined,
          capabilities: inspectPluginCapabilities(
            npmPlugin.path,
            (npmPlugin.manifest as unknown as Record<string, unknown>) || pkgJson || undefined
          ),
          installPath: npmPlugin.path,
        });
      }
    } catch (err) {
      console.warn("[PluginsService] Failed to read npm plugins:", err);
    }

    return result;
  }

  /**
   * Install a plugin from a marketplace catalog, npm package, git URL, or local link.
   */
  async installPlugin(options: {
    spec: string;
    type?: PluginSourceType;
    scope?: PluginScope;
    projectPath?: string;
  }): Promise<{ success: boolean; id: string }> {
    const cwd = options.projectPath || process.cwd();
    const scope = options.scope || "project";
    const type = options.type || (options.spec.includes("@") && !options.spec.startsWith("@") ? "marketplace" : "npm");

    if (type === "marketplace") {
      const parsed = parsePluginId(options.spec);
      if (!parsed) {
        throw new Error(`Invalid marketplace plugin format: "${options.spec}". Expected "name@marketplace".`);
      }
      const marketplaceManager = await this.getMarketplaceManager(cwd);
      await marketplaceManager.installPlugin(parsed.name, parsed.marketplace, {
        scope,
        force: true,
      });
      return { success: true, id: options.spec };
    }

    const npmManager = this.getNpmPluginManager(cwd);
    if (type === "link") {
      const installed = await npmManager.link(options.spec);
      return { success: true, id: installed.name };
    }

    // Default: npm or git
    const installed = await npmManager.install(options.spec);
    return { success: true, id: installed.name };
  }

  /**
   * Uninstall a plugin by ID and scope.
   */
  async uninstallPlugin(options: {
    id: string;
    scope?: PluginScope;
    projectPath?: string;
  }): Promise<{ success: boolean; removed: string }> {
    const cwd = options.projectPath || process.cwd();
    const marketplaceManager = await this.getMarketplaceManager(cwd);
    const marketplacePlugins = await marketplaceManager.listInstalledPlugins();
    const isMarketplace = marketplacePlugins.some((p) => p.id === options.id);

    if (isMarketplace) {
      await marketplaceManager.uninstallPlugin(options.id, options.scope);
      return { success: true, removed: options.id };
    }

    const npmManager = this.getNpmPluginManager(cwd);
    await npmManager.uninstall(options.id);
    return { success: true, removed: options.id };
  }

  /**
   * Toggle a plugin enabled or disabled.
   */
  async togglePlugin(options: {
    id: string;
    enabled: boolean;
    scope?: PluginScope;
    projectPath?: string;
  }): Promise<{ success: boolean; id: string; enabled: boolean }> {
    const cwd = options.projectPath || process.cwd();
    const marketplace = await this.getMarketplaceManager(cwd);
    const npm = this.getNpmPluginManager(cwd);

    const marketplaceIds = new Set((await marketplace.listInstalledPlugins()).map((p) => p.id));
    await setInstalledPluginEnabled(options.id, {
      enabled: options.enabled,
      scope: options.scope,
      marketplaceIds,
      marketplace,
      npm,
    });

    return { success: true, id: options.id, enabled: options.enabled };
  }

  /**
   * Upgrade a plugin to its latest catalog or npm/git version.
   */
  async upgradePlugin(options: {
    id: string;
    scope?: PluginScope;
    projectPath?: string;
  }): Promise<{ success: boolean; id: string }> {
    const cwd = options.projectPath || process.cwd();
    const marketplaceManager = await this.getMarketplaceManager(cwd);
    const marketplacePlugins = await marketplaceManager.listInstalledPlugins();
    const isMarketplace = marketplacePlugins.some((p) => p.id === options.id);

    if (isMarketplace) {
      await marketplaceManager.upgradePlugin(options.id, options.scope);
      return { success: true, id: options.id };
    }

    const npmManager = this.getNpmPluginManager(cwd);
    await npmManager.upgrade(options.id);
    return { success: true, id: options.id };
  }

  /**
   * List configured marketplaces.
   */
  async listMarketplaces(projectPath?: string): Promise<MarketplaceCatalogSummary[]> {
    await this.ensureDefaultMarketplace();
    const cwd = projectPath || process.cwd();
    const marketplaceManager = await this.getMarketplaceManager(cwd);
    const registries = await marketplaceManager.listMarketplaces();

    const summaries: MarketplaceCatalogSummary[] = [];
    for (const reg of registries) {
      let pluginCount = 0;
      try {
        const available = await marketplaceManager.listAvailablePlugins(reg.name);
        pluginCount = available.length;
      } catch {
        if (reg.name === "claude-plugins-official" && Array.isArray((defaultMarketplaceCatalog as any)?.plugins)) {
          pluginCount = (defaultMarketplaceCatalog as any).plugins.length;
        }
      }

      summaries.push({
        name: reg.name,
        sourceUri: reg.sourceUri,
        lastUpdated: reg.updatedAt,
        pluginCount,
      });
    }

    if (summaries.length === 0 && Array.isArray((defaultMarketplaceCatalog as any)?.plugins)) {
      summaries.push({
        name: "claude-plugins-official",
        sourceUri: "anthropics/claude-plugins-official",
        lastUpdated: new Date().toISOString(),
        pluginCount: (defaultMarketplaceCatalog as any).plugins.length,
      });
    }

    return summaries;
  }

  /**
   * Add a new marketplace catalog source (git URL, owner/repo, or direct catalog JSON).
   */
  async addMarketplace(source: string, projectPath?: string): Promise<{ success: boolean; name: string }> {
    await this.ensureDefaultMarketplace();
    const cwd = projectPath || process.cwd();
    const marketplaceManager = await this.getMarketplaceManager(cwd);
    const entry = await marketplaceManager.addMarketplace(source);
    return { success: true, name: entry.name };
  }

  /**
   * Remove a configured marketplace.
   */
  async removeMarketplace(name: string, projectPath?: string): Promise<{ success: boolean; removed: string }> {
    const cwd = projectPath || process.cwd();
    const marketplaceManager = await this.getMarketplaceManager(cwd);
    await marketplaceManager.removeMarketplace(name);
    return { success: true, removed: name };
  }

  /**
   * Update one or all marketplace catalogs.
   */
  async updateMarketplaces(name?: string, projectPath?: string): Promise<{ success: boolean }> {
    await this.ensureDefaultMarketplace();
    const cwd = projectPath || process.cwd();
    const marketplaceManager = await this.getMarketplaceManager(cwd);
    try {
      if (name) {
        await marketplaceManager.updateMarketplace(name);
      } else {
        await marketplaceManager.updateAllMarketplaces();
      }
    } catch (err) {
      console.warn("[PluginsService] Failed to update via MarketplaceManager, attempting HTTP fallback:", err);
      if (!name || name === "claude-plugins-official") {
        await this.refreshCatalogOverHttp("claude-plugins-official", "anthropics/claude-plugins-official");
      }
    }
    return { success: true };
  }

  /**
   * Discover available plugins in configured marketplaces, optionally filtered by marketplace or search query.
   */
  async discoverMarketplacePlugins(options?: {
    marketplace?: string;
    query?: string;
    projectPath?: string;
  }): Promise<MarketplacePluginListing[]> {
    await this.ensureDefaultMarketplace();
    const cwd = options?.projectPath || process.cwd();
    const marketplaceManager = await this.getMarketplaceManager(cwd);

    const regList = await marketplaceManager.listMarketplaces();
    const targets = options?.marketplace
      ? regList.filter((m) => m.name === options.marketplace)
      : regList;

    const availableWithMarketplace: Array<{ plugin: MarketplacePluginEntry; marketplace: string }> = [];
    for (const m of targets) {
      try {
        const plugins = await marketplaceManager.listAvailablePlugins(m.name);
        for (const p of plugins) {
          availableWithMarketplace.push({ plugin: p, marketplace: m.name });
        }
      } catch {
        // Catalog cache might be missing or corrupt
      }
    }

    // Fallback to in-memory bundled catalog if zero plugins loaded
    if (
      availableWithMarketplace.length === 0 &&
      (!options?.marketplace || options.marketplace === "claude-plugins-official") &&
      Array.isArray((defaultMarketplaceCatalog as any)?.plugins)
    ) {
      for (const p of (defaultMarketplaceCatalog as any).plugins as MarketplacePluginEntry[]) {
        availableWithMarketplace.push({ plugin: p, marketplace: "claude-plugins-official" });
      }
    }

    let filtered = availableWithMarketplace;
    if (options?.query) {
      const q = options.query.toLowerCase();
      filtered = filtered.filter(
        ({ plugin: p }) =>
          p.name.toLowerCase().includes(q) ||
          (p.description && p.description.toLowerCase().includes(q)) ||
          (p.category && p.category.toLowerCase().includes(q)) ||
          (Array.isArray(p.tags) && p.tags.some((t) => t.toLowerCase().includes(q)))
      );
    }

    const installed = await marketplaceManager.listInstalledPlugins();
    const installedMap = new Map(installed.map((p) => [p.id, p.scope]));

    return filtered.map(({ plugin: p, marketplace }) => {
      const id = `${p.name}@${marketplace}`;
      const isInstalled = installedMap.has(id);
      return {
        name: p.name,
        id,
        marketplace,
        description: p.description,
        version: p.version,
        category: p.category,
        tags: p.tags,
        homepage: p.homepage,
        installed: isInstalled,
        installedScope: installedMap.get(id),
      };
    });
  }
}
