import type { AgentTemplatePackage } from "./templates";
import { logCompany } from "./logger";
import { getCoreDb, getTokensDb } from "./db";

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

export interface AgentaProvisionResult {
  success: boolean;
  needsAuth?: boolean;
  agentaProjectId?: string;
  agentaWorkspaceId?: string;
  agentaUrl: string;
  error?: string;
}

interface WorkflowCreateResponse {
  workflow?: { id?: string };
}

interface VariantCreateResponse {
  workflow_variant?: { id?: string };
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
  async resolveActiveTenant(): Promise<{
    orgId: string;
    orgName: string;
    userId: string;
  } | null> {
    try {
      let activeUid: string | null = null;
      try {
        const dbTokens = getTokensDb();
        const rows = await dbTokens`SELECT user_id, expires_at FROM session_info 
          WHERE expires_at > (extract(epoch from now()) * 1000)::bigint 
          ORDER BY created_at_time DESC LIMIT 1`;
        if (rows[0]?.user_id && typeof rows[0].user_id === "string") {
          activeUid = rows[0].user_id;
          logCompany("Provisioner", "Found active SuperTokens user session:", { activeUid, expiresAt: rows[0].expires_at });
        } else {
          logCompany("Provisioner", "No active session in SuperTokens session_info (user is logged out).");
        }
      } catch (tokenErr) {
        logCompany("Provisioner", "Could not read session_info from Postgres:", tokenErr);
      }

      if (!activeUid) {
        return null;
      }
      const dbCore = getCoreDb();
      let tenant: { orgId: string; orgName: string; userId: string } | null = null;
      // Find user and organization (owner or member)
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
        logCompany("Provisioner", "Resolved tenant from organization membership:", tenant);
      } else {
        // Fallback: check organizations by owner_id
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
          logCompany("Provisioner", "Resolved tenant from organization owner_id fallback:", tenant);
        }
      }

