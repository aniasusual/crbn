import * as os from "node:os";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as yaml from "yaml";
import {
  getBundledModels,
  getBundledProviders,
  isGeneratedProvider,
} from "../../pi-harness/packages/catalog/src/models";
import { providerEntries, providerEntry } from "../../pi-harness/packages/catalog/src/compat/providers";
import { getEnvApiKeyName } from "../../pi-harness/packages/ai/src/env-api-key";
import {
  discoverAuthStorage,
  getAgentDir,
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
  auth_type?: "oauth" | "api_key" | "local" | "custom" | "none";
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
  is_custom?: boolean;
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
  auth_type?: "oauth" | "api_key" | "local" | "custom" | "none";
  has_oauth?: boolean;
  has_api_key?: boolean;
  requires_api_key: boolean;
  env_var: string | null;
  cost_input?: number;
  cost_output?: number;
  tags: string[];
  is_custom?: boolean;
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

export type CustomProviderFormat = "openai" | "anthropic" | "openai-responses";

export type CustomProviderApi =
  | "openai-completions"
  | "openai-responses"
  | "anthropic-messages";

export type CustomDiscoveryType =
  | "openai-models-list"
  | "ollama"
  | "llama.cpp"
  | "lm-studio"
  | "proxy"
  | "litellm"
  | "none";

export interface CustomModelInput {
  id: string;
  name?: string;
  contextWindow?: number;
  maxTokens?: number;
  reasoning?: boolean;
  supportsVision?: boolean;
}

export interface CustomProviderInput {
  provider?: string;
  name?: string;
  baseUrl: string;
  format?: CustomProviderFormat;
  api?: CustomProviderApi;
  auth?: "none" | "apiKey";
  apiKey?: string;
  discoveryType?: CustomDiscoveryType;
  injectV1?: boolean;
  disableStrictTools?: boolean;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  modelId?: string;
  models?: CustomModelInput[];
  allowOverride?: boolean;
  isEdit?: boolean;
}

export interface CustomProviderProbeResult {
  ok: boolean;
  baseUrl: string;
  format?: CustomProviderFormat;
  inferenceTested?: boolean;
  testedModel?: string;
  models: Array<{ id: string; name?: string; contextWindow?: number }>;
  warning?: string;
}

export interface CustomProviderSummary {
  provider: string;
  label: string;
  format: CustomProviderFormat;
  baseUrl?: string;
  api?: string;
  auth: "none" | "apiKey" | "oauth";
  apiKeyPreview?: string;
  discoveryType: CustomDiscoveryType;
  injectV1: boolean;
  disableStrictTools: boolean;
  headers?: Record<string, string>;
  compat?: Record<string, unknown>;
  modelCount: number;
  models: Array<{
    id: string;
    name: string;
    contextWindow?: number;
    maxTokens?: number;
    reasoning?: boolean;
    supportsVision?: boolean;
  }>;
  status: string;
  error?: string;
}

export interface GatewayConfigInput {
  provider?: string;
  baseUrl: string;
  apiKey?: string;
  label?: string;
}

export interface GatewayConfigResult {
  success: boolean;
  provider: string;
  baseUrl: string;
  modelCount: number;
  models: Array<{ id: string; name: string }>;
  message?: string;
}

export function normalizeGatewayBaseUrl(
  rawUrl: string,
  options?: {
    api?: CustomProviderApi;
    discoveryType?: CustomDiscoveryType;
    injectV1?: boolean;
  },
): string {
  let trimmed = rawUrl.trim().replace(/\/+$/, "");
  if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
    trimmed = `http://${trimmed}`;
  }
  const urlObj = new URL(trimmed);
  const shouldAppendV1 =
    (urlObj.pathname === "" || urlObj.pathname === "/") &&
    options?.api !== "anthropic-messages" &&
    options?.discoveryType !== "ollama" &&
    options?.discoveryType !== "llama.cpp" &&
    options?.injectV1 !== false;
  if (shouldAppendV1) {
    trimmed = `${trimmed}/v1`;
  }
  return trimmed;
}

export async function probeGatewayModels(
  baseUrl: string,
  apiKey?: string,
  headersInput?: Record<string, string>,
): Promise<Array<{ id: string; contextWindow?: number }>> {
  const probeUrl = `${baseUrl.replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = {
    Accept: "application/json",
    ...headersInput,
  };
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const res = await fetch(probeUrl, {
    headers,
    signal: AbortSignal.timeout(4000),
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Gateway returned HTTP ${res.status}: ${errorText.slice(0, 150) || res.statusText}`);
  }

  const data = (await res.json()) as
    | { data?: Array<{ id?: string; max_model_len?: number; context_length?: number }>; models?: Array<{ id?: string; max_model_len?: number; context_length?: number }> }
    | Array<{ id?: string; max_model_len?: number; context_length?: number }>;
  const list = Array.isArray(data)
    ? data
    : Array.isArray(data?.data)
    ? data.data
    : Array.isArray(data?.models)
    ? data.models
    : [];

  return list
    .filter((item): item is { id: string; max_model_len?: number; context_length?: number } => typeof item?.id === "string" && Boolean(item.id.trim()))
    .map((item) => ({
      id: item.id.trim(),
      contextWindow:
        typeof item.max_model_len === "number" && item.max_model_len > 0
          ? item.max_model_len
          : typeof item.context_length === "number" && item.context_length > 0
          ? item.context_length
          : undefined,
    }));
}

const IMPLICIT_LOCAL_PROVIDERS: Record<string, true> = {
  ollama: true,
  "llama.cpp": true,
  "lm-studio": true,
  apple: true,
};

