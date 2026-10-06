import * as os from "node:os";
import MODELS from "../../pi-harness/packages/catalog/src/models.json";
import { providerEntries, providerEntry } from "../../pi-harness/packages/catalog/src/compat/providers";
import {
  discoverAuthStorage,
  ModelRegistry,
  type AuthStorage,
} from "../../pi-harness/packages/coding-agent/src/index";
import { OAuthManager, type OAuthProviderMetadata, type PendingOAuthSession } from "./oauth-manager";

export interface HardwareInfo {
  os: string;
  arch: string;
  ram_gb: number;
  gpu_brand: string;
  vram_gb: number;
}

export interface ProviderMetadata {
  id: string;
  label: string;
  env_var: string | null;
  has_auth: boolean;
  model_count: number;
  supports_oauth: boolean;
  oauth_kind?: "oauth-code" | "device-code" | "custom" | "api-key";
  login_name?: string;
  account_email?: string;
  account_id?: string;
  org_name?: string;
}

export interface ModelCatalogEntry {
  id: string;
  canonical_id: string;
  name: string;
  provider: string;
  provider_label: string;
  context_length: string;
  context_tokens: number;
  supports_thinking: boolean;
  supports_vision: boolean;
  has_auth: boolean;
  requires_api_key: boolean;
  env_var: string | null;
  cost_input?: number;
  cost_output?: number;
  tags: string[];
}

export interface ModelCatalogResponse {
  hardware: HardwareInfo;
  providers: ProviderMetadata[];
  models: ModelCatalogEntry[];
  active_model: string;
  total_models: number;
  ollama_running: boolean;
}

export function detectHardware(): HardwareInfo {
  const totalRamGb = Math.round(os.totalmem() / (1024 * 1024 * 1024));
  const isAppleSilicon = process.platform === "darwin" && process.arch === "arm64";

  return {
    os: process.platform === "darwin" ? "macOS" : process.platform,
    arch: process.arch,
    ram_gb: totalRamGb,
    gpu_brand: isAppleSilicon ? "Apple Silicon (Unified Memory)" : "Standard GPU",
    vram_gb: isAppleSilicon ? totalRamGb : 0,
  };
}

function formatContext(tokens: number | null | undefined): string {
  if (!tokens || tokens <= 0) return "128k";
  if (tokens >= 1_000_000) {
    const m = (tokens / 1_000_000).toFixed(1).replace(/\.0$/, "");
    return `${m}M`;
  }
  const k = Math.round(tokens / 1000);
  return `${k}k`;
}

export class ModelsService {
  private registryPromise: Promise<ModelRegistry> | null = null;
  private authStoragePromise: Promise<AuthStorage> | null = null;
  readonly oauthManager: OAuthManager;

  constructor() {
    this.oauthManager = new OAuthManager(
      () => this.getAuthStorage(),
      () => this.getRegistry(),
    );
  }

  async getAuthStorage(): Promise<AuthStorage> {
    if (!this.authStoragePromise) {
      this.authStoragePromise = discoverAuthStorage();
    }
    return this.authStoragePromise;
  }

  async getRegistry(): Promise<ModelRegistry> {
    if (!this.registryPromise) {
      this.registryPromise = (async () => {
        const authStorage = await this.getAuthStorage();
        const registry = new ModelRegistry(authStorage);
        await registry.refresh();
        return registry;
      })();
    }
    return this.registryPromise;
  }

