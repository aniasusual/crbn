import * as crypto from "node:crypto";
import {
  buildLiveAgentLookupMap,
  deriveAgentInitials,
  deriveCustomAgentColor,
  deriveCustomAgentRoleKey,
  isValidUuid,
  LOCAL_ENGINEERING_UUID,
  matchBaselineAgentTemplate,
  resolveAgentMetadata,
  type AgentTemplatePackage,
  type ResolvedAgentMeta,
} from "./templates";
import { logCompany } from "./logger";
import { getCoreDb, getTokensDb, isPostgresConfigured } from "./db";

import { discoverAuthStorage, ModelRegistry } from "../../../pi-harness/packages/coding-agent/src/index";
import {
  buildBlackboardCliScript,
  mergeCompanyContextIntoAgentsMd,
  type ProjectContextBundle,
  type SyncableMountFile,
} from "./project-context";
const DEFAULT_AGENTA_API_URL = process.env.AGENTA_API_URL || "http://localhost/api";
const DEFAULT_AGENTA_WEB_URL = process.env.AGENTA_WEB_URL || "http://localhost";
const DEFAULT_AGENTA_AUTH_KEY =
  process.env.AGENTA_AUTH_KEY ||
  "6755f8222e0a982a6a1d1d129529abcdab5ac5c45c1dc11fe32e6be52c71fb33";
const DEFAULT_POSTGRES_CORE =
  process.env.POSTGRES_URI_CORE ||
  "postgresql://username:password@127.0.0.1:5432/agenta_oss_core";
const DEFAULT_POSTGRES_TOKENS =
  process.env.POSTGRES_URI_SUPERTOKENS ||
  "postgresql://username:password@127.0.0.1:5432/agenta_oss_supertokens";

export interface AgentaSessionHint {
  authState?: "authenticated" | "logged-out";
  uid?: string;
  sessionHandle?: string;
  accessToken?: string;
  userId?: string;
  orgId?: string;
  projectId?: string;
  apiKey?: string;
}

export interface AgentaProjectListing {
  organization_id?: string;
  organization_name?: string;
  workspace_id?: string;
  project_id?: string;
  project_name?: string;
  is_default_project?: boolean;
}

export interface AgentaProvisionResult {
  success: boolean;
  needsAuth?: boolean;
  agentaProjectId?: string;
  agentaWorkspaceId?: string;
  agentaUserId?: string;
  agentaApiKey?: string;
  agentaUrl: string;
  agents?: ResolvedAgentMeta[];
  seeded?: boolean;
  error?: string;
}

export interface AgentTurnDispatchResult {
  dispatched: boolean;
  queued?: boolean;
  agentId?: string;
  agentName?: string;
  agentInitials?: string;
  workflowId?: string;
  revisionId?: string;
  sessionId?: string;
  turnId?: string;
  error?: string;
}

export interface ResolvedProjectLlmConfig {
  slug?: string;
  provider: string;
  model: string;
  isCustomProvider?: boolean;
}

const DEFAULT_MODELS_BY_PROVIDER: Record<string, string> = {
  gemini: "gemini/gemini-2.5-flash",
  openai: "openai/gpt-4o",
  anthropic: "anthropic/claude-sonnet-4-20250514",
  openrouter: "openrouter/anthropic/claude-sonnet-4",
  groq: "groq/llama-3.3-70b-versatile",
  xai: "xai/grok-3-mini",
  mistral: "mistral/mistral-large-latest",
  mistralai: "mistral/mistral-large-latest",
  deepinfra: "deepinfra/meta-llama/Llama-3.3-70B-Instruct",
};

export function inferProviderFromSlugOrName(slug?: string | null, name?: string | null): string {
  const haystack = `${slug || ""} ${name || ""}`.toLowerCase();
  if (haystack.includes("openai") || haystack.includes("gpt")) return "openai";
  if (haystack.includes("anthropic") || haystack.includes("claude")) return "anthropic";
  if (haystack.includes("openrouter")) return "openrouter";
  if (haystack.includes("groq")) return "groq";
  if (haystack.includes("xai") || haystack.includes("grok")) return "xai";
  if (haystack.includes("mistral")) return "mistral";
  if (haystack.includes("deepinfra")) return "deepinfra";
  return "gemini";
}

export function resolveModelForProvider(
  providerKind?: string | null,
  preferredModel?: string | null
): { provider: string; model: string } {
  const raw = (providerKind || "gemini").toLowerCase().trim();
  const provider = raw === "google" ? "gemini" : raw || "gemini";
  const fallbackModel = DEFAULT_MODELS_BY_PROVIDER[provider] || `${provider}/default`;
  if (preferredModel && preferredModel.toLowerCase().startsWith(`${provider}/`)) {
    return { provider, model: preferredModel };
  }
  return { provider, model: fallbackModel };
}

interface WorkflowCreateResponse {
  workflow?: { id?: string };
}

interface VariantCreateResponse {
  workflow_variant?: { id?: string };
}

interface ExistingWorkflowArtifactRow {
  id: string;
  name: string | null;
  slug: string | null;
  description?: string | null;
  flags?: {
    is_application?: boolean;
    is_evaluator?: boolean;
    is_snippet?: boolean;
    is_agent?: boolean;
  } | null;
  meta: {
    _ag?: {
      template_origin?: {
        key?: string;
      };
    };
  } | null;
}

const BUILTIN_EVALUATOR_SLUGS: Record<string, true> = {
  "exact-match": true,
  "contains-json": true,
  quality: true,
  auto_exact_match: true,
  auto_contains_json: true,
  auto_similarity_match: true,
  auto_regex_test: true,
  auto_json_diff: true,
  auto_ai_critique: true,
  auto_custom_code_run: true,
  auto_webhook_test: true,
  auto_levenshtein_distance: true,
  auto_starts_with: true,
  auto_ends_with: true,
};

export function isAgentWorkflowRow(row: ExistingWorkflowArtifactRow): boolean {
  if (!row || !row.id) return false;
  if (row.flags?.is_evaluator === true || row.flags?.is_snippet === true) {
    return false;
  }
  const slugRaw = (row.slug || "").toLowerCase().trim();
  const slugBase = slugRaw.replace(/-[a-z0-9]{6,12}$/, "");
  const nameLower = (row.name || "").toLowerCase().trim();
  if (
    BUILTIN_EVALUATOR_SLUGS[slugBase] ||
    BUILTIN_EVALUATOR_SLUGS[slugRaw] ||
    nameLower === "exact match" ||
    nameLower === "contains json" ||
    nameLower === "quality rating"
  ) {
    return false;
  }
  const descLower = (row.description || "").toLowerCase();
  if (descLower.includes("evaluator determines") || descLower.includes("evaluator checks")) {
    return false;
  }
  return true;
}
export function workflowRowToAgentMeta(
  row: ExistingWorkflowArtifactRow,
  claimedBaselineIds?: Set<string>
): ResolvedAgentMeta {
  const baseTpl = matchBaselineAgentTemplate(row);
  const isBaselineInstance = Boolean(
    baseTpl && (!claimedBaselineIds || !claimedBaselineIds.has(baseTpl.id))
  );
  if (baseTpl && isBaselineInstance && claimedBaselineIds) {
    claimedBaselineIds.add(baseTpl.id);
  }

  if (baseTpl && isBaselineInstance) {
    const rawName = (row.name || "").trim();
    const isGenericSlugName =
      !rawName ||
      rawName.toLowerCase() === baseTpl.templateKey.toLowerCase() ||
      rawName.toLowerCase().startsWith(`${baseTpl.templateKey.toLowerCase()}-`);
    const effectiveName = isGenericSlugName ? baseTpl.name : rawName;
    const wasRenamed = effectiveName.toLowerCase() !== baseTpl.name.toLowerCase();
    return {
      id: baseTpl.id,
      name: effectiveName,
      role: (row.description || "").trim() || baseTpl.role,
      category: baseTpl.category,
      initials: wasRenamed ? deriveAgentInitials(effectiveName) : baseTpl.initials,
      color: baseTpl.color,
      model: baseTpl.model,
      starterPrompts: baseTpl.starterPrompts,
      workflowId: row.id,
      slug: row.slug || baseTpl.templateKey,
      templateKey: baseTpl.templateKey,
      isCustom: false,
      isEngineering: false,
    };
  }

  const customId = deriveCustomAgentRoleKey(row.name, row.slug, row.id);
  const customName = (row.name || row.slug || customId).trim();
  return {
    id: customId,
    name: customName,
    role: (row.description || "").trim() || "Custom Specialist Agent",
    category: "Custom",
    initials: deriveAgentInitials(customName, row.slug),
    color: deriveCustomAgentColor(row.id || customId),
    model: "gemini/gemini-2.5-flash",
    starterPrompts: [],
    workflowId: row.id,
    slug: row.slug || customId,
    templateKey: row.meta?._ag?.template_origin?.key || undefined,
    isCustom: true,
    isEngineering: false,
  };
}

export function buildSubagentReferenceTools(
  parentAgentId: string,
  liveAgents: ResolvedAgentMeta[],
  existingTools?: unknown[]
): Array<Record<string, unknown>> {
  const baseList = Array.isArray(existingTools) ? existingTools : [];
  const nonReferenceTools: Array<Record<string, unknown>> = [];
  const existingRefDescriptions = new Map<string, string>();

  for (const item of baseList) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const toolObj = item as Record<string, unknown>;
    if (toolObj.type === "reference") {
      const slug = typeof toolObj.slug === "string" ? toolObj.slug.trim() : "";
      const desc = typeof toolObj.description === "string" ? toolObj.description.trim() : "";
      if (slug && desc) {
        existingRefDescriptions.set(slug, desc);
      }
      continue;
    }
    nonReferenceTools.push(toolObj);
  }

  if (nonReferenceTools.length === 0) {
    nonReferenceTools.push({
      type: "agenta_tools",
      tools: {
        get_current_session: "allow",
        rename_session: "allow",
      },
    });
  }

  // 1-Hop Star Topology: Only Chief of Staff ("ops") attaches specialists as Subagents
  if (parentAgentId !== "ops") {
    return nonReferenceTools;
  }

  const seenSlugs = new Set<string>();
  const subagentRefs: Array<Record<string, unknown>> = [];
  for (const ag of liveAgents) {
    if (!ag || ag.id === "ops" || ag.isEngineering || ag.id === "engineering") continue;
    const slug = (ag.slug || ag.templateKey || ag.id || "").trim();
    if (!slug || seenSlugs.has(slug)) continue;
    seenSlugs.add(slug);

    const defaultDesc = `Delegate to ${ag.name} (${ag.role}). Pass a clear task or question in messages.`;
    subagentRefs.push({
      type: "reference",
      ref_by: "variant",
      slug,
      description: existingRefDescriptions.get(slug) || defaultDesc,
      input_schema: {
        type: "object",
        properties: {
          messages: {
            type: "array",
            "x-ag-type-ref": "messages",
            description: "Conversation messages to send to this specialist subagent",
          },
        },
        required: ["messages"],
      },
    });
  }

  return [...nonReferenceTools, ...subagentRefs];
}