const SELF_HOSTED_PROVIDER_ALLOWLIST: Record<string, true> = {
  omniroute: true,
  vllm: true,
  "lm-studio": true,
  "llama.cpp": true,
  ollama: true,
  litellm: true,
};

function resolveCustomApi(format?: CustomProviderFormat, explicitApi?: CustomProviderApi): CustomProviderApi {
  if (format === "anthropic") return "anthropic-messages";
  if (format === "openai-responses") return "openai-responses";
  if (format === "openai") return "openai-completions";
  return explicitApi ?? "openai-completions";
}

function resolveFormatFromApi(api?: string): CustomProviderFormat {
  if (api === "anthropic-messages") return "anthropic";
  if (api === "openai-responses") return "openai-responses";
  return "openai";
}

function isLoopbackOrLanUrl(rawUrl: unknown): boolean {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) return false;
  try {
    const hostname = new URL(rawUrl.trim()).hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
    return (
      hostname === "localhost" ||
      hostname === "0.0.0.0" ||
      hostname === "::1" ||
      hostname.startsWith("127.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("192.168.") ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
      hostname.endsWith(".local")
    );
  } catch {
    return false;
  }
}

function formatCustomProviderLabel(providerId: string): string {
  if (providerId === "omniroute") return "OmniRoute";
  const stripped = providerId.startsWith("custom-") ? providerId.slice("custom-".length) : providerId;
  const words = stripped
    .split(/[-_.]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  const base = words.length > 0 ? words.join(" ") : "Custom";
  return providerId.startsWith("custom-") ? `${base} (Custom)` : base;
}

function slugifyProviderSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 40);
}

function extractHttpErrorDetail(bodyText: string, status: number, fallbackText: string): string {
  try {
    const parsed = JSON.parse(bodyText) as {
      error?: { message?: string } | string;
      message?: string;
      detail?: string;
    };
    if (parsed && typeof parsed === "object") {
      const errMsg =
        typeof parsed.error === "string"
          ? parsed.error
          : parsed.error?.message || parsed.message || parsed.detail;
      if (typeof errMsg === "string" && errMsg.trim()) {
        return errMsg.trim().slice(0, 180);
      }
    }
  } catch {}
  return bodyText.trim().slice(0, 160) || fallbackText || `HTTP ${status}`;
}
const DEAD_ANTIGRAVITY_MODELS: Record<string, true> = {
  "claude-opus-4-5": true,
  "claude-sonnet-4-5": true,
  "gemini-3.1-pro": true,
  "gemini-3.6-flash": true,
  "gemini-3.7-flash": true,
  "gemini-3-flash": true,
};

export class ModelsService {
  private registryPromise: Promise<ModelRegistry> | null = null;
  private authStoragePromise: Promise<AuthStorage> | null = null;
  private lastLocalRefreshAt = 0;
  readonly oauthManager: OAuthManager;

  constructor() {
    this.oauthManager = new OAuthManager(
      () => this.getAuthStorage(),
      () => this.getRegistry(),
    );
  }

