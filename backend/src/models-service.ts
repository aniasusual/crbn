import * as os from "node:os";
import MODELS from "../../pi-harness/packages/catalog/src/models.json";
import { providerEntries, providerEntry } from "../../pi-harness/packages/catalog/src/compat/providers";
import { getEnvApiKeyName } from "../../pi-harness/packages/ai/src/stream";
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
  auth_type?: "oauth" | "api_key" | "local" | "none";
  has_oauth: boolean;
  has_api_key: boolean;
  model_count: number;
  supports_oauth: boolean;
  oauth_kind?: "oauth-code" | "device-code" | "custom";
  login_name?: string;
  account_email?: string;
  account_id?: string;
  org_name?: string;
  api_key_preview?: string;
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
  auth_type?: "oauth" | "api_key" | "local" | "none";
  has_oauth?: boolean;
  has_api_key?: boolean;
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

    // 1. Store in OMP's SQLite vault with source "login" so cascade precedence treats it with high priority
    await authStorage.credentials.set(provider, { type: "api_key", key: trimmedKey, source: "login" as const });

    // 2. Set runtime key override on authStorage so active sessions immediately resolve it
    authStorage.keys.setRuntime(provider, trimmedKey);

    // 3. Export environment variable so child processes/subagents/tools inherit it
    const entry = providerEntry(provider);
    const envVar = entry?.envVars?.[0];
    if (envVar) {
      process.env[envVar] = trimmedKey;
    }
    if (provider === "google") {
      process.env.GEMINI_API_KEY = trimmedKey;
      process.env.GOOGLE_API_KEY = trimmedKey;
    }

    // 4. Trigger provider-level online refresh and hydrate in model registry
    try {
      await registry.refreshProvider(provider, "online");
      await registry.refresh();
    } catch (err) {
      console.warn(`[ModelsService] Warning: refreshProvider(${provider}) notice:`, err);
    }
    return true;
  }

  async removeApiKey(provider: string): Promise<boolean> {
    const authStorage = await this.getAuthStorage();
    const registry = await this.getRegistry();

    const oauthMatch = this.oauthManager.getOAuthProviders().find(
      (p) => p.id === provider || p.storeCredentialsAs === provider
    );
    const targetId = oauthMatch?.storeCredentialsAs ?? provider;

    // 1. Remove runtime override completely
    try {
      authStorage.keys.removeRuntime(provider);
      if (targetId !== provider) {
        authStorage.keys.removeRuntime(targetId);
      }
    } catch {}

    // 2. Remove from SQLite vault & reload cache
    await authStorage.credentials.remove(provider);
    if (targetId !== provider) {
      await authStorage.credentials.remove(targetId);
    }
    await authStorage.credentials.reload();

    // 3. Clear all environment variables for this provider
    const entry = providerEntry(provider);
    const envVarsToClean = [
      entry?.envVars?.[0],
      getEnvApiKeyName(provider),
      `${provider.toUpperCase().replace(/-/g, "_")}_API_KEY`,
      provider === "google" ? "GEMINI_API_KEY" : undefined,
      provider === "google" ? "GOOGLE_API_KEY" : undefined,
    ].filter(Boolean) as string[];

    for (const v of envVarsToClean) {
      if (process.env[v]) {
        delete process.env[v];
      }
    }

    // 4. Trigger refresh in registry
    try {
      await registry.refreshProvider(provider, "online");
      if (targetId !== provider) {
        await registry.refreshProvider(targetId, "online");
      }
      await registry.refresh();
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

    // 1. Unify all providers across static catalog, dynamic registry, and OAuth manager
    const jsonProviders = Object.keys(MODELS) as string[];
    const registryModels = registry.getAll();
    const registryProviders = Array.from(new Set(registryModels.map((m) => m.provider)));
    const oauthProviders = this.oauthManager.getOAuthProviders();
    const allProviderIds = Array.from(
      new Set([...jsonProviders, ...registryProviders, ...oauthProviders.map((p) => p.id)])
    ).filter(Boolean);

    const authStorage = await this.getAuthStorage();
    const seenModelCanonicalIds = new Set<string>();

    for (const pid of allProviderIds) {
      const pEntry = entries[pid] ?? providerEntry(pid);
      const label = pEntry?.discovery?.label || pid.charAt(0).toUpperCase() + pid.slice(1);
      const envVar =
        pEntry?.envVars?.[0] ||
        getEnvApiKeyName(pid) ||
        (pid !== "ollama" && pid !== "local" && pid !== "web"
          ? `${pid.toUpperCase().replace(/-/g, "_")}_API_KEY`
          : null);

      const oauthMatch = oauthProviders.find(
        (p) => p.id === pid || p.storeCredentialsAs === pid
      );
      const targetId = oauthMatch?.storeCredentialsAs ?? pid;
      const identity =
        authStorage.oauth.identity(targetId) ||
        (targetId !== pid ? authStorage.oauth.identity(pid) : undefined);

      const hasOAuth = Boolean(
        authStorage.credentials.hasOAuth(pid) ||
          (targetId !== pid && authStorage.credentials.hasOAuth(targetId)) ||
          identity
      );

      const isSynthetic = pid === "local" || pid === "web" || pid === "ollama";
      const storedApiKey =
        authStorage.credentials.get(pid) ||
        (targetId !== pid ? authStorage.credentials.get(targetId) : undefined);
      const hasVaultKey = Boolean(
        storedApiKey && storedApiKey.type === "api_key" && storedApiKey.key
      );
      const keySource = authStorage.keys.source(pid);
      const hasRuntimeKey = Boolean(
        keySource?.concrete && (keySource.kind === "runtime" || keySource.kind === "config")
      );
      const hasEnvKey = Boolean(
        keySource?.concrete &&
          keySource.kind === "env" &&
          keySource.envVar &&
          Boolean(process.env[keySource.envVar])
      );
      const hasApiKey = !isSynthetic && (hasVaultKey || hasRuntimeKey || hasEnvKey);
      let apiKeyPreview: string | undefined;
      if (storedApiKey && storedApiKey.type === "api_key" && storedApiKey.key) {
        const k = storedApiKey.key;
        apiKeyPreview = k.length > 8 ? `${k.slice(0, 6)}••••${k.slice(-4)}` : "••••••••";
      }

      let authType: "oauth" | "api_key" | "local" | "none" = "none";
      if ((pid as string) === "ollama") {
        authType = ollamaRunning ? "local" : "none";
      } else if (keySource?.kind === "runtime" || keySource?.kind === "config") {
        authType = "api_key";
      } else if (hasOAuth) {
        authType = "oauth";
      } else if (hasApiKey) {
        authType = "api_key";
      }

      const hasAuth = hasOAuth || hasApiKey || ((pid as string) === "ollama" && ollamaRunning);
      providerAuthMap.set(pid, hasAuth);

      // Collect models for this provider from both JSON and registry
      const rawJsonModels = ((MODELS as Record<string, unknown>)[pid] as Record<
        string,
        {
          id: string;
          name?: string;
          input?: string[];
          contextWindow?: number;
          reasoning?: boolean;
          cost?: { input?: number; output?: number };
        }
      >) || {};

      let providerModelCount = 0;

      providerList.push({
        id: pid,
        label,
        env_var: envVar,
        has_auth: hasAuth,
        auth_type: authType,
        has_oauth: hasOAuth,
        has_api_key: hasApiKey,
        model_count: Object.keys(rawJsonModels).length,
        supports_oauth: Boolean(oauthMatch),
        oauth_kind: oauthMatch?.kind,
        login_name: oauthMatch?.name,
        account_email: identity?.email,
        account_id: identity?.accountId,
        org_name: identity?.orgName,
        api_key_preview: apiKeyPreview,
      });

      // A. Models declared in static catalog
      for (const mId in rawJsonModels) {
        const m = rawJsonModels[mId];
        const canonicalId = `${pid}/${m.id}`;
        if (seenModelCanonicalIds.has(canonicalId)) continue;
        seenModelCanonicalIds.add(canonicalId);
        providerModelCount++;

        const isVision = Array.isArray(m.input) && m.input.includes("image");
        const contextTokens = m.contextWindow || 128_000;
        const formattedContext = formatContext(m.contextWindow);

        modelList.push({
          id: m.id,
          canonical_id: canonicalId,
          name: m.name || m.id,
          provider: pid,
          provider_label: label,
          context_length: formattedContext,
          context_tokens: contextTokens,
          supports_thinking: Boolean(m.reasoning),
          supports_vision: isVision,
          has_auth: hasAuth,
          auth_type: authType,
          has_oauth: hasOAuth,
          has_api_key: hasApiKey,
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

      // B. Models dynamically registered in ModelRegistry not present in static JSON
      const regModelsForP = registryModels.filter((m) => m.provider === pid);
      for (const rm of regModelsForP) {
        const canonicalId = `${pid}/${rm.id}`;
        if (seenModelCanonicalIds.has(canonicalId)) continue;
        seenModelCanonicalIds.add(canonicalId);
        providerModelCount++;

        const isVision = Array.isArray(rm.input) && rm.input.includes("image");
        const contextTokens = rm.contextWindow || 128_000;
        const formattedContext = formatContext(rm.contextWindow);

        modelList.push({
          id: rm.id,
          canonical_id: canonicalId,
          name: rm.name || rm.id,
          provider: pid,
          provider_label: label,
          context_length: formattedContext,
          context_tokens: contextTokens,
          supports_thinking: Boolean(rm.reasoning),
          supports_vision: isVision,
          has_auth: hasAuth,
          auth_type: authType,
          has_oauth: hasOAuth,
          has_api_key: hasApiKey,
          requires_api_key: !hasAuth,
          env_var: envVar,
          cost_input: rm.cost?.input,
          cost_output: rm.cost?.output,
          tags: [
            pid,
            rm.reasoning ? "reasoning" : "fast",
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
      ollamaProvider.auth_type = "local";
      ollamaProvider.model_count += localModelCount;
    } else {
      providerList.unshift({
        id: "ollama",
        label: "Ollama (Local)",
        env_var: null,
        has_auth: true,
        auth_type: "local",
        has_oauth: false,
        has_api_key: false,
        model_count: localModelCount,
        supports_oauth: false,
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

  async getCredentialsSummary(): Promise<Record<string, {
    has_auth: boolean;
    auth_type: "oauth" | "api_key" | "local" | "none";
    email?: string;
    accountId?: string;
    orgName?: string;
  }>> {
    const authStorage = await this.getAuthStorage();
    const registry = await this.getRegistry();
    const rawProviders = Object.keys(MODELS) as string[];
    const storedProviders = Array.from(new Set(authStorage.credentials.list().map((c) => c.provider)));
    const allProviders = Array.from(new Set([...rawProviders, ...storedProviders]));
    const summary: Record<string, {
      has_auth: boolean;
      auth_type: "oauth" | "api_key" | "local" | "none";
      email?: string;
      accountId?: string;
      orgName?: string;
    }> = {};

    for (const pid of allProviders) {
      const isSynthetic = pid === "local" || pid === "web" || pid === "ollama";
      const identity = authStorage.oauth.identity(pid);
      const isOAuth = authStorage.credentials.hasOAuth(pid) || Boolean(identity);

      const storedCred = authStorage.credentials.get(pid);
      const hasVaultKey = Boolean(storedCred && storedCred.type === "api_key" && storedCred.key);
      const keySource = authStorage.keys.source(pid);
      const hasEnvKey = Boolean(
        keySource?.concrete &&
          keySource.kind === "env" &&
          keySource.envVar &&
          Boolean(process.env[keySource.envVar])
      );
      const hasRuntimeKey = Boolean(
        keySource?.concrete && (keySource.kind === "runtime" || keySource.kind === "config")
      );
      const hasApiKey = !isSynthetic && (hasVaultKey || hasRuntimeKey || hasEnvKey);

      let authType: "oauth" | "api_key" | "local" | "none" = "none";
      if ((pid as string) === "ollama") {
        authType = "local";
      } else if (isOAuth) {
        authType = "oauth";
      } else if (hasApiKey) {
        authType = "api_key";
      }
      if (hasApiKey || isOAuth || (pid === "ollama" && (pid as string) === "ollama")) {
        summary[pid] = {
          has_auth: true,
          auth_type: authType,
          email: identity?.email,
          accountId: identity?.accountId,
          orgName: identity?.orgName,
        };
      }
    }
    return summary;
  }

  /**
   * Switch the active precedence between OAuth and API Key for a provider.
   */
  async setActiveAuthMethod(provider: string, method: "oauth" | "api_key"): Promise<boolean> {
    const authStorage = await this.getAuthStorage();
    const registry = await this.getRegistry();
    const oauthMatch = this.oauthManager.getOAuthProviders().find(
      (p) => p.id === provider || p.storeCredentialsAs === provider
    );
    const targetId = oauthMatch?.storeCredentialsAs ?? provider;

    if (method === "api_key") {
      // Find stored API key in vault and elevate to runtime override
      const cred =
        authStorage.credentials.get(provider) ||
        (targetId !== provider ? authStorage.credentials.get(targetId) : undefined);
      if (cred && cred.type === "api_key" && cred.key) {
        authStorage.keys.setRuntime(provider, cred.key);
        if (targetId !== provider) {
          authStorage.keys.setRuntime(targetId, cred.key);
        }
      }
    } else {
      // Clear runtime override completely so cascade naturally resolves stored OAuth
      try {
        authStorage.keys.removeRuntime(provider);
        if (targetId !== provider) {
          authStorage.keys.removeRuntime(targetId);
        }
      } catch {}
    }

    try {
      await registry.refreshProvider(provider, "online");
      if (targetId !== provider) {
        await registry.refreshProvider(targetId, "online");
      }
      await registry.refresh();
    } catch {}

    return true;
  }
}