function randSlug(length = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export class AgentaProvisioner {
  private apiUrl: string;
  private webUrl: string;
  private authKey: string;

  private activeProvisions = new Map<string, Promise<AgentaProvisionResult>>();
  private syncedMountHashes = new Map<string, string>();
  private projectCredentials = new Map<
    string,
    { apiKey?: string; userId?: string; accessToken?: string }
  >();
  private liveRosterCache = new Map<
    string,
    { expiresAt: number; agents: ResolvedAgentMeta[] }
  >();

  constructor() {
    this.apiUrl = DEFAULT_AGENTA_API_URL.replace(/\/$/, "");
    this.webUrl = DEFAULT_AGENTA_WEB_URL.replace(/\/$/, "");
    this.authKey = DEFAULT_AGENTA_AUTH_KEY;
  }

  /**
   * Checks if Agenta API is reachable.
   */
  async isAgentaAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.apiUrl}/health`, { signal: AbortSignal.timeout(1500) });
      logCompany("Provisioner", `Checked Agenta API health at ${this.apiUrl}/health -> HTTP ${res.status}`);
      return res.status < 500;
    } catch (err) {
      logCompany("Provisioner", `Agenta API /health failed: ${err instanceof Error ? err.message : String(err)}, testing web URL...`);
      try {
        const res2 = await fetch(`${this.webUrl}/m`, { signal: AbortSignal.timeout(1500) });
        logCompany("Provisioner", `Checked Agenta Web URL at ${this.webUrl}/m -> HTTP ${res2.status}`);
        return res2.status < 500;
      } catch (err2) {
        logCompany("Provisioner", `Agenta Web URL also unreachable: ${err2 instanceof Error ? err2.message : String(err2)}`);
        return false;
      }
    }
  }

  /**
   * Resolves the active organization and user from the Agenta database.
   * Ensures the user's organization has a valid default project.
   */
  async resolveActiveTenant(sessionHint?: AgentaSessionHint): Promise<{
    orgId: string;
    orgName: string;
    userId: string;
    accessToken?: string;
    projects?: AgentaProjectListing[];
  } | null> {
    if (sessionHint?.authState === "logged-out") {
      logCompany("Provisioner", "Client reported logged-out Agenta webview session.");
      return null;
    }

    // 1. Primary Cloud-Ready Path: Resolve user & tenant via Agenta REST API using sAccessToken JWT
    const accessToken = sessionHint?.accessToken?.trim();
    if (accessToken) {
      try {
        const bearerHeaders = {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        };
        const [profileRes, projectsRes] = await Promise.all([
          fetch(`${this.apiUrl}/profile/`, {
            headers: bearerHeaders,
            signal: AbortSignal.timeout(3000),
          }),
          fetch(`${this.apiUrl}/projects/`, {
            headers: bearerHeaders,
            signal: AbortSignal.timeout(3000),
          }),
        ]);

        if (profileRes.ok) {
          const profile = (await profileRes.json()) as { id?: string; uid?: string; username?: string };
          const userId = profile.id ? String(profile.id) : undefined;
          const projects = projectsRes.ok
            ? ((await projectsRes.json()) as AgentaProjectListing[])
            : [];

          if (userId) {
            const defProj =
              projects.find((p) => p.is_default_project && p.organization_id) ||
              projects.find((p) => Boolean(p.organization_id));

            if (defProj?.organization_id) {
              const tenant = {
                orgId: String(defProj.organization_id),
                orgName: String(defProj.organization_name || "Workspace"),
                userId,
                accessToken,
                projects,
              };
              logCompany("Provisioner", "Resolved tenant via Agenta REST API (/profile + /projects):", {
                orgId: tenant.orgId,
                orgName: tenant.orgName,
                userId: tenant.userId,
                projectCount: projects.length,
              });
              return tenant;
            }

            // Fallback if /projects/ returned no org: query /organizations/
            const orgsRes = await fetch(`${this.apiUrl}/organizations/`, {
              headers: bearerHeaders,
              signal: AbortSignal.timeout(3000),
            });
            if (orgsRes.ok) {
              const orgs = (await orgsRes.json()) as Array<{ id?: string; name?: string }>;
              if (orgs?.[0]?.id) {
                const tenant = {
                  orgId: String(orgs[0].id),
                  orgName: String(orgs[0].name || "Workspace"),
                  userId,
                  accessToken,
                  projects,
                };
                logCompany("Provisioner", "Resolved tenant via Agenta REST API (/organizations):", {
                  orgId: tenant.orgId,
                  orgName: tenant.orgName,
                  userId: tenant.userId,
                });
                return tenant;
              }
            }
          }
        }
      } catch (restErr) {
        logCompany("Provisioner", "REST tenant resolution attempt did not complete, checking fallback:", restErr);
      }
    }
    if (sessionHint?.userId && sessionHint?.orgId) {
      return {
        orgId: sessionHint.orgId,
        orgName: "Workspace",
        userId: sessionHint.userId,
        accessToken: sessionHint.accessToken,
      };
    }

    // 2. Optional Local-Dev Fallback: SQL lookup when local Postgres is configured and reachable
    if (!isPostgresConfigured()) {
      return null;
    }
    try {
      let activeUid: string | null = null;
      try {
        const dbTokens = getTokensDb();
        const hintUid = sessionHint?.uid?.trim();
        const hintHandle = sessionHint?.sessionHandle?.trim();

        if (hintUid || hintHandle) {
          let rows: Array<{ user_id?: string; expires_at?: unknown }> = [];
          if (hintHandle && hintUid) {
            rows = (await dbTokens`
              SELECT user_id, expires_at FROM session_info
              WHERE session_handle = ${hintHandle}
                AND user_id = ${hintUid}
                AND expires_at > (extract(epoch from now()) * 1000)::bigint
              LIMIT 1
            `) as unknown as Array<{ user_id?: string; expires_at?: unknown }>;
          }
          if ((!rows || rows.length === 0) && hintUid) {
            rows = (await dbTokens`
              SELECT user_id, expires_at FROM session_info
              WHERE user_id = ${hintUid}
                AND expires_at > (extract(epoch from now()) * 1000)::bigint
              ORDER BY created_at_time DESC
              LIMIT 1
            `) as unknown as Array<{ user_id?: string; expires_at?: unknown }>;
          } else if ((!rows || rows.length === 0) && hintHandle) {
            rows = (await dbTokens`
              SELECT user_id, expires_at FROM session_info
              WHERE session_handle = ${hintHandle}
                AND expires_at > (extract(epoch from now()) * 1000)::bigint
              LIMIT 1
            `) as unknown as Array<{ user_id?: string; expires_at?: unknown }>;
          }

          if (rows?.[0]?.user_id && typeof rows[0].user_id === "string") {
            activeUid = rows[0].user_id;
          } else {
            return null;
          }
        } else {
          const rows = await dbTokens`SELECT user_id, expires_at FROM session_info 
            WHERE expires_at > (extract(epoch from now()) * 1000)::bigint 
            ORDER BY created_at_time DESC LIMIT 1`;
          if (rows[0]?.user_id && typeof rows[0].user_id === "string") {
            activeUid = rows[0].user_id;
          }
        }
      } catch (tokenErr) {
        logCompany("Provisioner", "Could not read session_info from Postgres:", tokenErr);
      }

      if (!activeUid) {
        return null;
      }
      const dbCore = getCoreDb();
      let tenant: { orgId: string; orgName: string; userId: string } | null = null;
      const res = await dbCore`SELECT u.id, o.id as org_id, o.name as org_name
        FROM users u
        JOIN organization_members om ON u.id = om.user_id
        JOIN organizations o ON o.id = om.organization_id
        WHERE u.uid = ${activeUid}
        ORDER BY om.created_at ASC
        LIMIT 1`;

      const userRows = res as unknown as Array<{ id: string; org_id: string; org_name: string }>;
      if (userRows && userRows.length > 0 && userRows[0]) {
        tenant = {
          orgId: String(userRows[0].org_id),
          orgName: String(userRows[0].org_name),
          userId: String(userRows[0].id),
        };
      } else {
        const fallback = await dbCore`SELECT u.id, o.id as org_id, o.name as org_name
          FROM users u
          JOIN organizations o ON u.id = o.owner_id
          WHERE u.uid = ${activeUid}
          LIMIT 1`;
        const fbRows = fallback as unknown as Array<{ id: string; org_id: string; org_name: string }>;
        if (fbRows && fbRows.length > 0 && fbRows[0]) {
          tenant = {
            orgId: String(fbRows[0].org_id),
            orgName: String(fbRows[0].org_name),
            userId: String(fbRows[0].id),
          };
        }
      }

      if (tenant) {
        const defaultCheck = await dbCore`SELECT id FROM projects 
          WHERE organization_id = ${tenant.orgId} AND is_default = true 
          LIMIT 1`;
        if (!defaultCheck || defaultCheck.length === 0) {
          const anyProj = await dbCore`SELECT id FROM projects 
            WHERE organization_id = ${tenant.orgId} 
            ORDER BY created_at ASC 
            LIMIT 1`;
          if (anyProj && anyProj.length > 0 && anyProj[0]?.id) {
            await dbCore`UPDATE projects SET is_default = true WHERE id = ${anyProj[0].id}`;
          }
        }
      }

      return tenant;
    } catch (err) {
      console.warn("[AgentaProvisioner] Could not resolve tenant via SQL:", err);
    }
    return null;
  }

  /**
   * Ensures the target Agenta project has a valid project-scoped PROVIDER_KEY secret
   * and returns its connection slug, provider family, and default model so provisioned
   * agents work out-of-the-box with Gemini, OpenAI, Anthropic, or any configured key.
   */
  private async ensureProjectLlmSecret(
    orgId: string,
    projId: string,
    userId: string,
    userHeaders: Record<string, string>
  ): Promise<ResolvedProjectLlmConfig> {
    try {
      // 1. Query Agenta Vault API for existing project-scoped or organization-shared PROVIDER_KEY secrets
      for (const queryUrl of [
        `${this.apiUrl}/secrets/?project_id=${projId}`,
        `${this.apiUrl}/secrets/?scope=organization&project_id=${projId}`,
      ]) {
        try {
          const listRes = await fetch(queryUrl, {
            method: "GET",
            headers: userHeaders,
          });
          if (listRes.ok) {
            const items = (await listRes.json()) as Array<{
              id?: string;
              slug?: string;
              kind?: string;
              data?: {
                kind?: string;
                models?: Array<{ slug?: string }>;
                model_keys?: string[];
              };
              header?: { name?: string };
            }>;
            // Prefer standard PROVIDER_KEY first
            const projProviderSecret = (items || []).find(
              (item) =>
                item?.slug &&
                item.kind?.toLowerCase() === "provider_key"
            );
            if (projProviderSecret?.slug) {
              const kind =
                projProviderSecret.data?.kind ||
                inferProviderFromSlugOrName(projProviderSecret.slug, projProviderSecret.header?.name);
              const resolved = resolveModelForProvider(kind);
              logCompany(
                "Provisioner",
                `Found existing LLM secret via Vault API (${queryUrl}): ${projProviderSecret.slug} (${resolved.provider} -> ${resolved.model})`
              );
              return { slug: projProviderSecret.slug, ...resolved };
            }

            // Next, check for an existing custom_provider (e.g., 80degrees OAuth Gateway)
            const customSecret = (items || []).find(
              (item) =>
                item?.slug &&
                item.kind?.toLowerCase() === "custom_provider"
            );
            if (customSecret?.slug) {
              const firstModel =
                customSecret.data?.models?.[0]?.slug ||
                customSecret.data?.model_keys?.[0] ||
                "gemini-3.1-pro";
              logCompany(
                "Provisioner",
                `Found existing custom_provider LLM secret via Vault API (${queryUrl}): ${customSecret.slug} (openai -> ${firstModel})`
              );
              return {
                slug: customSecret.slug,
                provider: "openai",
                model: firstModel,
                isCustomProvider: true,
              };
            }
          }
        } catch {}
      }

      // 2. Optional Local-Dev SQL Fallback: copy existing PROVIDER_KEY row if local Postgres is available
      if (isPostgresConfigured()) {
        try {
          const dbCore = getCoreDb();
          const existingProjSecret = (await dbCore`
            SELECT id, slug, name
            FROM secrets
            WHERE project_id = ${projId}
              AND kind = 'PROVIDER_KEY'
              AND deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT 1
          `) as unknown as Array<{ id: string; slug: string; name: string | null }>;

          if (existingProjSecret && existingProjSecret.length > 0 && existingProjSecret[0]?.slug) {
            const row = existingProjSecret[0];
            const slug = String(row.slug);
            const kind = inferProviderFromSlugOrName(slug, row.name);
            const resolved = resolveModelForProvider(kind);
            return { slug, ...resolved };
          }

          let sourceSecret = (await dbCore`
            SELECT id, slug, name
            FROM secrets
            WHERE kind = 'PROVIDER_KEY'
              AND deleted_at IS NULL
              AND (
                organization_id = ${orgId}
                OR project_id IN (SELECT id FROM projects WHERE organization_id = ${orgId})
              )
            ORDER BY created_at DESC
            LIMIT 1
          `) as unknown as Array<{ id: string; slug: string; name: string | null }>;

          if (!sourceSecret || sourceSecret.length === 0) {
            sourceSecret = (await dbCore`
              SELECT id, slug, name
              FROM secrets
              WHERE kind = 'PROVIDER_KEY'
                AND deleted_at IS NULL
              ORDER BY created_at DESC
              LIMIT 1
            `) as unknown as Array<{ id: string; slug: string; name: string | null }>;
          }

          if (sourceSecret && sourceSecret.length > 0 && sourceSecret[0]?.id) {
            const src = sourceSecret[0];
            const inserted = (await dbCore`
              INSERT INTO secrets (
                id, kind, data, name, description, slug,
                project_id, organization_id, user_id, availability,
                created_at, created_by_id
              )
              SELECT
                gen_random_uuid(), kind, data, name, description, slug,
                ${projId}, NULL, NULL, 'all_projects',
                now(), ${userId}
              FROM secrets
              WHERE id = ${src.id}
              ON CONFLICT (project_id, slug) WHERE slug IS NOT NULL DO NOTHING
              RETURNING id, slug, name
            `) as unknown as Array<{ id: string; slug: string; name: string | null }>;

            const targetRow = inserted?.[0] || src;
            let detectedKind = inferProviderFromSlugOrName(targetRow.slug, targetRow.name || src.name);
            if (inserted?.[0]?.id) {
              try {
                const putRes = await fetch(`${this.apiUrl}/secrets/${inserted[0].id}?project_id=${projId}`, {
                  method: "PUT",
                  headers: userHeaders,
                  body: JSON.stringify({
                    header: { name: inserted[0].name || src.name || "LLM Provider" },
                  }),
                });
                if (putRes.ok) {
                  const putData = (await putRes.json()) as { data?: { kind?: string } };
                  if (putData?.data?.kind) {
                    detectedKind = putData.data.kind;
                  }
                }
              } catch {}
            }
            const resolved = resolveModelForProvider(detectedKind);
            return { slug: String(targetRow.slug), ...resolved };
          }
        } catch {}
      }
      // 3. Fallback: Read Gemini / OpenAI / Anthropic key from crbn local vault or environment and create via Agenta Vault API
      let localKey: string | undefined =
        process.env.GEMINI_API_KEY ||
        process.env.GOOGLE_API_KEY ||
        process.env.OPENAI_API_KEY ||
        process.env.ANTHROPIC_API_KEY;
      let providerKind =
        process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY
          ? "gemini"
          : process.env.OPENAI_API_KEY
          ? "openai"
          : "anthropic";
      let displayName =
        providerKind === "gemini"
          ? "Google Gemini"
          : providerKind === "openai"
          ? "OpenAI"
          : "Anthropic";

      if (!localKey) {
        try {
          const authStorage = await discoverAuthStorage();
          for (const candidate of [
            { id: "google", kind: "gemini", label: "Google Gemini" },
            { id: "gemini", kind: "gemini", label: "Google Gemini" },
            { id: "openai", kind: "openai", label: "OpenAI" },
            { id: "anthropic", kind: "anthropic", label: "Anthropic" },
          ]) {
            const cred = authStorage.credentials.get(candidate.id);
            if (cred && cred.type === "api_key" && cred.key) {
              localKey = cred.key;
              providerKind = candidate.kind;
              displayName = candidate.label;
              break;
            }
          }
        } catch {}
      }

      if (localKey) {
        const createRes = await fetch(`${this.apiUrl}/secrets/?project_id=${projId}`, {
          method: "POST",
          headers: userHeaders,
          body: JSON.stringify({
            header: { name: displayName },
            secret: {
              kind: "provider_key",
              data: {
                kind: providerKind,
                provider: { key: localKey.trim() },
              },
            },
          }),
        });
        if (createRes.ok) {
          const created = (await createRes.json()) as { slug?: string; data?: { kind?: string } };
          if (created.slug) {
            const resolved = resolveModelForProvider(created.data?.kind || providerKind);
            logCompany(
              "Provisioner",
              `Created new project LLM secret "${created.slug}" (${resolved.provider} -> ${resolved.model}) from local crbn credentials`
            );
            return { slug: created.slug, ...resolved };
          }
        }
      }

      // 4. OAuth / Subscription Bridge Fallback (e.g., Google Antigravity, Gemini CLI, GitHub Copilot, Claude/Codex OAuth)
      // Routes Agenta's LLM Gateway to crbn's local OpenAI-compatible AuthGatewayRouter (/api/llm-proxy/v1)
      try {
        const authStorage = await discoverAuthStorage();
        const registry = new ModelRegistry(authStorage);
        await registry.refresh();
        const available = registry.getAvailable();
        if (available.length > 0) {
          const preferred =
            available.find((m) => m.provider === "google-antigravity") ||
            available.find((m) => m.provider === "google-gemini-cli") ||
            available.find((m) => m.provider === "anthropic") ||
            available.find((m) => m.provider === "openai-codex") ||
            available.find((m) => m.provider === "github-copilot") ||
            available[0];
          const primarySlug = preferred ? `${preferred.provider}/${preferred.id}` : "gemini-3.1-pro";
          const activePort = Number(process.env.BACKEND_PORT || process.env.PORT || 8000);
          const bridgeUrl = `http://host.docker.internal:${activePort}/api/llm-proxy/v1`;
          const modelSlugs = Array.from(
            new Set([
              primarySlug,
              preferred?.id || "gemini-3.1-pro",
              "gemini-3.1-pro",
              "gemini-2.5-flash",
              "claude-sonnet-4-5",
              "gpt-4o",
            ])
          ).map((slug) => ({ slug }));

          const bridgeRes = await fetch(`${this.apiUrl}/secrets/?project_id=${projId}`, {
            method: "POST",
            headers: userHeaders,
            body: JSON.stringify({
              header: {
                name: "80degrees OAuth Gateway",
                description: `Routes agent runs through crbn's authenticated OAuth provider (${preferred?.provider || "oauth"})`,
              },
              secret: {
                kind: "custom_provider",
                data: {
                  kind: "custom",
                  protocol: "openai",
                  provider: {
                    url: bridgeUrl,
                    key: "crbn-oauth-bridge",
                  },
                  models: modelSlugs,
                },
              },
            }),
          });
          if (bridgeRes.ok) {
            const createdBridge = (await bridgeRes.json()) as { slug?: string };
            if (createdBridge.slug) {
              logCompany(
                "Provisioner",
                `Created 80degrees OAuth Gateway custom_provider "${createdBridge.slug}" (${primarySlug} via ${bridgeUrl})`
              );
              return {
                slug: createdBridge.slug,
                provider: "openai",
                model: primarySlug,
                isCustomProvider: true,
              };
            }
          }
        }
      } catch (oauthErr) {
        console.warn("[AgentaProvisioner] OAuth bridge fallback error:", oauthErr);
      }
    } catch (err) {
      console.warn("[AgentaProvisioner] Failed to ensure project LLM secret:", err);
    }
    return resolveModelForProvider("gemini");
  }

  /**
   * Uploads project context files (COMPANY.md, CODEBASE_MAP.md, GIT_HISTORY.md, source files,
   * and the live bridge CLI) into the agent's durable mount (`agent-files/`).
   */
  async syncAgentMountFiles(
    projId: string,
    workflowId: string,
    mountFiles: SyncableMountFile[],
    userHeaders: Record<string, string>
  ): Promise<void> {
    if (!mountFiles || mountFiles.length === 0) return;
    try {
      const signRes = await fetch(
        `${this.apiUrl}/mounts/agents/sign?artifact_id=${encodeURIComponent(workflowId)}&name=default&project_id=${projId}`,
        {
          method: "POST",
          headers: userHeaders,
        }
      );
      if (!signRes.ok) return;
      const signData = (await signRes.json()) as { mount?: { id?: string } };
      const mountId = signData.mount?.id;
      if (!mountId) return;

      let uploadedCount = 0;
      for (const file of mountFiles) {
        const cacheKey = `${projId}:${mountId}:${file.path}`;
        if (this.syncedMountHashes.get(cacheKey) === file.sha256) {
          continue;
        }
        const putRes = await fetch(
          `${this.apiUrl}/mounts/${mountId}/files?path=${encodeURIComponent(file.path)}&project_id=${projId}`,
          {
            method: "PUT",
            headers: {
              Authorization: userHeaders.Authorization,
              "Content-Type": "application/octet-stream",
            },
            body: file.content,
          }
        );
        if (putRes.ok) {
          this.syncedMountHashes.set(cacheKey, file.sha256);
          uploadedCount++;
        }
      }
      if (uploadedCount > 0) {
        logCompany("Provisioner", `Synced ${uploadedCount} project file(s) to agent mount ${mountId} (workflow ${workflowId})`);
      }
    } catch (err) {
      console.warn(`[AgentaProvisioner] Failed to sync mount files for workflow ${workflowId}:`, err);
    }
  }

  /**
   * Ensures a workflow artifact has the department name/description and a revision with
   * the company-specific instructions and LLM connection slug.
   */
  private async customizeAgentWorkflow(
    projId: string,
    workflowId: string,
    variantId: string | undefined,
    agent: {
      id: string;
      name: string;
      description: string;
      model?: string;
      templateKey?: string;
      instructionsPrompt?: (projectName: string, projectDesc?: string) => string;
    },
    prompt: string,
    llmConfig: ResolvedProjectLlmConfig,
    userHeaders: Record<string, string>,
    contextBundle?: ProjectContextBundle,
    options?: {
      preserveUserMetadata?: boolean;
      roleUuidMap?: Record<string, string>;
      subagentTargets?: ResolvedAgentMeta[];
    }
  ): Promise<void> {
    try {
      if (!options?.preserveUserMetadata) {
        try {
          await fetch(`${this.apiUrl}/workflows/${workflowId}?project_id=${projId}`, {
            method: "PUT",
            headers: userHeaders,
            body: JSON.stringify({
              workflow: {
                id: workflowId,
                name: agent.name,
                description: agent.description,
              },
            }),
          });
        } catch {}

        if (isPostgresConfigured()) {
          try {
            const dbCore = getCoreDb();
            await dbCore`
              UPDATE workflow_artifacts
              SET name = ${agent.name}, description = ${agent.description}
              WHERE id = ${workflowId}
            `;
          } catch {}
        }
      }
      if (contextBundle?.mountFiles) {
        const activePort = Number(process.env.BACKEND_PORT || process.env.PORT || 8000);
        const bbTool = buildBlackboardCliScript(
          contextBundle.projectName,
          activePort,
          projId,
          userHeaders.Authorization,
          {
            selfRole: agent.id,
            selfAgentId: workflowId,
            selfAgentName: agent.name,
            roleUuidMap: options?.roleUuidMap,
          }
        );
        await this.syncAgentMountFiles(
          projId,
          workflowId,
          [...contextBundle.mountFiles, bbTool],
          userHeaders
        );
      }
      const queryRes = await fetch(`${this.apiUrl}/workflows/revisions/query?project_id=${projId}`, {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({
          workflow_refs: [{ id: workflowId }],
          grouping: { by: "artifact", get: "latest" },
        }),
      });
      if (!queryRes.ok) return;

      const qData = (await queryRes.json()) as {
        workflow_revisions?: Array<{
          workflow_variant_id?: string;
          variant_id?: string;
          data?: {
            parameters?: {
              agent?: Record<string, unknown>;
              [key: string]: unknown;
            };
            [key: string]: unknown;
          };
        }>;
      };

      const latestRev = qData.workflow_revisions?.[0];
      let resolvedVariantId = variantId || latestRev?.workflow_variant_id || latestRev?.variant_id;
      if (!resolvedVariantId) {
        try {
          const varQueryRes = await fetch(
            `${this.apiUrl}/workflows/variants/query?project_id=${projId}`,
            {
              method: "POST",
              headers: userHeaders,
              body: JSON.stringify({
                workflow_refs: [{ id: workflowId }],
              }),
            }
          );
          if (varQueryRes.ok) {
            const varData = (await varQueryRes.json()) as {
              workflow_variants?: Array<{ id?: string }>;
            };
            if (varData.workflow_variants?.[0]?.id) {
              resolvedVariantId = varData.workflow_variants[0].id;
            }
          }
        } catch {}
      }
      if (!resolvedVariantId && isPostgresConfigured()) {
        try {
          const dbCore = getCoreDb();
          const varRows = (await dbCore`
            SELECT id FROM workflow_variants
            WHERE artifact_id = ${workflowId} AND deleted_at IS NULL
            ORDER BY created_at DESC LIMIT 1
          `) as unknown as Array<{ id?: string }>;
          resolvedVariantId = varRows?.[0]?.id ? String(varRows[0].id) : undefined;
        } catch {}
      }
      if (!latestRev?.data?.parameters?.agent || !resolvedVariantId) return;

      const existingAgent = latestRev.data.parameters.agent as Record<string, unknown>;
      const existingInstructions = (existingAgent.instructions || {}) as Record<string, unknown>;
      const existingLlm = (existingAgent.llm || {}) as Record<string, unknown>;
      const existingConn = (existingLlm.connection || {}) as Record<string, unknown>;

      const currentAgentsMd =
        typeof existingInstructions.agents_md === "string" ? existingInstructions.agents_md : "";
      let baseTemplateMd = currentAgentsMd;
      if (contextBundle && isPostgresConfigured()) {
        try {
          const dbCore = getCoreDb();
          const v1Rows = (await dbCore`
            SELECT data->'parameters'->'agent'->'instructions'->>'agents_md' as v1_md
            FROM workflow_revisions
            WHERE artifact_id = ${workflowId} AND version = '1'
            LIMIT 1
          `) as unknown as Array<{ v1_md?: string | null }>;
          if (v1Rows?.[0]?.v1_md && v1Rows[0].v1_md.trim().length > 0) {
            baseTemplateMd = v1Rows[0].v1_md;
          }
        } catch {}
      }
      const effectiveBundle =
        contextBundle && options?.subagentTargets
          ? { ...contextBundle, roster: options.subagentTargets }
          : contextBundle;
      const desiredAgentsMd = effectiveBundle
        ? mergeCompanyContextIntoAgentsMd(agent, effectiveBundle, baseTemplateMd)
        : prompt;
      const resolvedLlm = llmConfig.isCustomProvider
        ? { provider: llmConfig.provider, model: llmConfig.model }
        : resolveModelForProvider(llmConfig.provider, agent.model);
      const existingTools = Array.isArray(existingAgent.tools) ? existingAgent.tools : [];
      const desiredTools = options?.subagentTargets
        ? buildSubagentReferenceTools(agent.id, options.subagentTargets, existingTools)
        : existingTools;
      const promptMatches = currentAgentsMd === desiredAgentsMd;
      const connMatches =
        !llmConfig.slug || (existingConn.mode === "agenta" && existingConn.slug === llmConfig.slug);
      const llmMatches =
        existingLlm.provider === resolvedLlm.provider &&
        existingLlm.model === resolvedLlm.model &&
        connMatches;
      const toolsMatches =
        !options?.subagentTargets ||
        JSON.stringify(existingTools) === JSON.stringify(desiredTools);
      if (promptMatches && llmMatches && toolsMatches) {
        return;
      }

      const newParams = {
        ...latestRev.data.parameters,
        agent: {
          ...existingAgent,
          instructions: {
            ...existingInstructions,
            agents_md: desiredAgentsMd,
          },
          llm: {
            ...existingLlm,
            provider: resolvedLlm.provider,
            model: resolvedLlm.model,
            ...(llmConfig.slug ? { connection: { mode: "agenta", slug: llmConfig.slug } } : {}),
          },
          ...(options?.subagentTargets ? { tools: desiredTools } : {}),
        },
      };
      await fetch(`${this.apiUrl}/workflows/revisions/commit?project_id=${projId}`, {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({
          workflow_revision: {
            workflow_id: workflowId,
            workflow_variant_id: resolvedVariantId,
            slug: randSlug(12),
            name: "default",
            data: {
              ...latestRev.data,
              parameters: newParams,
            },
            message: "Configure company instructions and model connection",
          },
        }),
      });
    } catch (updateErr) {
      console.warn(`[AgentaProvisioner] Could not customize workflow for ${agent.name}:`, updateErr);
    }
  }

  /**
   * Provisions a dedicated Agenta project and populates the 7 baseline agents.
   */
  async provisionCompanyAgents(
    companyName: string,
    projectName: string,
    agents: AgentTemplatePackage[],
    projectDesc?: string,
    sessionHint?: AgentaSessionHint,
    contextBundle?: ProjectContextBundle,
    options?: { alreadySeeded?: boolean }
  ): Promise<AgentaProvisionResult> {
    const fallbackUrl = `${this.webUrl}/m?project=${encodeURIComponent(projectName)}`;

    if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
      const mockAgents: ResolvedAgentMeta[] = agents.map((ag, idx) => ({
        id: ag.id,
        name: ag.name,
        role: ag.role,
        category: ag.color ? ag.category : "Operations",
        initials: ag.initials,
        color: ag.color,
        model: ag.model,
        starterPrompts: ag.starterPrompts,
        workflowId: `00000000-0000-4000-8000-${String(idx + 1).padStart(12, "0")}`,
        slug: `${ag.templateKey}-${String(idx + 1).padStart(4, "0")}`,
        templateKey: ag.templateKey,
        isCustom: false,
        isEngineering: false,
      }));
      return {
        success: true,
        agentaProjectId: "00000000-0000-0000-0000-000000000001",
        agentaWorkspaceId: "00000000-0000-0000-0000-000000000002",
        agentaUrl: `${this.webUrl}/m/w/00000000-0000-0000-0000-000000000002/p/00000000-0000-0000-0000-000000000001/agents`,
        agents: mockAgents,
        seeded: true,
      };
    }

    const sessionKey = sessionHint?.uid || sessionHint?.authState || "default";
    const lockKey = `${projectName.toLowerCase().trim()}::${companyName.toLowerCase().trim()}::${sessionKey}`;
    const inFlight = this.activeProvisions.get(lockKey);
    if (inFlight) {
      logCompany("Provisioner", `Awaiting in-flight provisionCompanyAgents for "${companyName}" (${projectName})`);
      return await inFlight;
    }

    const task = this._doProvisionCompanyAgents(
      companyName,
      projectName,
      agents,
      projectDesc,
      fallbackUrl,
      sessionHint,
      contextBundle,
      options
    );
    this.activeProvisions.set(lockKey, task);
    try {
      return await task;
    } finally {
      if (this.activeProvisions.get(lockKey) === task) {
        this.activeProvisions.delete(lockKey);
      }
    }
  }

  private async _doProvisionCompanyAgents(
    companyName: string,
    projectName: string,
    agents: AgentTemplatePackage[],
    projectDesc: string | undefined,
    fallbackUrl: string,
    sessionHint?: AgentaSessionHint,
    contextBundle?: ProjectContextBundle,
    options?: { alreadySeeded?: boolean }
  ): Promise<AgentaProvisionResult> {
    try {
      const available = await this.isAgentaAvailable();
      if (!available) {
        return {
          success: false,
          agentaUrl: fallbackUrl,
          error: "Agenta API is not currently reachable",
        };
      }
      const tenant = await this.resolveActiveTenant(sessionHint);
      if (!tenant) {
        return {
          success: false,
          needsAuth: true,
          agentaUrl: `${this.webUrl}/m`,
          error: "No active user session in Agenta",
        };
      }

      let orgId = tenant.orgId;
      let projId: string | undefined;
      let apiKey: string | undefined;
      const projectNameInAgenta = companyName;
      const candidateNames = new Set(
        [
          projectNameInAgenta,
          companyName,
          projectName,
          `${companyName} (Company)`,
          `${projectName} (Company)`,
        ].map((n) => n.toLowerCase().trim())
      );
      let existingWorkflows: ExistingWorkflowArtifactRow[] = [];

      try {
        // 1. REST-First Project Discovery from tenant.projects (/api/projects/)
        let defaultProjectId: string | undefined;
        const projectsList = tenant.projects || [];
        if (projectsList.length > 0) {
          const byHintId = sessionHint?.projectId
            ? projectsList.find((p) => p.project_id === sessionHint.projectId)
            : undefined;
          const matchedProj =
            byHintId ||
            projectsList.find(
              (p) => p.project_id && p.project_name && candidateNames.has(p.project_name.toLowerCase().trim())
            );
          if (matchedProj?.project_id) {
            projId = String(matchedProj.project_id);
            if (matchedProj.organization_id) {
              orgId = String(matchedProj.organization_id);
            }
          }
          const defProj =
            projectsList.find((p) => p.organization_id === orgId && p.is_default_project) ||
            projectsList.find((p) => p.organization_id === orgId) ||
            projectsList[0];
          if (defProj?.project_id) {
            defaultProjectId = String(defProj.project_id);
          }
        }

        // Verify sessionHint.projectId if tenant.projects was not populated
        if (!projId && sessionHint?.projectId) {
          if (isPostgresConfigured()) {
            try {
              const dbCore = getCoreDb();
              const checkRows = await dbCore`SELECT id FROM projects WHERE id = ${sessionHint.projectId} LIMIT 1`;
              if (checkRows && checkRows.length > 0 && checkRows[0]?.id) {
                projId = String(checkRows[0].id);
                apiKey = sessionHint.apiKey;
              }
            } catch {}
          } else {
            projId = sessionHint.projectId;
            apiKey = sessionHint.apiKey;
          }
        }
        // 1b. Optional Local-Dev SQL Fallback for project discovery when Postgres is configured
        if (!projId && isPostgresConfigured()) {
          try {
            const dbCore = getCoreDb();
            const userOrgs = (await dbCore`SELECT o.id, o.name
              FROM organizations o
              JOIN organization_members om ON o.id = om.organization_id
              WHERE om.user_id = ${tenant.userId}
              ORDER BY om.created_at ASC`) as unknown as Array<{ id: string; name: string }>;

            const candidateOrgs =
              userOrgs && userOrgs.length > 0 ? userOrgs : [{ id: orgId, name: tenant.orgName }];

            for (const cand of candidateOrgs) {
              const found = await dbCore`SELECT id FROM projects 
                WHERE organization_id = ${cand.id} 
                  AND (project_name = ${projectNameInAgenta} OR project_name = ${companyName} OR project_name = ${projectName} OR project_name = ${companyName + ' (Company)'} OR project_name = ${projectName + ' (Company)'}) 
                LIMIT 1`;
              if (found && found.length > 0 && found[0]?.id) {
                orgId = String(cand.id);
                projId = String(found[0].id);
                break;
              }
            }

            if (!projId && !defaultProjectId) {
              const defPrj = await dbCore`SELECT id FROM projects WHERE organization_id = ${orgId} AND is_default = true LIMIT 1`;
              if (defPrj && defPrj.length > 0 && defPrj[0]?.id) {
                defaultProjectId = String(defPrj[0].id);
              } else {
                const anyPrj = await dbCore`SELECT id FROM projects WHERE organization_id = ${orgId} ORDER BY created_at ASC LIMIT 1`;
                if (anyPrj && anyPrj.length > 0 && anyPrj[0]?.id) {
                  defaultProjectId = String(anyPrj[0].id);
                  await dbCore`UPDATE projects SET is_default = true WHERE id = ${defaultProjectId}`;
                }
              }
            }
          } catch {}
        }

        // 2. If project does not exist yet, create it via Agenta REST API
        if (!projId) {
          // 2a. Try creating directly with user's Bearer accessToken
          if (tenant.accessToken) {
            try {
              const prjRes = await fetch(`${this.apiUrl}/projects/`, {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${tenant.accessToken}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  name: projectNameInAgenta,
                  make_default: false,
                }),
              });
              if (prjRes.ok) {
                const prjData = (await prjRes.json()) as { project_id?: string };
                if (prjData.project_id) {
                  projId = prjData.project_id;
                }
              }
            } catch {}
          }

          // 2b. Try creating via defaultProjectId ApiKey
          if (!projId && defaultProjectId) {
            try {
              const keyRes = await fetch(`${this.apiUrl}/admin/simple/accounts/api-keys/`, {
                method: "POST",
                headers: {
                  Authorization: `Access ${this.authKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  options: { return_api_keys: true },
                  api_key: {
                    user_ref: { id: tenant.userId },
                    project_ref: { id: defaultProjectId },
                  },
                }),
              });
              if (keyRes.ok) {
                const keyData = (await keyRes.json()) as {
                  accounts?: Array<{ api_keys?: { key?: { value?: string } } }>;
                };
                const defaultKey = keyData.accounts?.[0]?.api_keys?.key?.value;
                if (defaultKey) {
                  const prjRes = await fetch(`${this.apiUrl}/projects/`, {
                    method: "POST",
                    headers: {
                      Authorization: `ApiKey ${defaultKey}`,
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                      name: projectNameInAgenta,
                      make_default: false,
                    }),
                  });
                  if (prjRes.ok) {
                    const prjData = (await prjRes.json()) as { project_id?: string };
                    if (prjData.project_id) {
                      projId = prjData.project_id;
                    }
                  }
                }
              }
            } catch (err) {
              console.warn("[AgentaProvisioner] Standard project create attempt:", err);
            }
          }

          // 2c. Fallback: Admin creation endpoint
          if (!projId) {
            const adminPrjRes = await fetch(`${this.apiUrl}/admin/simple/accounts/projects/`, {
              method: "POST",
              headers: {
                Authorization: `Access ${this.authKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                options: { create_api_keys: true, return_api_keys: true },
                project: {
                  organization_ref: { id: orgId },
                  workspace_ref: { id: orgId },
                  name: projectNameInAgenta,
                },
              }),
            });
            if (adminPrjRes.ok) {
              const prjData = (await adminPrjRes.json()) as {
                accounts?: Array<{ projects?: Record<string, { id?: string }> }>;
              };
              const createdPrj = prjData.accounts?.[0]?.projects;
              if (createdPrj) {
                const firstPrj = Object.values(createdPrj)[0];
                if (firstPrj?.id) projId = firstPrj.id;
              }
            }
          }
        }

        // 3. Acquire project-scoped API key (or use Bearer accessToken) & query existing workflows via REST
        if (projId) {
          if (isPostgresConfigured()) {
            try {
              const dbCore = getCoreDb();
              const existingEnvs = await dbCore`SELECT slug FROM environment_artifacts WHERE project_id = ${projId}`;
              const envSlugs = new Set((existingEnvs || []).map((e) => String(e.slug)));
              for (const envName of ["development", "staging", "production"]) {
                if (!envSlugs.has(envName)) {
                  await dbCore`INSERT INTO environment_artifacts (id, project_id, slug, name) 
                    VALUES (gen_random_uuid(), ${projId}, ${envName}, ${envName}) 
                    ON CONFLICT DO NOTHING`;
                }
              }
              const existingMem = await dbCore`SELECT id FROM project_members WHERE project_id = ${projId} AND user_id = ${tenant.userId} LIMIT 1`;
              if (!existingMem || existingMem.length === 0) {
                await dbCore`INSERT INTO project_members (id, project_id, user_id, role, created_at, updated_at) 
                  VALUES (gen_random_uuid(), ${projId}, ${tenant.userId}, 'owner', now(), now()) 
                  ON CONFLICT DO NOTHING`;
              }
            } catch {}
          }

          try {
            const keyRes = await fetch(`${this.apiUrl}/admin/simple/accounts/api-keys/`, {
              method: "POST",
              headers: {
                Authorization: `Access ${this.authKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                options: { return_api_keys: true },
                api_key: {
                  user_ref: { id: tenant.userId },
                  project_ref: { id: projId },
                },
              }),
            });
            if (keyRes.ok) {
              const keyData = (await keyRes.json()) as {
                accounts?: Array<{ api_keys?: { key?: { value?: string } } }>;
              };
              const rawKey = keyData.accounts?.[0]?.api_keys?.key?.value;
              if (rawKey) {
                apiKey = rawKey;
              }
            }
          } catch {}

          this.projectCredentials.set(projId, {
            apiKey,
            userId: tenant.userId,
            accessToken: tenant.accessToken,
          });

          const activeAuthHeader = apiKey
            ? `ApiKey ${apiKey}`
            : tenant.accessToken
            ? `Bearer ${tenant.accessToken}`
            : undefined;

          if (activeAuthHeader) {
            try {
              const wfQueryRes = await fetch(
                `${this.apiUrl}/workflows/query?project_id=${projId}`,
                {
                  method: "POST",
                  headers: {
                    Authorization: activeAuthHeader,
                    "Content-Type": "application/json",
                  },
                  body: JSON.stringify({
                    workflow: { flags: { is_application: true, is_evaluator: false, is_snippet: false } },
                    flags: { is_application: true, is_evaluator: false },
                  }),
                }
              );
              if (wfQueryRes.ok) {
                const wfQueryData = (await wfQueryRes.json()) as {
                  workflows?: ExistingWorkflowArtifactRow[];
                };
                if (Array.isArray(wfQueryData.workflows)) {
                  existingWorkflows = wfQueryData.workflows.filter(isAgentWorkflowRow);
                }
              }
            } catch {}
          }

          if (existingWorkflows.length === 0 && isPostgresConfigured()) {
            try {
              const dbCore = getCoreDb();
              const rows = await dbCore`
                SELECT id, name, slug, description, flags, meta
                FROM workflow_artifacts
                WHERE project_id = ${projId}
                  AND (flags->>'is_application')::boolean = true
                  AND COALESCE((flags->>'is_evaluator')::boolean, false) = false
                  AND deleted_at IS NULL
              `;
              existingWorkflows = ((rows || []) as unknown as ExistingWorkflowArtifactRow[]).filter(
                isAgentWorkflowRow
              );
            } catch {}
          }
        }
      } catch (err) {
        console.warn("[AgentaProvisioner] Error handling project in user organization:", err);
      }

      const resolvedAuthHeader = apiKey
        ? `ApiKey ${apiKey}`
        : tenant.accessToken
        ? `Bearer ${tenant.accessToken}`
        : undefined;

      if (!projId || !resolvedAuthHeader) {
        return {
          success: false,
          agentaUrl: fallbackUrl,
          error: "Failed to resolve project or authentication credentials in user organization",
        };
      }

      const userHeaders = {
        Authorization: resolvedAuthHeader,
        "Content-Type": "application/json",
      };

      // 5. Ensure project has a valid project-scoped LLM secret and resolve its slug + provider/model
      const llmConfig = await this.ensureProjectLlmSecret(orgId, projId, tenant.userId, userHeaders);
      const activePort = Number(process.env.BACKEND_PORT || process.env.PORT || 8000);
      const allMountFiles: SyncableMountFile[] = contextBundle?.mountFiles
        ? [
            ...contextBundle.mountFiles,
            buildBlackboardCliScript(
              contextBundle.projectName,
              activePort,
              projId,
              userHeaders.Authorization
            ),
          ]
        : [];
      const workspaceFilesMap: Record<string, string> = {};
      for (const mf of allMountFiles) {
        workspaceFilesMap[mf.path] = mf.content;
      }

      // Only seed missing baseline templates on initial provisioning (or if project has 0 workflows).
      // Once seeded, if the user deletes an agent in Agenta, we respect their deletion!
      const shouldSeedMissingBaseline = !options?.alreadySeeded || existingWorkflows.length === 0;
      const handledWorkflowIds = new Set<string>();
      const initialClaimed = new Set<string>();
      const initialRoleUuidMap = buildLiveAgentLookupMap(
        existingWorkflows.map((r) => workflowRowToAgentMeta(r, initialClaimed))
      );
      // 6. Provision or sync baseline agents in parallel
      await Promise.allSettled(
        agents.map(async (agent) => {
          const agentLlm = llmConfig.isCustomProvider
            ? { provider: llmConfig.provider, model: llmConfig.model }
            : resolveModelForProvider(llmConfig.provider, agent.model);
          const prompt = contextBundle
            ? mergeCompanyContextIntoAgentsMd(agent, contextBundle)
            : agent.instructionsPrompt(companyName, projectDesc);
          const tplKeyLower = agent.templateKey?.toLowerCase().trim();
          const idLower = agent.id.toLowerCase().trim();
          const nameLower = agent.name.toLowerCase().trim();

          // Find any existing template-loaded workflow or fallback workflow for this agent
          const templateMatch = existingWorkflows.find((row) => {
            const originKey = row.meta?._ag?.template_origin?.key?.toLowerCase().trim();
            const slugLower = row.slug?.toLowerCase().trim() || "";
            return Boolean(
              tplKeyLower &&
                (originKey === tplKeyLower ||
                  slugLower === tplKeyLower ||
                  slugLower.startsWith(`${tplKeyLower}-`))
            );
          });

          const fallbackMatches = existingWorkflows.filter((row) => {
            if (templateMatch && row.id === templateMatch.id) return false;
            const rowName = row.name?.toLowerCase().trim() || "";
            const slugLower = row.slug?.toLowerCase().trim() || "";
            return (
              rowName === nameLower ||
              slugLower === idLower ||
              slugLower.startsWith(`${idLower}-`)
            );
          });

          // If both a template workflow and duplicate fallback workflow(s) exist, archive/remove the duplicates
          const duplicatesToPurge =
            templateMatch && fallbackMatches.length > 0
              ? fallbackMatches
              : !templateMatch && fallbackMatches.length > 1
              ? fallbackMatches.slice(1)
              : [];
          for (const dup of duplicatesToPurge) {
            handledWorkflowIds.add(dup.id);
            try {
              await fetch(`${this.apiUrl}/workflows/${dup.id}/archive?project_id=${projId}`, {
                method: "POST",
                headers: userHeaders,
              });
            } catch {}
            if (isPostgresConfigured()) {
              try {
                const dbCore = getCoreDb();
                await dbCore`DELETE FROM workflow_artifacts WHERE id = ${dup.id}`;
              } catch {}
            }
          }
          const existingAgentWf = templateMatch || fallbackMatches[0];
          if (existingAgentWf) {
            handledWorkflowIds.add(existingAgentWf.id);
            if (agent.id === "ops") {
              // Chief of Staff is customized in Step 8 once all live subagent slugs are resolved
              return;
            }
            await this.customizeAgentWorkflow(
              projId,
              existingAgentWf.id,
              undefined,
              agent,
              prompt,
              llmConfig,
              userHeaders,
              contextBundle,
              { preserveUserMetadata: true, roleUuidMap: initialRoleUuidMap }
            );
            return;
          }

          if (!shouldSeedMissingBaseline) {
            return;
          }
          let loadedViaTemplate = false;
          let workflowId: string | undefined;
          let variantId: string | undefined;

          // Try loading Agenta's native built-in template package
          if (agent.templateKey) {
            try {
              const baseRevisionPayload = {
                uri: "agenta:builtin:agent:v0",
                parameters: {
                  agent: {
                    instructions: {
                      agents_md: prompt,
                    },
                    llm: {
                      provider: agentLlm.provider,
                      model: agentLlm.model,
                      ...(llmConfig.slug
                        ? { connection: { mode: "agenta", slug: llmConfig.slug } }
                        : {}),
                    },
                    harness: { kind: "pi_core" },
                    runner: { kind: "sidecar", permissions: { default: "allow" } },
                    sandbox: { kind: "local" },
                    tools: [
                      {
                        type: "agenta_tools",
                        tools: {
                          get_current_session: "allow",
                          rename_session: "allow",
                        },
                      },
                    ],
                    skills: [],
                    mcps: [],
                  },
                },
                schemas: {
                  inputs: {
                    $schema: "https://json-schema.org/draft/2020-12/schema",
                    type: "object",
                    properties: {
                      messages: {
                        type: "array",
                        "x-ag-type-ref": "messages",
                        description: "Conversation history",
                      },
                    },
                    required: ["messages"],
                  },
                },
              };

              let tplRes = await fetch(`${this.apiUrl}/agent-templates/load?project_id=${projId}`, {
                method: "POST",
                headers: {
                  ...userHeaders,
                  "Idempotency-Key": `tpl-load-${projId}-${agent.id}`,
                },
                body: JSON.stringify({
                  source: { kind: "internal", key: agent.templateKey },
                  workflow_name: agent.name,
                  workflow_description: agent.description,
                  workspace_files: workspaceFilesMap,
                  base_revision: baseRevisionPayload,
                  skip_initial_session: true,
                  initial_message: "Ready",
                }),
              });

              // Fallback for stock Agenta images whose strict request schema predates skip_initial_session / workspace_files
              if (tplRes.status === 422) {
                tplRes = await fetch(`${this.apiUrl}/agent-templates/load?project_id=${projId}`, {
                  method: "POST",
                  headers: {
                    ...userHeaders,
                    "Idempotency-Key": `tpl-load-compat-${projId}-${agent.id}`,
                  },
                  body: JSON.stringify({
                    source: { kind: "internal", key: agent.templateKey },
                    base_revision: baseRevisionPayload,
                    initial_message: "Ready",
                  }),
                });
              }

              if (tplRes.ok) {
                loadedViaTemplate = true;
                const tplData = (await tplRes.json()) as { workflow_id?: string; variant_id?: string };
                workflowId = tplData.workflow_id;
                variantId = tplData.variant_id;
              } else {
                // Even on HTTP 503 (template_handoff_not_durable), prepare() may have already committed
                // the template workflow, skills, and mounts. Check via REST /workflows/query first!
                try {
                  const recRes = await fetch(
                    `${this.apiUrl}/workflows/query?project_id=${projId}`,
                    {
                      method: "POST",
                      headers: userHeaders,
                      body: JSON.stringify({ flags: { is_application: true } }),
                    }
                  );
                  if (recRes.ok) {
                    const recData = (await recRes.json()) as {
                      workflows?: ExistingWorkflowArtifactRow[];
                    };
                    const recMatch = (recData.workflows || []).find((row) => {
                      const originKey = row.meta?._ag?.template_origin?.key?.toLowerCase().trim();
                      const slugLower = row.slug?.toLowerCase().trim() || "";
                      return Boolean(
                        tplKeyLower &&
                          (originKey === tplKeyLower ||
                            slugLower === tplKeyLower ||
                            slugLower.startsWith(`${tplKeyLower}-`))
                      );
                    });
                    if (recMatch?.id) {
                      loadedViaTemplate = true;
                      workflowId = recMatch.id;
                      logCompany(
                        "Provisioner",
                        `Recovered committed template workflow ${workflowId} via REST for ${agent.name} after HTTP ${tplRes.status}`
                      );
                    }
                  }
                } catch {}

                if (!loadedViaTemplate && isPostgresConfigured()) {
                  try {
                    const dbCore = getCoreDb();
                    const recovered = (await dbCore`
                      SELECT wa.id as workflow_id, wv.id as variant_id
                      FROM workflow_artifacts wa
                      LEFT JOIN workflow_variants wv ON wv.artifact_id = wa.id AND wv.deleted_at IS NULL
                      WHERE wa.project_id = ${projId}
                        AND wa.deleted_at IS NULL
                        AND (
                          wa.meta->'_ag'->'template_origin'->>'key' = ${agent.templateKey}
                          OR wa.slug LIKE ${agent.templateKey + '-%'}
                          OR wa.slug = ${agent.templateKey}
                        )
                      ORDER BY wa.created_at DESC
                      LIMIT 1
                    `) as unknown as Array<{ workflow_id?: string; variant_id?: string }>;

                    if (recovered && recovered.length > 0 && recovered[0]?.workflow_id) {
                      loadedViaTemplate = true;
                      workflowId = String(recovered[0].workflow_id);
                      variantId = recovered[0].variant_id ? String(recovered[0].variant_id) : undefined;
                    }
                  } catch {}
                }
              }
              if (loadedViaTemplate && workflowId) {
                handledWorkflowIds.add(workflowId);
                await this.customizeAgentWorkflow(
                  projId,
                  workflowId,
                  variantId,
                  agent,
                  prompt,
                  llmConfig,
                  userHeaders,
                  contextBundle,
                  { preserveUserMetadata: false }
                );
              }
            } catch (tplErr) {
              console.warn(`[AgentaProvisioner] Template load attempt for ${agent.templateKey}:`, tplErr);
            }
          }

          // Fallback: Direct workflow creation ONLY if template workflow was not created in Postgres
          if (!loadedViaTemplate) {
            try {
              const uniqueSlug = `${agent.id}-${randSlug(6)}`;

              // Step 1: Create workflow artifact
              const wfRes = await fetch(`${this.apiUrl}/workflows/?project_id=${projId}`, {
                method: "POST",
                headers: userHeaders,
                body: JSON.stringify({
                  workflow: {
                    slug: uniqueSlug,
                    name: agent.name,
                    description: agent.description,
                    flags: { is_application: true, is_evaluator: false, is_snippet: false },
                  },
                }),
              });
              const wfData = (await wfRes.json()) as WorkflowCreateResponse;
              const createdWfId = wfData.workflow?.id;
              if (!createdWfId) return;
              handledWorkflowIds.add(createdWfId);
              // Step 2: Create default variant
              const varSlug = `${uniqueSlug}.default`;
              const varRes = await fetch(`${this.apiUrl}/workflows/variants/?project_id=${projId}`, {
                method: "POST",
                headers: userHeaders,
                body: JSON.stringify({
                  workflow_variant: {
                    workflow_id: createdWfId,
                    slug: varSlug,
                    name: "default",
                  },
                }),
              });
              const varData = (await varRes.json()) as VariantCreateResponse;
              const createdVarId = varData.workflow_variant?.id;
              if (!createdVarId) return;

              // Step 3: Commit seed revision (v0)
              await fetch(`${this.apiUrl}/workflows/revisions/commit?project_id=${projId}`, {
                method: "POST",
                headers: userHeaders,
                body: JSON.stringify({
                  workflow_revision: {
                    workflow_id: createdWfId,
                    workflow_variant_id: createdVarId,
                    slug: randSlug(12),
                    name: "default",
                    message: "Initial commit",
                  },
                }),
              });

              // Step 4: Commit data revision (v1) with complete runtime parameters and input schema
              await fetch(`${this.apiUrl}/workflows/revisions/commit?project_id=${projId}`, {
                method: "POST",
                headers: userHeaders,
                body: JSON.stringify({
                  workflow_revision: {
                    workflow_id: createdWfId,
                    workflow_variant_id: createdVarId,
                    slug: randSlug(12),
                    name: "default",
                    data: {
                      uri: "agenta:builtin:agent:v0",
                      parameters: {
                        agent: {
                          instructions: {
                            agents_md: prompt,
                          },
                          llm: {
                            provider: agentLlm.provider,
                            model: agentLlm.model,
                            ...(llmConfig.slug
                              ? { connection: { mode: "agenta", slug: llmConfig.slug } }
                              : {}),
                          },
                          tools: [
                            {
                              type: "agenta_tools",
                              tools: {
                                get_current_session: "allow",
                                rename_session: "allow",
                              },
                            },
                          ],
                          mcps: [],
                          skills: [],
                          harness: { kind: "pi_core" },
                          runner: { kind: "sidecar", permissions: { default: "allow" } },
                          sandbox: { kind: "local" },
                        },
                      },
                      schemas: {
                        inputs: {
                          $schema: "https://json-schema.org/draft/2020-12/schema",
                          type: "object",
                          properties: {
                            messages: {
                              type: "array",
                              "x-ag-type-ref": "messages",
                              description: "Conversation history",
                            },
                          },
                          required: ["messages"],
                        },
                      },
                    },
                    flags: {
                      is_agent: true,
                      is_managed: true,
                      is_chat: true,
                    },
                    message: "Baseline company agent setup",
                  },
                }),
              });

              if (contextBundle?.mountFiles) {
                const activePort = Number(process.env.BACKEND_PORT || process.env.PORT || 8000);
                const bbTool = buildBlackboardCliScript(
                  contextBundle.projectName,
                  activePort,
                  projId,
                  userHeaders.Authorization,
                  {
                    selfRole: agent.id,
                    selfAgentId: createdWfId,
                    selfAgentName: agent.name,
                  }
                );
                await this.syncAgentMountFiles(
                  projId,
                  createdWfId,
                  [...contextBundle.mountFiles, bbTool],
                  userHeaders
                );
              }
            } catch (err) {
              console.warn(`[AgentaProvisioner] Error provisioning fallback agent ${agent.name}:`, err);
            }
          }
        })
      );

      // 7. Query final live workflows in the project (captures newly created baseline agents AND any user-created custom agents)
      let finalWorkflows: ExistingWorkflowArtifactRow[] = [];
      try {
        const finalRes = await fetch(`${this.apiUrl}/workflows/query?project_id=${projId}`, {
          method: "POST",
          headers: userHeaders,
          body: JSON.stringify({
            workflow: { flags: { is_application: true, is_evaluator: false, is_snippet: false } },
            flags: { is_application: true, is_evaluator: false },
          }),
        });
        if (finalRes.ok) {
          const finalData = (await finalRes.json()) as {
            workflows?: ExistingWorkflowArtifactRow[];
          };
          if (Array.isArray(finalData.workflows)) {
            finalWorkflows = finalData.workflows.filter(isAgentWorkflowRow);
          }
        }
      } catch {}

      if (finalWorkflows.length === 0 && isPostgresConfigured()) {
        try {
          const dbCore = getCoreDb();
          const rows = await dbCore`
            SELECT id, name, slug, description, flags, meta
            FROM workflow_artifacts
            WHERE project_id = ${projId}
              AND (flags->>'is_application')::boolean = true
              AND COALESCE((flags->>'is_evaluator')::boolean, false) = false
              AND deleted_at IS NULL
          `;
          finalWorkflows = ((rows || []) as unknown as ExistingWorkflowArtifactRow[]).filter(
            isAgentWorkflowRow
          );
        } catch {}
      }

      const claimedBaselineIds = new Set<string>();
      const liveAgents: ResolvedAgentMeta[] = finalWorkflows.map((row) =>
        workflowRowToAgentMeta(row, claimedBaselineIds)
      );
      const roleUuidMap = buildLiveAgentLookupMap(liveAgents);

      // 8. Wire Chief of Staff ("ops") with all live specialist/custom Subagents, auto-onboard custom agents,
      // and refresh .tools/bin/blackboard with full roleUuidMap for all live agents.
      const opsTemplate = agents.find((a) => a.id === "ops");
      await Promise.allSettled(
        liveAgents.map(async (liveAg) => {
          if (!liveAg.workflowId) return;
          if (liveAg.id === "ops") {
            const opsAgentDef = opsTemplate || {
              id: "ops",
              name: liveAg.name,
              description: liveAg.role,
              model: liveAg.model,
            };
            const opsPrompt = contextBundle
              ? mergeCompanyContextIntoAgentsMd(opsAgentDef, {
                  ...contextBundle,
                  roster: liveAgents,
                })
              : `# ${liveAg.name}\n\nYou are ${liveAg.name} for ${companyName}.`;
            await this.customizeAgentWorkflow(
              projId,
              liveAg.workflowId,
              undefined,
              opsAgentDef,
              opsPrompt,
              llmConfig,
              userHeaders,
              contextBundle,
              {
                preserveUserMetadata: true,
                roleUuidMap,
                subagentTargets: liveAgents,
              }
            );
          } else if (liveAg.isCustom && !handledWorkflowIds.has(liveAg.workflowId)) {
            const customPrompt = contextBundle
              ? mergeCompanyContextIntoAgentsMd(
                  {
                    id: liveAg.id,
                    name: liveAg.name,
                    role: liveAg.role,
                    description: liveAg.role,
                  },
                  { ...contextBundle, roster: liveAgents }
                )
              : `# ${liveAg.name}\n\nYou are ${liveAg.name} (${liveAg.role}) for ${companyName}.`;
            await this.customizeAgentWorkflow(
              projId,
              liveAg.workflowId,
              undefined,
              {
                id: liveAg.id,
                name: liveAg.name,
                description: liveAg.role,
                model: liveAg.model,
              },
              customPrompt,
              llmConfig,
              userHeaders,
              contextBundle,
              {
                preserveUserMetadata: true,
                roleUuidMap,
              }
            );
          } else if (contextBundle?.mountFiles) {
            const activePort = Number(process.env.BACKEND_PORT || process.env.PORT || 8000);
            const bbTool = buildBlackboardCliScript(
              contextBundle.projectName,
              activePort,
              projId,
              userHeaders.Authorization,
              {
                selfRole: liveAg.id,
                selfAgentId: liveAg.workflowId,
                selfAgentName: liveAg.name,
                roleUuidMap,
              }
            );
            await this.syncAgentMountFiles(
              projId,
              liveAg.workflowId,
              [bbTool],
              userHeaders
            );
          }
        })
      );

      this.liveRosterCache.set(projId, {
        expiresAt: Date.now() + 4000,
        agents: liveAgents,
      });

      const agentaDashboardUrl = orgId
        ? `${this.webUrl}/m/w/${orgId}/p/${projId}/agents`
        : `${this.webUrl}/m?project=${projId}`;

      return {
        success: true,
        agentaProjectId: projId,
        agentaWorkspaceId: orgId,
        agentaUserId: tenant.userId,
        agentaApiKey: apiKey,
        agentaUrl: agentaDashboardUrl,
        agents: liveAgents,
        seeded: true,
      };
    } catch (err) {
      console.warn("[AgentaProvisioner] Unexpected error during Agenta provisioning:", err);
      return {
        success: false,
        agentaUrl: fallbackUrl,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Resolves a project-scoped API key for an existing Agenta project and executes a
   * request against Agenta's BlackboardRouter (`/api/blackboard/*`).
   */
  async resolveProjectAuthHeader(
    agentaProjectId: string,
    authContext?: {
      userId?: string;
      apiKey?: string;
      accessToken?: string;
    }
  ): Promise<string | undefined> {
    const cached = this.projectCredentials.get(agentaProjectId);
    let apiKey = authContext?.apiKey || cached?.apiKey;
    const accessToken = authContext?.accessToken || cached?.accessToken;
    let userId = authContext?.userId || cached?.userId;

    if (!apiKey && !accessToken) {
      if (!userId && isPostgresConfigured()) {
        try {
          const dbCore = getCoreDb();
          const memberRows = (await dbCore`
            SELECT user_id FROM project_members
            WHERE project_id = ${agentaProjectId}
            ORDER BY created_at ASC LIMIT 1
          `) as unknown as Array<{ user_id?: string }>;
          userId = memberRows?.[0]?.user_id ? String(memberRows[0].user_id) : undefined;
          if (!userId) {
            const ownerRows = (await dbCore`
              SELECT o.owner_id
              FROM projects p
              JOIN organizations o ON o.id = p.organization_id
              WHERE p.id = ${agentaProjectId}
              LIMIT 1
            `) as unknown as Array<{ owner_id?: string }>;
            userId = ownerRows?.[0]?.owner_id ? String(ownerRows[0].owner_id) : undefined;
          }
        } catch {}
      }

      if (userId) {
        try {
          const keyRes = await fetch(`${this.apiUrl}/admin/simple/accounts/api-keys/`, {
            method: "POST",
            headers: {
              Authorization: `Access ${this.authKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              options: { return_api_keys: true },
              api_key: {
                user_ref: { id: userId },
                project_ref: { id: agentaProjectId },
              },
            }),
          });
          if (keyRes.ok) {
            const keyData = (await keyRes.json()) as {
              accounts?: Array<{ api_keys?: { key?: { value?: string } } }>;
            };
            apiKey = keyData.accounts?.[0]?.api_keys?.key?.value;
            if (apiKey) {
              this.projectCredentials.set(agentaProjectId, { apiKey, userId, accessToken });
            }
          }
        } catch {}
      }
    }

    return apiKey
      ? `ApiKey ${apiKey}`
      : accessToken
      ? `Bearer ${accessToken}`
      : undefined;
  }

  /**
   * Queries the live active workflows in Agenta for `agentaProjectId` (cached for 3s)
   * so new custom agents and agent deletions/renames are reflected immediately.
   */
  async fetchLiveProjectAgents(
    agentaProjectId: string,
    authContext?: {
      userId?: string;
      apiKey?: string;
      accessToken?: string;
    },
    forceRefresh = false
  ): Promise<ResolvedAgentMeta[] | null> {
    if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
      return null;
    }
    const now = Date.now();
    const cached = this.liveRosterCache.get(agentaProjectId);
    if (!forceRefresh && cached && cached.expiresAt > now) {
      return cached.agents;
    }

    const authHeader = await this.resolveProjectAuthHeader(agentaProjectId, authContext);
    let rows: ExistingWorkflowArtifactRow[] | null = null;

    if (authHeader) {
      try {
        const res = await fetch(
          `${this.apiUrl}/workflows/query?project_id=${encodeURIComponent(agentaProjectId)}`,
          {
            method: "POST",
            headers: {
              Authorization: authHeader,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              workflow: { flags: { is_application: true, is_evaluator: false, is_snippet: false } },
              flags: { is_application: true, is_evaluator: false },
            }),
            signal: AbortSignal.timeout(2500),
          }
        );
        if (res.ok) {
          const data = (await res.json()) as { workflows?: ExistingWorkflowArtifactRow[] };
          if (Array.isArray(data.workflows)) {
            rows = data.workflows.filter(isAgentWorkflowRow);
          }
        }
      } catch {}
    }

    if (!rows && isPostgresConfigured()) {
      try {
        const dbCore = getCoreDb();
        const dbRows = await dbCore`
          SELECT id, name, slug, description, flags, meta
          FROM workflow_artifacts
          WHERE project_id = ${agentaProjectId}
            AND (flags->>'is_application')::boolean = true
            AND COALESCE((flags->>'is_evaluator')::boolean, false) = false
            AND deleted_at IS NULL
        `;
        rows = ((dbRows || []) as unknown as ExistingWorkflowArtifactRow[]).filter(
          isAgentWorkflowRow
        );
      } catch {}
    }

    if (!rows) return null;

    const claimedBaselineIds = new Set<string>();
    const agents = rows.map((row) => workflowRowToAgentMeta(row, claimedBaselineIds));
    this.liveRosterCache.set(agentaProjectId, {
      expiresAt: Date.now() + 3000,
      agents,
    });
    return agents;
  }

  async callBlackboardApi(
    agentaProjectId: string,
    subPath: string,
    method: string = "GET",
    body?: unknown,
    authContext?: {
      userId?: string;
      apiKey?: string;
      accessToken?: string;
    }
  ): Promise<{ status: number; data: unknown }> {
    const authHeader = await this.resolveProjectAuthHeader(agentaProjectId, authContext);
    if (!authHeader) {
      return { status: 401, data: { detail: "No Agenta API key or session token available for Blackboard" } };
    }
    const normalizedSub = subPath.startsWith("/") ? subPath : `/${subPath}`;
    const sep = normalizedSub.includes("?") ? "&" : "?";
    const targetUrl = `${this.apiUrl}/blackboard${normalizedSub}${sep}project_id=${encodeURIComponent(agentaProjectId)}`;

    const bbRes = await fetch(targetUrl, {
      method,
      headers: {
        Authorization: authHeader,
        "Content-Type": "application/json",
      },
      body: body !== undefined && method !== "GET" ? JSON.stringify(body) : undefined,
    });

    const data = await bbRes.json().catch(async () => ({ detail: await bbRes.text().catch(() => "") }));
    return { status: bbRes.status, data };
  }

  /**
   * Resolves an Agenta specialist agent's workflow, latest revision, and active session,
   * then dispatches a background continuation turn to `/services/agent/v0/invoke`.
   */
  async dispatchAgentTurn(
    agentaProjectId: string,
    targetAgentIdOrRole: string,
    messageText: string,
    options?: {
      sessionId?: string;
      companyAgents?: Array<Partial<ResolvedAgentMeta>>;
      authContext?: {
        userId?: string;
        apiKey?: string;
        accessToken?: string;
      };
    }
  ): Promise<AgentTurnDispatchResult> {
    if (!agentaProjectId || !targetAgentIdOrRole || !messageText.trim()) {
      return { dispatched: false, error: "Missing projectId, targetAgent, or messageText" };
    }

    let activeAgents = options?.companyAgents;
    const liveFetched = await this.fetchLiveProjectAgents(
      agentaProjectId,
      options?.authContext
    );
    if (Array.isArray(liveFetched) && liveFetched.length > 0) {
      activeAgents = liveFetched;
    }

    const agentMeta = resolveAgentMetadata(targetAgentIdOrRole, activeAgents);
    if (!agentMeta || agentMeta.isEngineering || agentMeta.id === "engineering") {
      return {
        dispatched: false,
        error: `Target "${targetAgentIdOrRole}" is local engineering or not found in Agenta roster`,
      };
    }

    const workflowId =
      agentMeta.workflowId && isValidUuid(agentMeta.workflowId) && agentMeta.workflowId !== LOCAL_ENGINEERING_UUID
        ? agentMeta.workflowId
        : isValidUuid(targetAgentIdOrRole) && targetAgentIdOrRole !== LOCAL_ENGINEERING_UUID
        ? targetAgentIdOrRole
        : undefined;

    if (!workflowId) {
      return {
        dispatched: false,
        agentId: agentMeta.id,
        agentName: agentMeta.name,
        agentInitials: agentMeta.initials,
        error: `No Agenta workflowId available for agent "${agentMeta.name}"`,
      };
    }

    const validSessionRe = /^[a-zA-Z0-9_-]{1,128}$/;
    let sessionId =
      options?.sessionId && validSessionRe.test(options.sessionId.trim())
        ? options.sessionId.trim()
        : undefined;

    if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
      return {
        dispatched: true,
        agentId: agentMeta.id,
        agentName: agentMeta.name,
        agentInitials: agentMeta.initials,
        workflowId,
        sessionId: sessionId || `sess_${workflowId.slice(0, 8)}`,
        turnId: `turn_${Date.now()}`,
      };
    }

    const authHeader = await this.resolveProjectAuthHeader(
      agentaProjectId,
      options?.authContext
    );
    if (!authHeader) {
      return {
        dispatched: false,
        agentId: agentMeta.id,
        agentName: agentMeta.name,
        agentInitials: agentMeta.initials,
        workflowId,
        error: "No Agenta API key or session token available to invoke agent",
      };
    }

    const headers = {
      Authorization: authHeader,
      "Content-Type": "application/json",
    };

    // 1. Resolve latest workflow revision ID & variant ID
    let revisionId: string | undefined;
    let variantId: string | undefined;
    try {
      const revRes = await fetch(
        `${this.apiUrl}/workflows/revisions/query?project_id=${encodeURIComponent(agentaProjectId)}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            workflow_refs: [{ id: workflowId }],
            grouping: { by: "artifact", get: "latest" },
          }),
          signal: AbortSignal.timeout(3000),
        }
      );
      if (revRes.ok) {
        const revData = (await revRes.json()) as {
          workflow_revisions?: Array<{
            id?: string;
            workflow_variant_id?: string;
            variant_id?: string;
          }>;
        };
        const latest = revData.workflow_revisions?.[0];
        if (latest?.id && isValidUuid(latest.id)) {
          revisionId = latest.id;
        }
        const vId = latest?.workflow_variant_id || latest?.variant_id;
        if (vId && isValidUuid(vId)) {
          variantId = vId;
        }
      }
    } catch {}

    // 2. Resolve most recent session_id for this agent workflow if not explicitly provided
    if (!sessionId) {
      try {
        const sessRes = await fetch(
          `${this.apiUrl}/sessions/query?project_id=${encodeURIComponent(agentaProjectId)}`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({
              turn_references: [{ key: "workflow", id: workflowId }],
              include_ended: true,
              windowing: { limit: 1, order: "descending" },
            }),
            signal: AbortSignal.timeout(3000),
          }
        );
        if (sessRes.ok) {
          const sessData = (await sessRes.json()) as {
            sessions?: Array<{ session_id?: string }>;
          };
          const latestSessId = sessData.sessions?.[0]?.session_id;
          if (latestSessId && validSessionRe.test(latestSessId)) {
            sessionId = latestSessId;
          }
        }
      } catch {}
    }

    if (!sessionId) {
      sessionId = crypto.randomUUID();
    }

    // 3. Dispatch background turn via /services/agent/v0/invoke
    const invokeCandidates = Array.from(
      new Set([
        `${this.webUrl}/services/agent/v0/invoke`,
        `${this.apiUrl.replace(/\/api$/, "")}/services/agent/v0/invoke`,
      ])
    );

    const invokeBody = {
      session_id: sessionId,
      on_busy: "queue",
      flags: { detached: true },
      references: {
        application: { id: workflowId },
        workflow: { id: workflowId },
        ...(variantId
          ? {
              application_variant: { id: variantId },
              workflow_variant: { id: variantId },
            }
          : {}),
        ...(revisionId
          ? {
              application_revision: { id: revisionId },
              workflow_revision: { id: revisionId },
            }
          : {}),
      },
      data: {
        inputs: {
          messages: [
            {
              role: "user",
              content: messageText,
            },
          ],
        },
      },
    };

    let lastError = "Failed to reach Agenta agent invoke service";
    for (const baseInvokeUrl of invokeCandidates) {
      const url = `${baseInvokeUrl}?project_id=${encodeURIComponent(
        agentaProjectId
      )}&application_id=${encodeURIComponent(workflowId)}`;
      try {
        const invokeRes = await fetch(url, {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json",
            Accept: "text/event-stream",
            "Idempotency-Key": `crbn-turn-${crypto.randomUUID()}`,
          },
          body: JSON.stringify(invokeBody),
          signal: AbortSignal.timeout(6000),
        });

        if (invokeRes.status === 202) {
          logCompany(
            "Provisioner",
            `Queued turn for agent ${agentMeta.name} (${workflowId}) on busy session ${sessionId}`
          );
          return {
            dispatched: true,
            queued: true,
            agentId: agentMeta.id,
            agentName: agentMeta.name,
            agentInitials: agentMeta.initials,
            workflowId,
            revisionId,
            sessionId,
          };
        }

        if (invokeRes.ok) {
          let turnId: string | undefined;
          if (invokeRes.body) {
            const reader = invokeRes.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            try {
              const readDeadline = Date.now() + 3000;
              while (Date.now() < readDeadline) {
                const { done, value } = await reader.read();
                if (done) break;
                buffer += decoder.decode(value, { stream: true });
                if (buffer.includes("data:")) {
                  const match = buffer.match(/"turnId"\s*:\s*"([^"]+)"/);
                  if (match?.[1]) turnId = match[1];
                  break;
                }
              }
            } catch {} finally {
              reader.cancel().catch(() => {});
            }
          }
          logCompany(
            "Provisioner",
            `Dispatched detached turn to agent ${agentMeta.name} (${workflowId}) in session ${sessionId}`
          );
          return {
            dispatched: true,
            agentId: agentMeta.id,
            agentName: agentMeta.name,
            agentInitials: agentMeta.initials,
            workflowId,
            revisionId,
            sessionId,
            turnId,
          };
        }

        lastError = `HTTP ${invokeRes.status}: ${(await invokeRes.text().catch(() => "")).slice(0, 240)}`;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
      }
    }

    return {
      dispatched: false,
      agentId: agentMeta.id,
      agentName: agentMeta.name,
      agentInitials: agentMeta.initials,
      workflowId,
      revisionId,
      sessionId,
      error: lastError,
    };
  }
}

export const agentaProvisioner = new AgentaProvisioner();
