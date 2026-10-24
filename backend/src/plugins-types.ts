export type PluginScope = "user" | "project";
export type PluginSourceType = "marketplace" | "npm" | "git" | "link";

export interface PluginCapabilities {
  hasTools: boolean;
  hasSkills: boolean;
  hasHooks: boolean;
  hasCommands: boolean;
  hasAgents: boolean;
  hasMcp: boolean;
  hasExtensions: boolean;
}

export interface UnifiedPlugin {
  id: string; // e.g. "code-review@claude-plugins-official" or "@scope/pkg"
  name: string;
  version: string;
  description?: string;
  author?: { name: string; email?: string } | string;
  homepage?: string;
  sourceType: PluginSourceType;
  scope: PluginScope;
  enabled: boolean;
  shadowed?: boolean;
  category?: string;
  tags?: string[];
  marketplace?: string;
  features: {
    available: string[];
    enabled: string[] | null;
  };
  capabilities: PluginCapabilities;
  hasUpdate?: boolean;
  updateVersion?: string;
  settings?: Record<string, unknown>;
  installPath?: string;
}

export interface MarketplaceCatalogSummary {
  name: string;
  sourceUri: string;
  description?: string;
  pluginCount: number;
  lastUpdated?: string;
}

export interface MarketplacePluginListing {
  name: string;
  id: string; // name@marketplace
  marketplace: string;
  description?: string;
  version?: string;
  category?: string;
  tags?: string[];
  homepage?: string;
  installed: boolean;
  installedScope?: PluginScope;
}
