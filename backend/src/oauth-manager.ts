import type { AuthStorage, ModelRegistry } from "../../pi-harness/packages/coding-agent/src/index";
import { getOAuthProviders } from "../../pi-harness/packages/ai/src/registry/oauth/index";
import { authPolicyFor } from "../../pi-harness/packages/catalog/src/compat/auth";
import { PASTE_CODE_LOGIN_PROVIDERS } from "../../pi-harness/packages/ai/src/registry/derived";
import type {
  OAuthAuthInfo,
  OAuthPrompt,
  OAuthProviderId,
  OAuthProviderInfo,
} from "../../pi-harness/packages/ai/src/registry/oauth/types";
export type OAuthLoginStatus =
  | "awaiting_user"
  | "exchanging"
  | "completed"
  | "failed"
  | "cancelled";

export type OAuthProviderCategory = "popular" | "coding-plan" | "cloud-enterprise";

export interface PendingOAuthSession {
  sessionId: string;
  provider: string;
  status: OAuthLoginStatus;
  authUrl?: string;
  launchUrl?: string;
  instructions?: string;
  deviceCode?: string;
  promptMessage?: string;
  promptPlaceholder?: string;
  promptAllowEmpty?: boolean;
  awaitingPrompt?: boolean;
  error?: string;
  account?: {
    type?: string;
    email?: string;
    accountId?: string;
    orgId?: string;
    orgName?: string;
  };
  startedAt: string;
  updatedAt: string;
}

export interface OAuthProviderMetadata {
  id: string;
  name: string;
  plan: string;
  modelsText: string;
  available: boolean;
  kind: "oauth-code" | "device-code" | "custom";
  category: OAuthProviderCategory;
  pasteCodeFlow: boolean;
  callbackPort?: number;
  scopes?: string[];
  storeCredentialsAs?: string;
  connected?: boolean;
  account?: {
    email?: string;
    accountId?: string;
    orgName?: string;
  };
}

export interface ProviderCatalogProfile {
  name: string;
  plan: string;
  modelsText: string;
  category: OAuthProviderCategory;
}

/**
 * Authoritative profiles for all 23 OAuth / subscription providers supported by OMP.
 */