  private async readModelsYml(): Promise<{
    doc: { providers?: Record<string, Record<string, unknown>> };
    providers: Record<string, Record<string, unknown>>;
    filePath: string;
  }> {
    const agentDir = getAgentDir();
    const ymlPath = path.join(agentDir, "models.yml");
    const yamlAltPath = path.join(agentDir, "models.yaml");
    for (const candidate of [ymlPath, yamlAltPath]) {
      try {
        const content = await fs.readFile(candidate, "utf-8");
        const parsed = yaml.parse(content);
        if (parsed && typeof parsed === "object") {
          const doc = parsed as { providers?: Record<string, Record<string, unknown>> };
          return { doc, providers: doc.providers ?? {}, filePath: candidate };
        }
      } catch {}
    }
    return { doc: { providers: {} }, providers: {}, filePath: ymlPath };
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

  async refreshLocalEngines(force = false): Promise<void> {
    const registry = await this.getRegistry();
    const now = Date.now();
    if (!force && now - this.lastLocalRefreshAt < 2000) {
      return;
    }
    this.lastLocalRefreshAt = now;

    const discoverable = new Set(registry.getDiscoverableProviders());
    const localTargets = ["ollama", "llama.cpp", "lm-studio", "apple"].filter((id) => discoverable.has(id));
    // Include any custom discoverable providers configured in models.yml
    const { providers: ymlProviders } = await this.readModelsYml();
    for (const pid of Object.keys(ymlProviders)) {
      if (discoverable.has(pid) && !localTargets.includes(pid)) {
        localTargets.push(pid);
      }
    }
    if (localTargets.length > 0) {
      await registry.refreshDiscoverableProviders(localTargets, "online").catch(() => {});
    }
    if (registry.hasConcreteAuth("vllm")) {
      await registry.refreshProvider("vllm", "online").catch(() => {});
    }
  }

  async checkOllamaRunning(): Promise<boolean> {
    const base = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(800) });
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
    if (provider === "meshy") {
      process.env.MESHY_API_KEY = trimmedKey;
    }
    if (provider === "elevenlabs") {
      process.env.ELEVENLABS_API_KEY = trimmedKey;
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
      provider === "meshy" ? "MESHY_API_KEY" : undefined,
      provider === "elevenlabs" ? "ELEVENLABS_API_KEY" : undefined,
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

  async getModelCatalog(hw?: HardwareInfo): Promise<ModelCatalogResponse> {
    await this.refreshLocalEngines(false);
    const registry = await this.getRegistry();
    const entries = providerEntries();
    const providerList: ProviderMetadata[] = [];
    const modelList: ModelCatalogEntry[] = [];
    const { providers: ymlProviders } = await this.readModelsYml();

    const jsonProviders = [...getBundledProviders()];
    const registryModels = registry.getAll();
    const registryProviders = Array.from(new Set(registryModels.map((m) => m.provider)));
    const oauthProviders = this.oauthManager.getOAuthProviders();
    const allProviderIds = Array.from(
      new Set([
        ...jsonProviders,
        ...registryProviders,
        ...oauthProviders.map((p) => p.id),
        ...Object.keys(ymlProviders),
        "meshy",
        "elevenlabs",
      ]),
    ).filter(Boolean);

    const authStorage = await this.getAuthStorage();
    const seenModelCanonicalIds = new Set<string>();
    let ollamaRunning = false;

    for (const pid of allProviderIds) {
      const pEntry = entries[pid] ?? providerEntry(pid);
      const ymlEntry = ymlProviders[pid];
      const isImplicitLocal = IMPLICIT_LOCAL_PROVIDERS[pid] === true;
      const regModelsForP = registryModels.filter((m) => m.provider === pid);
      if (pid === "ollama") {
        const discState = registry.getProviderDiscoveryState("ollama");
        ollamaRunning = regModelsForP.length > 0 || discState?.status === "ok" || (await this.checkOllamaRunning());
      }

      const label =
        pid === "omniroute"
          ? "OmniRoute"
          : pid === "meshy"
          ? "Meshy (3D Mesh AI)"
          : pid === "elevenlabs"
          ? "ElevenLabs (Sound Effects)"
          : pEntry?.discovery?.label || (ymlEntry ? formatCustomProviderLabel(pid) : pid.charAt(0).toUpperCase() + pid.slice(1));

      const envVar =
        pid === "omniroute"
          ? "OMNIROUTE_API_KEY"
          : pid === "meshy"
          ? "MESHY_API_KEY"
          : pid === "elevenlabs"
          ? "ELEVENLABS_API_KEY"
          : pEntry?.envVars?.[0] ||
            getEnvApiKeyName(pid) ||
            (!isImplicitLocal && pid !== "local" && pid !== "web"
              ? `${pid.toUpperCase().replace(/[^A-Z0-9]+/gi, "_")}_API_KEY`
              : null);

      const oauthMatch = oauthProviders.find(
        (p) => p.id === pid || p.storeCredentialsAs === pid,
      );
      const targetId = oauthMatch?.storeCredentialsAs ?? pid;
      const identity =
        authStorage.oauth.identity(targetId) ||
        (targetId !== pid ? authStorage.oauth.identity(pid) : undefined);
      const storedCred =
        authStorage.credentials.get(pid) ||
        (targetId !== pid ? authStorage.credentials.get(targetId) : undefined);
      const oauthCred = storedCred && storedCred.type === "oauth" ? storedCred : undefined;

      const hasOAuth = Boolean(
        authStorage.credentials.hasOAuth(pid) ||
          (targetId !== pid && authStorage.credentials.hasOAuth(targetId)) ||
          identity,
      );

      const isSynthetic = pid === "local" || pid === "web";
      const storedApiKey = storedCred;
      const hasVaultKey = Boolean(
        storedApiKey && storedApiKey.type === "api_key" && storedApiKey.key,
      );
      const keySource = authStorage.keys.source(pid);
      const hasRuntimeKey = Boolean(
        keySource?.concrete && (keySource.kind === "runtime" || keySource.kind === "config"),
      );
      const hasEnvKey = Boolean(
        keySource?.concrete &&
          keySource.kind === "env" &&
          keySource.envVar &&
          Boolean(process.env[keySource.envVar]),
      );
      const isYmlApiKey = Boolean(ymlEntry && typeof ymlEntry.apiKey === "string" && ymlEntry.apiKey.trim());
      const hasApiKey = !isSynthetic && !isImplicitLocal && (hasVaultKey || hasRuntimeKey || hasEnvKey || isYmlApiKey);

      let apiKeyPreview: string | undefined;
      const rawPreviewKey =
        storedApiKey && storedApiKey.type === "api_key" && storedApiKey.key
          ? storedApiKey.key
          : typeof ymlEntry?.apiKey === "string"
          ? ymlEntry.apiKey
          : undefined;
      if (rawPreviewKey) {
        apiKeyPreview =
          rawPreviewKey.length > 8
            ? `${rawPreviewKey.slice(0, 6)}••••${rawPreviewKey.slice(-4)}`
            : "••••••••";
      }

      const isYmlKeyless = Boolean(ymlEntry && ymlEntry.auth === "none");
      const hasKeylessLogin = authStorage.keys.keyless(pid);
      const hasImplicitLocalAuth =
        isImplicitLocal && (regModelsForP.length > 0 || (pid === "ollama" && ollamaRunning) || Boolean(ymlEntry?.baseUrl));
      const isCustomGateway = Boolean(ymlEntry?.baseUrl);
      const isLocalEndpoint =
        isImplicitLocal || hasKeylessLogin || (isCustomGateway && isLoopbackOrLanUrl(ymlEntry?.baseUrl));

      let authType: "oauth" | "api_key" | "local" | "custom" | "none" = "none";
      if (isImplicitLocal && !hasApiKey && !hasOAuth && hasImplicitLocalAuth) {
        authType = "local";
      } else if (hasKeylessLogin) {
        authType = "local";
      } else if (isYmlKeyless) {
        authType = isLocalEndpoint ? "local" : "custom";
      } else if (hasOAuth) {
        authType = "oauth";
      } else if (hasApiKey) {
        authType = "api_key";
      } else if (isCustomGateway && registry.hasConcreteAuth(pid)) {
        authType = isLocalEndpoint ? "local" : "custom";
      }

      const hasAuth =
        !isSynthetic &&
        (hasOAuth ||
          hasApiKey ||
          isYmlKeyless ||
          hasKeylessLogin ||
          hasImplicitLocalAuth ||
          (isCustomGateway && registry.hasConcreteAuth(pid)));
      const bundledModels = isGeneratedProvider(pid) ? getBundledModels(pid) : [];

      let providerModelCount = 0;
      const providerMeta: ProviderMetadata = {
        id: pid,
        label,
        env_var: envVar,
        has_auth: hasAuth,
        auth_type: authType,
        has_oauth: hasOAuth,
        has_api_key: hasApiKey,
        model_count: 0,
        supports_oauth: Boolean(oauthMatch),
        oauth_kind: oauthMatch?.kind,
        login_name: oauthMatch?.name,
        account_email: identity?.email || oauthCred?.email,
        account_id: identity?.accountId || oauthCred?.accountId,
        org_name: identity?.orgName || oauthCred?.orgName,
        api_key_preview: apiKeyPreview,
        is_custom: isCustomGateway,
      };
      providerList.push(providerMeta);

      // A. Static catalog models
      for (const m of bundledModels) {
        if (!m?.id) continue;
        if (m.kind && m.kind !== "chat") continue;
        if (pid === "google-antigravity" && DEAD_ANTIGRAVITY_MODELS[m.id]) continue;
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
          name:
            pid === "google-antigravity" && m.id === "claude-opus-4-6"
              ? "Claude Opus 4.6 (Thinking)"
              : pid === "google-antigravity" && m.id === "claude-sonnet-4-6"
              ? "Claude Sonnet 4.6 (Thinking)"
              : pid === "google-antigravity" && m.id === "gpt-oss-120b"
              ? "GPT-OSS 120B (Medium)"
              : m.name || m.id,
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

      // B. Models in ModelRegistry (covers built-in discovery, local engines, and models.yml custom/discovered models)
      for (const rm of regModelsForP) {
        if (!rm?.id) continue;
        if (pid === "google-antigravity" && DEAD_ANTIGRAVITY_MODELS[rm.id]) continue;
        const canonicalId = `${pid}/${rm.id}`;
        if (seenModelCanonicalIds.has(canonicalId)) continue;
        seenModelCanonicalIds.add(canonicalId);
        providerModelCount++;
        const isVision = Array.isArray(rm.input) && rm.input.includes("image");
        const contextTokens = rm.contextWindow || 128_000;
        const formattedContext = formatContext(rm.contextWindow);
        const extraTags: string[] = [];
        if (isLocalEndpoint || authType === "local") extraTags.push("local");
        if (isCustomGateway) extraTags.push("gateway", "custom");
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
            ...extraTags,
          ],
          is_custom: isCustomGateway,
        });
      }

      // C. Fallback for explicit models.yml entries if not yet materialized in registry
      if (ymlEntry && Array.isArray(ymlEntry.models)) {
        for (const gm of ymlEntry.models as Array<{
          id?: string;
          name?: string;
          contextWindow?: number;
          reasoning?: boolean;
          input?: string[];
        }>) {
          if (!gm?.id) continue;
          const canonicalId = `${pid}/${gm.id}`;
          if (seenModelCanonicalIds.has(canonicalId)) continue;
          seenModelCanonicalIds.add(canonicalId);
          providerModelCount++;
          const isVision = Array.isArray(gm.input) && gm.input.includes("image");
          const contextTokens = gm.contextWindow || 128_000;
          modelList.unshift({
            id: gm.id,
            canonical_id: canonicalId,
            name: gm.name || gm.id,
            provider: pid,
            provider_label: label,
            context_length: formatContext(contextTokens),
            context_tokens: contextTokens,
            supports_thinking: Boolean(gm.reasoning),
            supports_vision: isVision,
            has_auth: hasAuth,
            auth_type: authType,
            has_oauth: false,
            has_api_key: hasApiKey,
            requires_api_key: !hasAuth,
            env_var: envVar,
            tags: [
              pid,
              gm.reasoning ? "reasoning" : "fast",
              isVision ? "vision" : "text",
              ...(isLocalEndpoint || authType === "local" ? ["local"] : []),
              "gateway",
              "custom",
            ],
            is_custom: isCustomGateway,
          });
        }
      }

      providerMeta.model_count = providerModelCount;
    }

