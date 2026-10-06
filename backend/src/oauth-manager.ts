import type { AuthStorage, ModelRegistry } from "../../pi-harness/packages/coding-agent/src/index";
import { getOAuthProviders } from "../../pi-harness/packages/ai/src/registry/oauth/index";
import { authPolicyFor } from "../../pi-harness/packages/catalog/src/compat/auth";
import type {
  OAuthAuthInfo,
  OAuthPrompt,
  OAuthProviderInfo,
} from "../../pi-harness/packages/ai/src/registry/oauth/types";

export type OAuthLoginStatus =
  | "awaiting_user"
  | "exchanging"
  | "completed"
  | "failed"
  | "cancelled";

export interface PendingOAuthSession {
  sessionId: string;
  provider: string;
  status: OAuthLoginStatus;
  authUrl?: string;
  launchUrl?: string;
  instructions?: string;
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
  available: boolean;
  kind: "oauth-code" | "device-code" | "custom" | "api-key";
  scopes?: string[];
  storeCredentialsAs?: string;
}

export type OAuthSessionListener = (session: PendingOAuthSession) => void;

export class OAuthManager {
  private activeSessions = new Map<
    string,
    {
      session: PendingOAuthSession;
      abortController: AbortController;
      promise: Promise<void>;
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
   * Enumerate all supported OAuth/subscription login providers.
   */
  getOAuthProviders(): OAuthProviderMetadata[] {
    const list: OAuthProviderInfo[] = getOAuthProviders();
    return list.map((p) => {
      const policy = authPolicyFor(p.id);
      return {
        id: p.id,
        name: p.name,
        available: p.available ?? true,
        kind: policy?.login?.kind ?? "custom",
        scopes: policy?.login?.scopes,
        storeCredentialsAs: p.storeCredentialsAs,
      };
    });
  }

  /**
   * Check if a specific provider supports OAuth / subscription sign-in.
   */
  supportsOAuth(provider: string): boolean {
    const providers = this.getOAuthProviders();
    return providers.some(
      (p) =>
        (p.id === provider || p.storeCredentialsAs === provider) &&
        (p.kind === "oauth-code" || p.kind === "device-code" || p.kind === "custom")
    );
  }

  /**
   * Retrieve active pending login session for a provider.
   */
  getSession(provider: string): PendingOAuthSession | null {
    return this.activeSessions.get(provider)?.session ?? null;
  }

  /**
   * Initiate an interactive OAuth sign-in flow.
   */
  async startLogin(
    provider: string,
    onProgressUpdate?: (session: PendingOAuthSession) => void,
    options?: { projectId?: string },
  ): Promise<PendingOAuthSession> {
    // Inject Google Cloud Project ID into environment if provided by user
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
        const result = await authStorage.oauth.login(provider as any, {
          signal: abortController.signal,
          onAuth: (info: OAuthAuthInfo) => {
            session.authUrl = info.url;
            session.launchUrl = info.launchUrl;
            session.instructions = info.instructions;
            session.status = "awaiting_user";
            emitUpdate();
          },
          onProgress: (message: string) => {
            session.instructions = message;
            emitUpdate();
          },
          onPrompt: async (prompt: OAuthPrompt) => {
            session.instructions = prompt.message;
            emitUpdate();
            if (abortController.signal.aborted) {
              throw new Error("Login cancelled");
            }
            const { promise, reject } = Promise.withResolvers<string>();
            abortController.signal.addEventListener(
              "abort",
              () => reject(new Error("Login cancelled")),
              { once: true },
            );
            return promise;
          },
        });

        // Target provider key for storage could be aliased
        const targetProvider = authPolicyFor(provider)?.storeCredentialsAs ?? provider;
        try {
          await registry.refreshProvider(targetProvider, "online");
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
        // Auto-cleanup finished session after 10 seconds
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
    const alias = authPolicyFor(provider)?.storeCredentialsAs;
    if (alias && alias !== provider) {
      await authStorage.credentials.remove(alias);
    }

    // 2. Trigger online refresh in registry
    try {
      await registry.refreshProvider(provider, "online");
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
      const identity = authStorage.oauth.identity(provider);
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
}