      // Ensure the organization has an active default project (required by Agenta's project router)
      if (tenant) {
        const defaultCheck = await dbCore`SELECT id FROM projects 
          WHERE organization_id = ${tenant.orgId} AND is_default = true 
          LIMIT 1`;
        if (!defaultCheck || defaultCheck.length === 0) {
          // Check if any project exists in this org to promote to default
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
   * Provisions a dedicated Agenta project and populates the 5 baseline agents.
   */
  async provisionCompanyAgents(
    companyName: string,
    projectName: string,
    agents: AgentTemplatePackage[],
    projectDesc?: string
  ): Promise<AgentaProvisionResult> {
    const fallbackUrl = `${this.webUrl}/m?project=${encodeURIComponent(projectName)}`;

    if (process.env.NODE_ENV === "test" || process.env.BUN_ENV === "test") {
      return {
        success: true,
        agentaProjectId: "00000000-0000-0000-0000-000000000001",
        agentaWorkspaceId: "00000000-0000-0000-0000-000000000002",
        agentaUrl: `${this.webUrl}/m/w/00000000-0000-0000-0000-000000000002/p/00000000-0000-0000-0000-000000000001/agents`,
      };
    }
    try {
      const available = await this.isAgentaAvailable();
      if (!available) {
        return {
          success: false,
          agentaUrl: fallbackUrl,
          error: "Agenta API is not currently reachable",
        };
      }

      const tenant = await this.resolveActiveTenant();
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
      let providerSlug: string | undefined;
      const projectNameInAgenta = companyName;
      const existingAgentNames = new Set<string>();

      try {
        const dbCore = getCoreDb();

        // 1. Check all organizations this user belongs to
        const userOrgs = (await dbCore`SELECT o.id, o.name
          FROM organizations o
          JOIN organization_members om ON o.id = om.organization_id
          WHERE om.user_id = ${tenant.userId}
          ORDER BY om.created_at ASC`) as unknown as Array<{ id: string; name: string }>;

        const candidateOrgs = userOrgs && userOrgs.length > 0 ? userOrgs : [{ id: orgId, name: tenant.orgName }];

        // Check if project already exists in any of the user's organizations
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

        // 2. If project does not exist yet, create it via Agenta API
        if (!projId) {
          // Find or create default project in this org to acquire user API key for org context
          let defaultProjectId: string | undefined;
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

          let defaultKey: string | undefined;
          if (defaultProjectId) {
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
              defaultKey = keyData.accounts?.[0]?.api_keys?.key?.value;
            }
          }

          // Create project via standard Agenta endpoint (which auto-seeds environments, evaluators & project_members)
          if (defaultKey) {
            try {
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
            } catch (err) {
              console.warn("[AgentaProvisioner] Standard project create attempt:", err);
            }
          }

          // Fallback: Admin creation endpoint if standard create did not complete
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

        // 3. Ensure project has environments (development, staging, production) and project membership
        if (projId) {
          // Seed environments if missing
          const existingEnvs = await dbCore`SELECT slug FROM environment_artifacts WHERE project_id = ${projId}`;
          const envSlugs = new Set((existingEnvs || []).map((e) => String(e.slug)));
          for (const envName of ["development", "staging", "production"]) {
            if (!envSlugs.has(envName)) {
              await dbCore`INSERT INTO environment_artifacts (id, project_id, slug, name) 
                VALUES (gen_random_uuid(), ${projId}, ${envName}, ${envName}) 
                ON CONFLICT DO NOTHING`;
            }
          }

          // Ensure project_members row exists
          const existingMem = await dbCore`SELECT id FROM project_members WHERE project_id = ${projId} AND user_id = ${tenant.userId} LIMIT 1`;
          if (!existingMem || existingMem.length === 0) {
            await dbCore`INSERT INTO project_members (id, project_id, user_id, role, created_at, updated_at) 
              VALUES (gen_random_uuid(), ${projId}, ${tenant.userId}, 'owner', now(), now()) 
              ON CONFLICT DO NOTHING`;
          }

          // Check which agents already exist in this project to prevent duplicates
          const existingArtifacts = await dbCore`SELECT name, slug FROM workflow_artifacts WHERE project_id = ${projId}`;
          if (existingArtifacts) {
            for (const row of existingArtifacts) {
              if (row.name) existingAgentNames.add(String(row.name).toLowerCase().trim());
              if (row.slug) existingAgentNames.add(String(row.slug).toLowerCase().trim());
            }
          }

          // 4. Fetch or create a project-scoped API key for agent provisioning
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

          // 5. Discover active LLM provider key connection slug in user's organization
          try {
            const secretRows = await dbCore`SELECT slug FROM secrets 
              WHERE (availability = 'all_projects' OR organization_id = ${orgId} OR project_id IN (SELECT id FROM projects WHERE organization_id = ${orgId}))
                AND kind = 'PROVIDER_KEY' 
              ORDER BY created_at DESC LIMIT 1`;
            if (secretRows && secretRows.length > 0 && secretRows[0]?.slug) {
              providerSlug = String(secretRows[0].slug);
            }
          } catch {}
        }

      } catch (err) {
        console.warn("[AgentaProvisioner] Error handling project in user organization:", err);
      }

      if (!projId || !apiKey) {
        return {
          success: false,
          agentaUrl: fallbackUrl,
          error: "Failed to resolve project or API key in user organization",
        };
      }

      const userHeaders = {
        Authorization: `ApiKey ${apiKey}`,
        "Content-Type": "application/json",
      };

      // 5. Provision missing baseline agents using Agenta native templates in parallel
      const agentsToCreate = agents.filter(
        (agent) =>
          !existingAgentNames.has(agent.name.toLowerCase().trim()) &&
          !existingAgentNames.has(agent.id.toLowerCase().trim())
      );

      await Promise.allSettled(
        agentsToCreate.map(async (agent) => {
          const prompt = agent.instructionsPrompt(companyName, projectDesc);
          let loadedViaTemplate = false;

          // Try loading Agenta's native built-in template package
          if (agent.templateKey) {
            try {
              const tplRes = await fetch(`${this.apiUrl}/agent-templates/load?project_id=${projId}`, {
                method: "POST",
                headers: {
                  ...userHeaders,
                  "Idempotency-Key": `tpl-load-${projId}-${agent.id}`,
                },
                body: JSON.stringify({
                  source: { kind: "internal", key: agent.templateKey },
                  base_revision: {
                    uri: "agenta:builtin:agent:v0",
                    parameters: {
                      agent: {
                        instructions: {
                          agents_md: prompt,
                        },
                        llm: {
                          provider: "gemini",
                          model: agent.model || "gemini/gemini-2.5-flash",
                          ...(providerSlug ? { connection: { mode: "agenta", slug: providerSlug } } : {}),
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
                        type: "object",
                        properties: {
                          messages: { type: "array" },
                        },
                      },
                    },
                  },
                  initial_message: `Hello! I am the ${agent.name} for ${companyName}. How can I assist you today?`,
                }),
              });
              if (tplRes.ok) {
                loadedViaTemplate = true;
                const tplData = (await tplRes.json()) as { workflow_id?: string; variant_id?: string };
                const workflowId = tplData.workflow_id;
                const variantId = tplData.variant_id;

                // Set human-friendly department name and commit company-specific prompt on top of template
                if (workflowId && variantId) {
                  try {
                    const dbLocal = getCoreDb();
                    await dbLocal`UPDATE workflow_artifacts SET name = ${agent.name} WHERE id = ${workflowId}`;
                    await dbLocal.close();

                    const queryRes = await fetch(`${this.apiUrl}/workflows/revisions/query?project_id=${projId}`, {
                      method: "POST",
                      headers: userHeaders,
                      body: JSON.stringify({
                        workflow_refs: [{ id: workflowId }],
                        grouping: { by: "artifact", get: "latest" },
                      }),
                    });
                    if (queryRes.ok) {
                      const qData = (await queryRes.json()) as {
                        workflow_revisions?: Array<{
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
                      if (latestRev?.data?.parameters?.agent) {
                        const newParams = { ...latestRev.data.parameters };
                        newParams.agent = {
                          ...newParams.agent,
                          instructions: { agents_md: prompt },
                        };
                        await fetch(`${this.apiUrl}/workflows/revisions/commit?project_id=${projId}`, {
                          method: "POST",
                          headers: userHeaders,
                          body: JSON.stringify({
                            workflow_revision: {
                              workflow_id: workflowId,
                              workflow_variant_id: variantId,
                              slug: randSlug(12),
                              name: "default",
                              data: {
                                ...latestRev.data,
                                parameters: newParams,
                              },
                              message: "Configure company instructions",
                            },
                          }),
                        });
                      }
                    }
                  } catch (updateErr) {
                    console.warn(`[AgentaProvisioner] Could not update prompt on ${agent.name}:`, updateErr);
                  }
                }
              }
            } catch (tplErr) {
              console.warn(`[AgentaProvisioner] Template load attempt for ${agent.templateKey}:`, tplErr);
            }
          }

          // Fallback: Direct workflow creation if template endpoint did not complete
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
              const workflowId = wfData.workflow?.id;
              if (!workflowId) return;

              // Step 2: Create default variant
              const varSlug = `${uniqueSlug}.default`;
              const varRes = await fetch(`${this.apiUrl}/workflows/variants/?project_id=${projId}`, {
                method: "POST",
                headers: userHeaders,
                body: JSON.stringify({
                  workflow_variant: {
                    workflow_id: workflowId,
                    slug: varSlug,
                    name: "default",
                  },
                }),
              });
              const varData = (await varRes.json()) as VariantCreateResponse;
              const variantId = varData.workflow_variant?.id;
              if (!variantId) return;

              // Step 3: Commit seed revision (v0)
              await fetch(`${this.apiUrl}/workflows/revisions/commit?project_id=${projId}`, {
                method: "POST",
                headers: userHeaders,
                body: JSON.stringify({
                  workflow_revision: {
                    workflow_id: workflowId,
                    workflow_variant_id: variantId,
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
                    workflow_id: workflowId,
                    workflow_variant_id: variantId,
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
                            provider: "gemini",
                            model: agent.model || "gemini/gemini-2.5-flash",
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
                              description: "Conversation history",
                            },
                          },
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
            } catch (err) {
              console.warn(`[AgentaProvisioner] Error provisioning fallback agent ${agent.name}:`, err);
            }
          }
        })
      );

      const agentaDashboardUrl = orgId
        ? `${this.webUrl}/m/w/${orgId}/p/${projId}/agents`
        : `${this.webUrl}/m?project=${projId}`;

      return {
        success: true,
        agentaProjectId: projId,
        agentaWorkspaceId: orgId,
        agentaUrl: agentaDashboardUrl,
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
}

export const agentaProvisioner = new AgentaProvisioner();