export const OAUTH_PROVIDER_PROFILES: Record<string, ProviderCatalogProfile> = {
  // Popular Subscriptions
  anthropic: {
    name: "Anthropic (Claude)",
    plan: "Claude Pro / Max",
    modelsText: "Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3.5 Haiku",
    category: "popular",
  },
  "openai-codex": {
    name: "ChatGPT Plus/Pro (Codex)",
    plan: "ChatGPT Plus / Pro / Team",
    modelsText: "GPT-4o, o1, o3-mini, Codex",
    category: "popular",
  },
  "openai-codex-device": {
    name: "ChatGPT Plus/Pro (Device Sign-In)",
    plan: "Headless / Device Code",
    modelsText: "GPT-4o, o1, o3-mini via Device Auth",
    category: "popular",
  },
  "github-copilot": {
    name: "GitHub Copilot",
    plan: "Copilot Individual / Business / Enterprise",
    modelsText: "Claude 3.7 Sonnet, GPT-4o, o3-mini via Copilot",
    category: "popular",
  },
  "google-gemini-cli": {
    name: "Google Cloud Code Assist",
    plan: "Google Cloud / Gemini CLI",
    modelsText: "Gemini 2.5 Pro, Gemini 2.5 Flash",
    category: "popular",
  },
  cursor: {
    name: "Cursor",
    plan: "Cursor Pro / Business",
    modelsText: "Multi-model inference routing allowance",
    category: "popular",
  },
  "xai-oauth": {
    name: "xAI Grok",
    plan: "SuperGrok / X Premium+",
    modelsText: "Grok 2, Grok 3, Grok Vision",
    category: "popular",
  },
  openrouter: {
    name: "OpenRouter (PKCE)",
    plan: "OpenRouter Account",
    modelsText: "Direct PKCE sign-in to 300+ models",
    category: "popular",
  },

  // Coding Plans & Specialized Developer Plans
  "zai-coding-plan": {
    name: "Z.AI (GLM Coding Plan)",
    plan: "Z.AI Subscription",
    modelsText: "GLM-4, GLM-4-Plus coding models",
    category: "coding-plan",
  },
  "alibaba-coding-plan": {
    name: "Alibaba Coding Plan",
    plan: "ModelStudio / DashScope",
    modelsText: "Qwen 2.5 Coder, Qwen Max",
    category: "coding-plan",
  },
  "alibaba-token-plan": {
    name: "QwenCloud Token Plan",
    plan: "Token Plan Individual / Pro",
    modelsText: "Qwen 2.5 Coder, Qwen Turbo, Qwen Plus",
    category: "coding-plan",
  },
  "kimi-code": {
    name: "Moonshot Kimi Code",
    plan: "Moonshot Kimi Plan",
    modelsText: "Kimi k1.5, Moonshot Chat",
    category: "coding-plan",
  },
  "gitlab-duo": {
    name: "GitLab Duo",
    plan: "GitLab Duo Pro / Enterprise",
    modelsText: "GitLab Duo code suggestions and chat",
    category: "coding-plan",
  },
  "gitlab-duo-agent": {
    name: "GitLab Duo Agent",
    plan: "GitLab Duo Workflow Agent",
    modelsText: "Agentic multi-step coding workflow",
    category: "coding-plan",
  },
  devin: {
    name: "Devin",
    plan: "Cognition Devin Plan",
    modelsText: "Devin agent pipeline",
    category: "coding-plan",
  },
  "factory-droid": {
    name: "Factory Droid",
    plan: "Factory Code Companion",
    modelsText: "Factory reasoning & droid coding models",
    category: "coding-plan",
  },
  "muse-code": {
    name: "Muse Code",
    plan: "Meta Muse Code Subscription",
    modelsText: "Muse coding and refactoring models",
    category: "coding-plan",
  },
  stencil: {
    name: "Stencil",
    plan: "Stencil Invite / Subscription",
    modelsText: "Stencil collaborative coding models",
    category: "coding-plan",
  },

  // Cloud & Enterprise Gateways
  "google-antigravity": {
    name: "Google Antigravity",
    plan: "Antigravity Internal / Enterprise",
    modelsText: "Antigravity coding & inference agents",
    category: "cloud-enterprise",
  },
  perplexity: {
    name: "Perplexity AI",
    plan: "Perplexity Pro / Max",
    modelsText: "Sonar, Sonar Deep Research",
    category: "cloud-enterprise",
  },
  "cloudflare-ai-gateway": {
    name: "Cloudflare AI Gateway",
    plan: "Cloudflare Workers AI",
    modelsText: "Unified Cloudflare gateway routing",
    category: "cloud-enterprise",
  },
  kilo: {
    name: "Kilo Gateway",
    plan: "Kilo Account",
    modelsText: "Kilo model routing & inference",
    category: "cloud-enterprise",
  },
  xiaomi: {
    name: "Xiaomi MiMo",
    plan: "Xiaomi MiMo Platform",
    modelsText: "MiMo v2.5 models",
    category: "cloud-enterprise",
  },
};

export function getProviderCategory(id: string): OAuthProviderCategory {
  return OAUTH_PROVIDER_PROFILES[id]?.category ?? "cloud-enterprise";
}

function extractDeviceCode(text?: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/\b([A-Z0-9]{4,8}-[A-Z0-9]{4,8})\b/i);
  return match ? match[1] : undefined;
}

export type OAuthSessionListener = (session: PendingOAuthSession) => void;

export class OAuthManager {
  private activeSessions = new Map<
    string,
    {
      session: PendingOAuthSession;
      abortController: AbortController;
      promise: Promise<void>;
      promptResolver?: {
        resolve: (val: string) => void;
        reject: (err: unknown) => void;
        allowEmpty?: boolean;
      };
    }
  >();