    // Sort providers: providers with auth first, then alphabetical
    providerList.sort((a, b) => {
      if (a.has_auth !== b.has_auth) return a.has_auth ? -1 : 1;
      return a.label.localeCompare(b.label);
    });

    let activeModel = "gemini-2.5-flash";
    if (modelList.some((m) => m.id === "gemini-2.5-flash" && m.has_auth)) {
      activeModel = "gemini-2.5-flash";
    } else {
      const readyModel = modelList.find((m) => m.has_auth);
      if (readyModel) activeModel = readyModel.id;
    }

    return {
      hardware: hw ?? detectHardware(),
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
    const rawProviders = [...getBundledProviders()];
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

  async probeCustomProvider(input: {
    baseUrl: string;
    format?: CustomProviderFormat;
    api?: CustomProviderApi;
    apiKey?: string;
    discoveryType?: CustomDiscoveryType;
    injectV1?: boolean;
    headers?: Record<string, string>;
    modelId?: string;
    models?: CustomModelInput[];
    testInference?: boolean;
  }): Promise<CustomProviderProbeResult> {
    const api = resolveCustomApi(input.format, input.api);
    const format = input.format ?? resolveFormatFromApi(api);
    const discoveryType =
      input.discoveryType ?? (api === "anthropic-messages" ? "none" : "openai-models-list");
    const apiKey = input.apiKey?.trim() || undefined;
    const normalizedUrl = normalizeGatewayBaseUrl(input.baseUrl, {
      api,
      discoveryType,
      injectV1: input.injectV1,
    });

    const targetModelId =
      input.modelId?.trim() ||
      input.models?.find((m) => m.id?.trim())?.id.trim();

    if (input.testInference && targetModelId) {
      const cleanRoot = normalizedUrl.replace(/\/+$/, "");
      let endpointUrl: string;
      let requestHeaders: Record<string, string>;
      let payload: Record<string, unknown>;

      if (api === "anthropic-messages") {
        endpointUrl = cleanRoot.endsWith("/v1") ? `${cleanRoot}/messages` : `${cleanRoot}/v1/messages`;
        requestHeaders = {
          "Content-Type": "application/json",
          Accept: "application/json",
          "anthropic-version": "2023-06-01",
          ...input.headers,
        };
        if (apiKey) requestHeaders["x-api-key"] = apiKey;
        payload = {
          model: targetModelId,
          max_tokens: 1,
          messages: [{ role: "user", content: "hi" }],
        };
      } else if (api === "openai-responses") {
        endpointUrl = `${cleanRoot}/responses`;
        requestHeaders = {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...input.headers,
        };
        if (apiKey) requestHeaders.Authorization = `Bearer ${apiKey}`;
        payload = {
          model: targetModelId,
          input: "hi",
          max_output_tokens: 16,
        };
      } else {
        endpointUrl = `${cleanRoot}/chat/completions`;
        requestHeaders = {
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
          ...input.headers,
        };
        if (apiKey) requestHeaders.Authorization = `Bearer ${apiKey}`;
        payload = {
          model: targetModelId,
          max_tokens: 1,
          stream: true,
          messages: [{ role: "user", content: "hi" }],
        };
      }

      const res = await fetch(endpointUrl, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        const bodyText = await res.text().catch(() => "");
        const detail = extractHttpErrorDetail(bodyText, res.status, res.statusText);
        if (res.status === 401 || res.status === 403) {
          throw new Error(`Authentication failed (HTTP ${res.status}): ${detail}. Check your API key.`);
        }
        if (res.status === 404) {
          throw new Error(
            `Endpoint not found (HTTP 404 at ${endpointUrl}): ${detail}. Verify Base URL (/v1 suffix) or switch OpenAI/Anthropic format.`,
          );
        }
        throw new Error(`Model test failed (HTTP ${res.status}): ${detail}`);
      }
      const reader = res.body?.getReader();
      if (reader) {
        await reader.read().catch(() => {});
        await reader.cancel().catch(() => {});
      }
      const listedModels: Array<{ id: string; name?: string; contextWindow?: number }> = (input.models ?? [])
        .filter((m) => m.id?.trim())
        .map((m) => ({
          id: m.id.trim(),
          name: m.name?.trim() || m.id.trim(),
          contextWindow: m.contextWindow,
        }));
      if (!listedModels.some((m) => m.id === targetModelId)) {
        listedModels.unshift({ id: targetModelId, name: targetModelId });
      }
      return {
        ok: true,
        baseUrl: normalizedUrl,
        format,
        inferenceTested: true,
        testedModel: targetModelId,
        models: listedModels,
      };
    }

    if (discoveryType === "none") {
      const manualModels: Array<{ id: string; name?: string; contextWindow?: number }> = (input.models ?? [])
        .filter((m) => m.id?.trim())
        .map((m) => ({
          id: m.id.trim(),
          name: m.name?.trim() || m.id.trim(),
          contextWindow: m.contextWindow,
        }));
      if (targetModelId && !manualModels.some((m) => m.id === targetModelId)) {
        manualModels.unshift({ id: targetModelId, name: targetModelId });
      }
      return {
        ok: true,
        baseUrl: normalizedUrl,
        format,
        models: manualModels,
      };
    }

    if (discoveryType === "ollama") {
      const root = normalizedUrl.replace(/\/v1$/i, "").replace(/\/+$/, "");
      const res = await fetch(`${root}/api/tags`, {
        headers: { Accept: "application/json", ...input.headers },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) {
        throw new Error(`Ollama returned HTTP ${res.status}: ${res.statusText}`);
      }
      const data = (await res.json()) as { models?: Array<{ name?: string }> };
      const models = (data.models ?? [])
        .filter((m): m is { name: string } => typeof m?.name === "string" && Boolean(m.name.trim()))
        .map((m) => ({ id: m.name.trim(), name: m.name.trim() }));
      return { ok: true, baseUrl: root, format, models };
    }

    if (api === "anthropic-messages" && discoveryType !== "proxy") {
      const root = normalizedUrl.replace(/\/+$/, "");
      const modelsUrl = root.endsWith("/v1") ? `${root}/models` : `${root}/v1/models`;
      const headers: Record<string, string> = {
        Accept: "application/json",
        "anthropic-version": "2023-06-01",
        ...input.headers,
      };
      if (apiKey) headers["x-api-key"] = apiKey;
      try {
        const res = await fetch(modelsUrl, { headers, signal: AbortSignal.timeout(4000) });
        if (res.ok) {
          const data = (await res.json()) as { data?: Array<{ id?: string; display_name?: string }> };
          const models = (data.data ?? [])
            .filter((m): m is { id: string; display_name?: string } => typeof m?.id === "string" && Boolean(m.id.trim()))
            .map((m) => ({ id: m.id.trim(), name: m.display_name?.trim() || m.id.trim() }));
          return { ok: true, baseUrl: normalizedUrl, format, models };
        }
        if ((res.status === 404 || res.status === 405) && targetModelId) {
          return {
            ok: true,
            baseUrl: normalizedUrl,
            format,
            models: [{ id: targetModelId, name: targetModelId }],
            warning: "Endpoint does not expose /v1/models; using entered model ID.",
          };
        }
        const text = await res.text().catch(() => "");
        throw new Error(`Anthropic endpoint returned HTTP ${res.status}: ${text.slice(0, 150) || res.statusText}`);
      } catch (err) {
        if (targetModelId) {
          return {
            ok: true,
            baseUrl: normalizedUrl,
            format,
            models: [{ id: targetModelId, name: targetModelId }],
            warning: `Could not probe /v1/models (${err instanceof Error ? err.message : String(err)}); using entered model ID.`,
          };
        }
        throw err;
      }
    }

    // OpenAI-compatible discovery (openai-models-list, lm-studio, llama.cpp, proxy, litellm)
    const probeBase =
      discoveryType === "llama.cpp"
        ? normalizedUrl.replace(/\/v1$/i, "")
        : normalizedUrl;
    let discovered: Array<{ id: string; contextWindow?: number }>;
    try {
      discovered = await probeGatewayModels(probeBase, apiKey, input.headers);
    } catch (err) {
      if (discoveryType === "llama.cpp" && !probeBase.endsWith("/v1")) {
        discovered = await probeGatewayModels(`${probeBase}/v1`, apiKey, input.headers);
      } else {
        throw err;
      }
    }

    return {
      ok: true,
      baseUrl: normalizedUrl,
      format,
      models: discovered.map((m) => ({
        id: m.id,
        name: m.id,
        contextWindow: m.contextWindow,
      })),
    };
  }

  async saveCustomProvider(input: CustomProviderInput): Promise<GatewayConfigResult> {
    const api = resolveCustomApi(input.format, input.api);
    const { doc, filePath } = await this.readModelsYml();
    const existingProviders = doc.providers ?? {};

    // Resolve provider ID safely without clobbering built-in cloud providers
    let providerId: string;
    const rawProvider = input.provider?.trim().toLowerCase();
    if (rawProvider) {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(rawProvider)) {
        throw new Error("Invalid provider ID. Use letters, numbers, '.', '_' or '-'.");
      }
      const isBuiltInCloud =
        Boolean(isGeneratedProvider(rawProvider) || providerEntry(rawProvider)) &&
        !SELF_HOSTED_PROVIDER_ALLOWLIST[rawProvider];
      if (isBuiltInCloud && !input.allowOverride && !input.isEdit) {
        const safeSlug = `custom-${slugifyProviderSegment(rawProvider) || "endpoint"}`;
        let candidate = safeSlug;
        let suffix = 2;
        while (existingProviders[candidate]) {
          candidate = `${safeSlug}-${suffix++}`;
        }
        providerId = candidate;
      } else {
        providerId = rawProvider;
      }
    } else {
      let hostLabel = "";
      try {
        const rawUrl = input.baseUrl.trim();
        hostLabel = new URL(rawUrl.startsWith("http") ? rawUrl : `http://${rawUrl}`).hostname;
      } catch {}
      const slug = slugifyProviderSegment(input.name || hostLabel || "endpoint") || "endpoint";
      const baseSlug = slug.startsWith("custom-") ? slug : `custom-${slug}`;
      let candidate = baseSlug;
      let suffix = 2;
      while (existingProviders[candidate]) {
        candidate = `${baseSlug}-${suffix++}`;
      }
      providerId = candidate;
    }

    // Normalize manual models (accepting single modelId convenience field or models array)
    const combinedModels: CustomModelInput[] = [...(input.models ?? [])];
    if (input.modelId?.trim()) {
      const trimmedId = input.modelId.trim();
      if (!combinedModels.some((m) => m.id?.trim() === trimmedId)) {
        combinedModels.unshift({ id: trimmedId, name: trimmedId });
      }
    }
    const manualModels = combinedModels
      .filter((m) => m.id?.trim())
      .map((m) => ({
        id: m.id.trim(),
        name: m.name?.trim() || m.id.trim(),
        contextWindow: m.contextWindow && m.contextWindow > 0 ? m.contextWindow : undefined,
        maxTokens: m.maxTokens && m.maxTokens > 0 ? m.maxTokens : undefined,
        reasoning: m.reasoning,
        input: m.supportsVision !== undefined ? (m.supportsVision ? (["text", "image"] as const) : (["text"] as const)) : undefined,
      }));

    const requestedDiscoveryType: CustomDiscoveryType =
      input.discoveryType ??
      (manualModels.length > 0 ? "none" : api === "anthropic-messages" ? "none" : "openai-models-list");

    const existingEntry = existingProviders[providerId];
    const existingKey = typeof existingEntry?.apiKey === "string" ? existingEntry.apiKey.trim() : undefined;
    const authMode: "none" | "apiKey" =
      input.auth ?? (input.apiKey?.trim() || (input.isEdit && existingKey) ? "apiKey" : "none");
    const apiKey = input.apiKey?.trim() || (authMode === "apiKey" ? existingKey : undefined);
    if (authMode === "apiKey" && !apiKey) {
      throw new Error("API key is required when auth mode is set to apiKey.");
    }

    const normalizedUrl = normalizeGatewayBaseUrl(input.baseUrl, {
      api,
      discoveryType: requestedDiscoveryType,
      injectV1: input.injectV1,
    });

    if (requestedDiscoveryType === "none" && manualModels.length === 0) {
      throw new Error("Enter a Model ID or enable model discovery.");
    }

    // If discovery is requested:
    // - When NO manual models exist, require discovery probe to succeed.
    // - When manual models DO exist, gracefully fall back to discovery: none if /models returns 404/403/fails.
    let effectiveDiscoveryType: CustomDiscoveryType = requestedDiscoveryType;
    let probedModels: Array<{ id: string; name?: string; contextWindow?: number }> = [];
    if (requestedDiscoveryType !== "none") {
      try {
        const probe = await this.probeCustomProvider({
          baseUrl: normalizedUrl,
          api,
          apiKey,
          discoveryType: requestedDiscoveryType,
          injectV1: input.injectV1,
          headers: input.headers,
          models: manualModels.length > 0 ? manualModels.map((m) => ({ id: m.id, name: m.name, contextWindow: m.contextWindow })) : undefined,
        });
        probedModels = probe.models;
        if (manualModels.length === 0 && probedModels.length === 0) {
          throw new Error("Connected to endpoint, but no models were returned by /models. Enter a Model ID manually.");
        }
      } catch (err) {
        if (manualModels.length > 0) {
          effectiveDiscoveryType = "none";
        } else {
          throw err;
        }
      }
    }

    const agentDir = getAgentDir();
    await fs.mkdir(agentDir, { recursive: true });
    let previousContent: string | null = null;
    try {
      previousContent = await fs.readFile(filePath, "utf-8");
    } catch {}

    doc.providers = doc.providers || {};
    const providerEntryConfig: Record<string, unknown> = {
      baseUrl: normalizedUrl,
    };
    if (effectiveDiscoveryType !== "proxy") {
      providerEntryConfig.api = api;
    }
    if (authMode === "apiKey" && apiKey) {
      providerEntryConfig.apiKey = apiKey;
      // Explicit auth: apiKey prevents pi-harness from applying Claude Code OAuth shaping on custom anthropic-messages endpoints
      providerEntryConfig.auth = "apiKey";
      if (api !== "anthropic-messages") {
        providerEntryConfig.authHeader = true;
      }
    } else {
      providerEntryConfig.auth = "none";
    }

    const disableStrictTools =
      input.disableStrictTools !== undefined
        ? Boolean(input.disableStrictTools)
        : api === "anthropic-messages"
        ? true
        : undefined;
    if (disableStrictTools !== undefined) {
      providerEntryConfig.disableStrictTools = disableStrictTools;
    }
    if (input.headers && Object.keys(input.headers).length > 0) {
      providerEntryConfig.headers = input.headers;
    }
    if (input.compat && Object.keys(input.compat).length > 0) {
      providerEntryConfig.compat = input.compat;
    }
    if (effectiveDiscoveryType !== "none") {
      const discoveryConfig: Record<string, unknown> = { type: effectiveDiscoveryType };
      if (effectiveDiscoveryType === "openai-models-list" && input.injectV1 === false) {
        discoveryConfig.injectV1 = false;
      }
      providerEntryConfig.discovery = discoveryConfig;
    }
    if (manualModels.length > 0) {
      providerEntryConfig.models = manualModels.map((m) => ({
        id: m.id,
        name: m.name,
        ...(m.contextWindow !== undefined ? { contextWindow: m.contextWindow } : {}),
        ...(m.maxTokens !== undefined ? { maxTokens: m.maxTokens } : {}),
        ...(m.reasoning !== undefined ? { reasoning: m.reasoning } : {}),
        ...(m.input !== undefined ? { input: [...m.input] } : {}),
      }));
    }

    doc.providers[providerId] = providerEntryConfig;
    await fs.writeFile(filePath, yaml.stringify(doc), "utf-8");

    const authStorage = await this.getAuthStorage();
    if (apiKey && authMode === "apiKey") {
      authStorage.keys.setRuntime(providerId, apiKey);
      await authStorage.credentials.set(providerId, {
        type: "api_key",
        key: apiKey,
        source: "login" as const,
      });
    } else {
      try {
        authStorage.keys.removeRuntime(providerId);
        await authStorage.credentials.remove(providerId);
      } catch {}
    }

    const registry = await this.getRegistry();
    await registry.refreshProvider(providerId, "online", { refreshCommandCredentials: true });

    const configErr = registry.getError();
    if (configErr) {
      if (previousContent !== null) {
        await fs.writeFile(filePath, previousContent, "utf-8");
      } else {
        await fs.rm(filePath, { force: true });
      }
      await registry.refreshProvider(providerId, "online", { refreshCommandCredentials: true }).catch(() => {});
      throw new Error(`Invalid provider configuration: ${configErr.message}`);
    }

    const activeModels = registry.getProviderModels(providerId);
    const reportedModels =
      activeModels.length > 0
        ? activeModels.map((m) => ({ id: m.id, name: m.name || m.id }))
        : manualModels.length > 0
        ? manualModels.map((m) => ({ id: m.id, name: m.name }))
        : probedModels.map((m) => ({ id: m.id, name: m.name || m.id }));

    return {
      success: true,
      provider: providerId,
      baseUrl: normalizedUrl,
      modelCount: reportedModels.length,
      models: reportedModels,
      message: `Connected ${formatCustomProviderLabel(providerId)}. ${reportedModels.length} ${reportedModels.length === 1 ? "model" : "models"} ready.`,
    };
  }

  async listCustomProviders(): Promise<{ providers: CustomProviderSummary[]; configError?: string }> {
    const registry = await this.getRegistry();
    const { providers: ymlProviders } = await this.readModelsYml();
    const results: CustomProviderSummary[] = [];

    for (const [providerId, entry] of Object.entries(ymlProviders)) {
      const baseUrl = typeof entry.baseUrl === "string" ? entry.baseUrl : undefined;
      const api = typeof entry.api === "string" ? entry.api : undefined;
      const apiKey = typeof entry.apiKey === "string" ? entry.apiKey : undefined;
      const auth: "none" | "apiKey" | "oauth" =
        entry.auth === "none"
          ? "none"
          : entry.auth === "oauth"
          ? "oauth"
          : apiKey
          ? "apiKey"
          : "none";
      const discoveryObj =
        entry.discovery && typeof entry.discovery === "object"
          ? (entry.discovery as { type?: CustomDiscoveryType; injectV1?: boolean })
          : undefined;
      const discoveryType: CustomDiscoveryType = discoveryObj?.type ?? "none";
      const injectV1 = discoveryObj?.injectV1 !== false;

      let apiKeyPreview: string | undefined;
      if (apiKey) {
        apiKeyPreview = apiKey.length > 8 ? `${apiKey.slice(0, 4)}••••${apiKey.slice(-4)}` : "••••••••";
      }

      const registryModels = registry.getProviderModels(providerId);
      const manualModels = Array.isArray(entry.models)
        ? (entry.models as Array<{
            id?: string;
            name?: string;
            contextWindow?: number;
            maxTokens?: number;
            reasoning?: boolean;
            input?: string[];
          }>)
            .filter((m): m is { id: string; name?: string; contextWindow?: number; maxTokens?: number; reasoning?: boolean; input?: string[] } => typeof m?.id === "string")
            .map((m) => ({
              id: m.id,
              name: m.name || m.id,
              contextWindow: m.contextWindow,
              maxTokens: m.maxTokens,
              reasoning: m.reasoning,
              supportsVision: Array.isArray(m.input) && m.input.includes("image"),
            }))
        : [];

      const models =
        registryModels.length > 0
          ? registryModels.map((m) => ({
              id: m.id,
              name: m.name || m.id,
              contextWindow: m.contextWindow ?? undefined,
              maxTokens: m.maxTokens ?? undefined,
              reasoning: m.reasoning,
              supportsVision: Array.isArray(m.input) && m.input.includes("image"),
            }))
          : manualModels;

      const discState = registry.getProviderDiscoveryState(providerId);
      results.push({
        provider: providerId,
        label: formatCustomProviderLabel(providerId),
        format: resolveFormatFromApi(api),
        baseUrl,
        api,
        auth,
        apiKeyPreview,
        discoveryType,
        injectV1,
        disableStrictTools: Boolean(entry.disableStrictTools),
        headers:
          entry.headers && typeof entry.headers === "object"
            ? (entry.headers as Record<string, string>)
            : undefined,
        compat:
          entry.compat && typeof entry.compat === "object"
            ? (entry.compat as Record<string, unknown>)
            : undefined,
        modelCount: models.length,
        models,
        status: discState?.status ?? (models.length > 0 ? "ok" : "idle"),
        error: discState?.error,
      });
    }

    return {
      providers: results,
      configError: registry.getError()?.message,
    };
  }

  async removeCustomProvider(providerId: string): Promise<boolean> {
    const id = providerId.trim().toLowerCase();
    const { doc, filePath } = await this.readModelsYml();
    if (doc.providers && id in doc.providers) {
      delete doc.providers[id];
      await fs.writeFile(filePath, yaml.stringify(doc), "utf-8");
    }

    const authStorage = await this.getAuthStorage();
    try {
      authStorage.keys.removeRuntime(id);
      await authStorage.credentials.remove(id);
    } catch {}

    const envKey = `${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_API_KEY`;
    if (process.env[envKey]) {
      delete process.env[envKey];
    }

    const registry = await this.getRegistry();
    await registry.refreshProvider(id, "online", { refreshCommandCredentials: true });
    return true;
  }

  /**
   * Persist and register a custom OpenAI-compatible gateway provider (e.g. OmniRoute)
   * into models.yml and refresh the dynamic model registry.
   */
  async saveGatewayProvider(input: GatewayConfigInput): Promise<GatewayConfigResult> {
    const apiKey = input.apiKey?.trim() || undefined;
    return this.saveCustomProvider({
      provider: input.provider || "omniroute",
      baseUrl: input.baseUrl,
      api: "openai-completions",
      auth: apiKey ? "apiKey" : "none",
      apiKey,
      discoveryType: "openai-models-list",
    });
  }

  /**
   * Remove a gateway provider from models.yml and reload the registry.
   */
  async removeGatewayProvider(providerId: string): Promise<boolean> {
    return this.removeCustomProvider(providerId);
  }

  /**
   * Read gateway provider configuration from models.yml.
   */
  async getGatewayProvider(providerId: string): Promise<{
    configured: boolean;
    provider: string;
    baseUrl?: string;
    apiKeyPreview?: string;
    modelCount: number;
    models: Array<{ id: string; name: string }>;
  }> {
    const id = providerId.trim().toLowerCase();
    const { providers } = await this.listCustomProviders();
    const match = providers.find((p) => p.provider === id);
    if (!match) {
      return {
        configured: false,
        provider: id,
        modelCount: 0,
        models: [],
      };
    }
    return {
      configured: true,
      provider: match.provider,
      baseUrl: match.baseUrl,
      apiKeyPreview: match.apiKeyPreview,
      modelCount: match.modelCount,
      models: match.models.map((m) => ({ id: m.id, name: m.name })),
    };
  }
}