  async checkOllamaRunning(): Promise<boolean> {
    try {
      const res = await fetch("http://127.0.0.1:11434/api/tags", { signal: AbortSignal.timeout(800) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async saveApiKey(provider: string, apiKey: string): Promise<boolean> {
    const trimmedKey = apiKey.trim();
    if (!trimmedKey) throw new Error("API key cannot be empty");

    const authStorage = await this.getAuthStorage();
    const registry = await this.getRegistry();

    // 1. Store in OMP's SQLite vault
    await authStorage.credentials.set(provider, { type: "api_key", key: trimmedKey });

    // 2. Export environment variable so child processes/subagents inherit it
    const entry = providerEntry(provider);
    const envVar = entry?.envVars?.[0];
    if (envVar) {
      process.env[envVar] = trimmedKey;
    }

    // 3. Trigger provider-level online refresh in model registry
    try {
      await registry.refreshProvider(provider, "online");
    } catch (err) {
      console.warn(`[ModelsService] Warning: refreshProvider(${provider}) notice:`, err);
    }

    return true;
  }

  async removeApiKey(provider: string): Promise<boolean> {
    const authStorage = await this.getAuthStorage();
    const registry = await this.getRegistry();

    // 1. Remove from SQLite vault
    await authStorage.credentials.remove(provider);

    // 2. Clear environment variable
    const entry = providerEntry(provider);
    const envVar = entry?.envVars?.[0];
    if (envVar && process.env[envVar]) {
      delete process.env[envVar];
    }

    // 3. Trigger refresh
    try {
      await registry.refreshProvider(provider, "online");
    } catch {
      // Ignore cleanup refresh notice
    }

    return true;
  }

  async getModelCatalog(hw: HardwareInfo): Promise<ModelCatalogResponse> {
    const registry = await this.getRegistry();
    const entries = providerEntries();
    const ollamaRunning = await this.checkOllamaRunning();

    const providerList: ProviderMetadata[] = [];
    const modelList: ModelCatalogEntry[] = [];
    const providerAuthMap = new Map<string, boolean>();

    // 1. Determine auth status and build provider list
    const rawProviders = Object.keys(MODELS) as Array<keyof typeof MODELS>;
    const oauthProviders = this.oauthManager.getOAuthProviders();
    const authStorage = await this.getAuthStorage();

    for (const pid of rawProviders) {
      const pEntry = entries[pid] ?? providerEntry(pid);
      const label = pEntry?.discovery?.label || pid.charAt(0).toUpperCase() + pid.slice(1);
      const envVar = pEntry?.envVars?.[0] ?? null;
      const hasAuth = registry.hasConcreteAuth(pid);
      const modelsForP = Object.keys(MODELS[pid] || {});

      const oauthMatch = oauthProviders.find(
        (p) =>
          (p.id === pid || p.storeCredentialsAs === pid) &&
          (p.kind === "oauth-code" || p.kind === "device-code" || p.kind === "custom")
      );
      const identity = authStorage.oauth.identity(pid);

      providerAuthMap.set(pid, hasAuth);

      providerList.push({
        id: pid,
        label,
        env_var: envVar,
        has_auth: hasAuth,
        model_count: modelsForP.length,
        supports_oauth: Boolean(oauthMatch),
        oauth_kind: oauthMatch?.kind,
        login_name: oauthMatch?.name,
        account_email: identity?.email,
        account_id: identity?.accountId,
        org_name: identity?.orgName,
      });
      // 2. Add all bundled models for this provider
      const providerModelsMap = MODELS[pid] as Record<string, any>;
      for (const mId in providerModelsMap) {
        const m = providerModelsMap[mId];
        const isVision = Array.isArray(m.input) && m.input.includes("image");
        const contextTokens = m.contextWindow || 128_000;
        const formattedContext = formatContext(m.contextWindow);

        modelList.push({
          id: m.id,
          canonical_id: `${pid}/${m.id}`,
          name: m.name || m.id,
          provider: pid,
          provider_label: label,
          context_length: formattedContext,
          context_tokens: contextTokens,
          supports_thinking: Boolean(m.reasoning),
          supports_vision: isVision,
          has_auth: hasAuth,
          requires_api_key: !hasAuth,
          env_var: envVar,
          cost_input: m.cost?.input,
          cost_output: m.cost?.output,
          tags: [
            pid,
            m.reasoning ? "reasoning" : "fast",
            isVision ? "vision" : "text",
            hasAuth ? "ready" : "needs-key",
          ],
        });
      }
    }

    // 3. Add local Ollama models if running
    let localModelCount = 0;
    if (ollamaRunning) {
      try {
        const res = await fetch("http://127.0.0.1:11434/api/tags");
        if (res.ok) {
          const data = (await res.json()) as {
            models?: Array<{ name: string; size?: number; details?: { parameter_size?: string } }>;
          };
          for (const om of data.models ?? []) {
            localModelCount++;
            modelList.unshift({
              id: om.name,
              canonical_id: `ollama/${om.name}`,
              name: `Ollama: ${om.name}`,
              provider: "ollama",
              provider_label: "Ollama (Local)",
              context_length: "32k",
              context_tokens: 32_000,
              supports_thinking: om.name.includes("r1") || om.name.includes("reason"),
              supports_vision: om.name.includes("vision") || om.name.includes("llava"),
              has_auth: true,
              requires_api_key: false,
              env_var: null,
              tags: ["ollama", "local", "ready"],
            });
          }
        }
      } catch {
        // Ignore fetch errors
      }
    }

    // Add or update Ollama in provider list
    const ollamaProvider = providerList.find(p => p.id === "ollama");
    if (ollamaProvider) {
      ollamaProvider.has_auth = true;
      ollamaProvider.model_count += localModelCount;
    } else {
      providerList.unshift({
        id: "ollama",
        label: "Ollama (Local)",
        env_var: null,
        has_auth: true,
        model_count: localModelCount,
      });
    }

    // Sort providers: providers with auth first, then alphabetical
    providerList.sort((a, b) => {
      if (a.has_auth !== b.has_auth) return a.has_auth ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

    // Determine sensible default active model
    let activeModel = "gemini-2.5-flash";
    if (modelList.some(m => m.id === "gemini-2.5-flash" && m.has_auth)) {
      activeModel = "gemini-2.5-flash";
    } else {
      const readyModel = modelList.find(m => m.has_auth);
      if (readyModel) activeModel = readyModel.id;
    }

    return {
      hardware: hw,
      providers: providerList,
      models: modelList,
      active_model: activeModel,
      total_models: modelList.length,
      ollama_running: ollamaRunning,
    };
  }
}