  private listeners = new Set<OAuthSessionListener>();

  constructor(
    private readonly getAuthStorage: () => Promise<AuthStorage>,
    private readonly getRegistry: () => Promise<ModelRegistry>,
  ) {}

  onSessionUpdate(listener: OAuthSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(session: PendingOAuthSession): void {
    session.updatedAt = new Date().toISOString();
    for (const listener of this.listeners) {
      try {
        listener(session);
      } catch (err) {
        console.error("[OAuthManager] Error in session listener:", err);
      }
    }
  }

  /**
   * Enumerate all 23 OAuth / subscription login providers supported by OMP.
   * Filters out plain API-key prompt providers.
   */
  getOAuthProviders(): OAuthProviderMetadata[] {
    const list: OAuthProviderInfo[] = getOAuthProviders();
    return list
      .filter((p) => {
        const policy = authPolicyFor(p.id);
        const kind = policy?.login?.kind;
        return kind === "oauth-code" || kind === "device-code" || kind === "custom";
      })
      .map((p) => {
        const policy = authPolicyFor(p.id);
        const profile = OAUTH_PROVIDER_PROFILES[p.id];
        const kind = (policy?.login?.kind ?? "custom") as "oauth-code" | "device-code" | "custom";
        const category = profile?.category ?? getProviderCategory(p.id);
        const scopes = policy?.login && "scopes" in policy.login ? policy.login.scopes : undefined;
        const targetId = policy?.storeAs ?? p.storeCredentialsAs;

        return {
          id: p.id,
          name: profile?.name ?? p.name,
          plan: profile?.plan ?? (kind === "device-code" ? "Device Sign-In" : "Direct Subscription"),
          modelsText: profile?.modelsText ?? `${p.name} inference and coding models`,
          available: p.available ?? true,
          kind,
          category,
          pasteCodeFlow: PASTE_CODE_LOGIN_PROVIDERS.has(p.id),
          callbackPort: policy?.callbackPort,
          scopes,
          storeCredentialsAs: targetId,
        };
      });
  }

  /**
   * Enumerate all supported OAuth providers with live connection and account status.
   */
  async getOAuthProvidersDetailed(): Promise<OAuthProviderMetadata[]> {
    const baseProviders = this.getOAuthProviders();
    let authStorage: AuthStorage | null = null;
    try {
      authStorage = await this.getAuthStorage();
    } catch {}

    return baseProviders.map((p) => {
      const targetId = p.storeCredentialsAs ?? p.id;
      const hasOAuth = Boolean(
        authStorage?.credentials.hasOAuth(targetId) ||
          (targetId !== p.id && authStorage?.credentials.hasOAuth(p.id))
      );
      const hasKey = Boolean(
        authStorage?.credentials.has(targetId) ||
          (targetId !== p.id && authStorage?.credentials.has(p.id))
      );
      const identity =
        authStorage?.oauth?.identity(targetId) ||
        (targetId !== p.id ? authStorage?.oauth?.identity(p.id) : undefined);

      const connected = hasOAuth || hasKey || Boolean(identity);

      return {
        ...p,
        connected,
        account: identity
          ? {
              email: identity.email,
              accountId: identity.accountId,
              orgName: identity.orgName,
            }
          : undefined,
      };
    });
  }

  /**
   * Check if a specific provider supports OAuth / subscription sign-in.
   */
  supportsOAuth(provider: string): boolean {
    const providers = this.getOAuthProviders();
    return providers.some(
      (p) => p.id === provider || p.storeCredentialsAs === provider
    );
  }

  /**
   * Retrieve active pending login session for a provider.
   */
  getSession(provider: string): PendingOAuthSession | null {
    return this.activeSessions.get(provider)?.session ?? null;
  }

  /**
   * Cleanly handle an interactive prompt request with cancellation and empty support.
   */
  private handlePromptRequest(
    provider: string,
    prompt: { message: string; placeholder?: string; allowEmpty?: boolean },
    session: PendingOAuthSession,
    signal?: AbortSignal,
    emitUpdate?: () => void,
  ): Promise<string> {
    if (signal?.aborted) {
      throw new Error("Login cancelled");
    }

    session.instructions = prompt.message;
    session.promptMessage = prompt.message;
    session.promptPlaceholder = prompt.placeholder;
    session.promptAllowEmpty = Boolean(prompt.allowEmpty);
    session.awaitingPrompt = true;
    emitUpdate?.();

    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const activeEntry = this.activeSessions.get(provider);
    if (activeEntry) {
      activeEntry.promptResolver = {
        resolve,
        reject,
        allowEmpty: Boolean(prompt.allowEmpty),
      };
    }

    const abortHandler = () => {
      reject(new Error("Login cancelled"));
    };
    signal?.addEventListener("abort", abortHandler, { once: true });

    return promise.finally(() => {
      signal?.removeEventListener("abort", abortHandler);
      session.awaitingPrompt = false;
      const current = this.activeSessions.get(provider);
      if (current) {
        delete current.promptResolver;
      }
      emitUpdate?.();
    });
  }

  /**
   * Initiate an interactive OAuth sign-in flow.
   */
  async startLogin(
    provider: string,
    onProgressUpdate?: (session: PendingOAuthSession) => void,
    options?: { projectId?: string },
  ): Promise<PendingOAuthSession> {
    // Inject Google Cloud Project ID into environment if provided
    if (options?.projectId) {
      const cleaned = options.projectId.trim();
      if (cleaned) {
        process.env.GOOGLE_CLOUD_PROJECT = cleaned;
        process.env.GOOGLE_CLOUD_PROJECT_ID = cleaned;
      }
    }

    // Cancel any existing session for this provider
    this.cancelSession(provider);
    const abortController = new AbortController();
    const now = new Date().toISOString();
    const sessionId = `oauth_${provider}_${Date.now()}`;

    const session: PendingOAuthSession = {
      sessionId,
      provider,
      status: "awaiting_user",
      startedAt: now,
      updatedAt: now,
    };

    const emitUpdate = () => {
      this.notify(session);
      onProgressUpdate?.(session);
    };

    const authStorage = await this.getAuthStorage();
    const registry = await this.getRegistry();

    const promise = (async () => {
      try {
        const result = await authStorage.oauth.login(provider as OAuthProviderId, {
          signal: abortController.signal,
          onAuth: (info: OAuthAuthInfo) => {
            session.authUrl = info.url;
            session.launchUrl = info.launchUrl;
            session.instructions = info.instructions;
            session.status = "awaiting_user";
            const code = extractDeviceCode(info.instructions);
            if (code) {
              session.deviceCode = code;
            }
            emitUpdate();
          },
          onProgress: (message: string) => {
            session.instructions = message;
            const code = extractDeviceCode(message);
            if (code) {
              session.deviceCode = code;
            }
            emitUpdate();
          },
          onPrompt: (prompt: OAuthPrompt) => {
            return this.handlePromptRequest(
              provider,
              prompt,
              session,
              abortController.signal,
              emitUpdate,
            );
          },
          onManualCodeInput: (signal?: AbortSignal) => {
            return this.handlePromptRequest(
              provider,
              {
                message: "Paste authorization code or full redirect URL:",
                placeholder: "Paste code or callback URL here...",
                allowEmpty: false,
              },
              session,
              signal ?? abortController.signal,
              emitUpdate,
            );
          },
        });

        // Target provider key for storage could be aliased
        const targetProvider = authPolicyFor(provider)?.storeAs ?? provider;
        try {
          await registry.refreshProvider(targetProvider, "online");
          await registry.refresh();
        } catch (refreshErr) {
          console.warn(`[OAuthManager] Warning during registry refresh for ${targetProvider}:`, refreshErr);
        }

        session.status = "completed";
        session.account = result
          ? {
              type: result.type,
              email: result.email,
              accountId: result.accountId,
              orgId: result.orgId,
              orgName: result.orgName,
            }
          : undefined;
        emitUpdate();
      } catch (err: unknown) {
        if (abortController.signal.aborted) {
          session.status = "cancelled";
        } else {
          session.status = "failed";
          session.error = err instanceof Error ? err.message : String(err);
        }
        emitUpdate();
      } finally {
        setTimeout(() => {
          const current = this.activeSessions.get(provider);
          if (current?.session.sessionId === sessionId) {
            this.activeSessions.delete(provider);
          }
        }, 10_000);
      }
    })();

    this.activeSessions.set(provider, { session, abortController, promise });
    emitUpdate();

    // Wait briefly up to 400ms for onAuth to populate authUrl for instant client redirect
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (session.authUrl || session.instructions || session.status !== "awaiting_user") {
          clearInterval(check);
          resolve();
        }
      }, 20);
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 400);
    });

    return session;
  }

  /**
   * Cancel in-flight OAuth login session.
   */
  cancelSession(provider: string): boolean {
    const entry = this.activeSessions.get(provider);
    if (!entry) return false;

    entry.abortController.abort();
    entry.session.status = "cancelled";
    this.notify(entry.session);
    this.activeSessions.delete(provider);
    return true;
  }

  /**
   * Disconnect / log out of an OAuth or credentialed provider.
   */
  async logout(provider: string): Promise<boolean> {
    this.cancelSession(provider);

    const authStorage = await this.getAuthStorage();
    const registry = await this.getRegistry();

    // 1. Remove credential from SQLite store
    await authStorage.credentials.remove(provider);

    // If provider has an alias target, clean that too
    const alias = authPolicyFor(provider)?.storeAs;
    if (alias && alias !== provider) {
      await authStorage.credentials.remove(alias);
    }
    await authStorage.credentials.reload();
    // 2. Clear runtime key overrides
    try {
      authStorage.keys.removeRuntime(provider);
      if (alias && alias !== provider) {
        authStorage.keys.removeRuntime(alias);
      }
    } catch {}

    // 3. Trigger online refresh in registry
    try {
      await registry.refreshProvider(provider, "online");
      if (alias && alias !== provider) {
        await registry.refreshProvider(alias, "online");
      }
      await registry.refresh();
    } catch {
      // Ignore cleanup refresh warning
    }

    return true;
  }

  /**
   * Query the stored account identity (email, org, accountId) for a provider if logged in.
   */
  async getAccountIdentity(provider: string): Promise<{
    email?: string;
    accountId?: string;
    orgId?: string;
    orgName?: string;
  } | null> {
    try {
      const authStorage = await this.getAuthStorage();
      const targetId = authPolicyFor(provider)?.storeAs ?? provider;
      const identity =
        authStorage.oauth.identity(targetId) ||
        (targetId !== provider ? authStorage.oauth.identity(provider) : undefined);

      if (!identity) return null;
      return {
        email: identity.email,
        accountId: identity.accountId,
        orgId: identity.orgId,
        orgName: identity.orgName,
      };
    } catch {
      return null;
    }
  }

  /**
   * Submit an answer/code response to an active interactive OAuth prompt (e.g. paste-code flow).
   */
  submitPromptResponse(provider: string, response: string): boolean {
    const entry = this.activeSessions.get(provider);
    if (!entry || !entry.promptResolver) {
      return false;
    }
    const allowEmpty = entry.promptResolver.allowEmpty;
    const trimmed = response.trim();
    if (!trimmed && allowEmpty) {
      entry.promptResolver.resolve("");
    } else {
      entry.promptResolver.resolve(trimmed);
    }
    return true;
  }
}
