import * as path from "node:path";
import { ProjectManager } from "./project-manager";
import { ModelsService, detectHardware } from "./models-service";
import { DevServerManager } from "./dev-server";
import { SessionBridge } from "./session-bridge";
import { ChatHistoryManager } from "./chat-history";
import { CheckpointManager } from "./checkpoint-manager";

const PORT = Number(process.env.BACKEND_PORT || process.env.PORT || 8000);
const HOST = process.env.BACKEND_HOST || "127.0.0.1";

const projectManager = new ProjectManager();
const modelsService = new ModelsService();
const devServerManager = new DevServerManager();

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

interface WsData {
  bridge?: SessionBridge;
  activeProjectName?: string;
  unsubscribeDevServer?: () => void;
  messageQueue?: Promise<void>;
  send?: (msg: Record<string, unknown>) => void;
}

const activeSockets = new Set<(msg: Record<string, unknown>) => void>();

// Broadcast OAuth session state changes in real-time to all connected frontend clients
modelsService.oauthManager.onSessionUpdate((session) => {
  const payload = { type: "oauth_update", session };
  for (const send of activeSockets) {
    send(payload);
  }
});

const _server = Bun.serve<WsData>({
  port: PORT,
  hostname: HOST,

  async fetch(req, srv) {
    const url = new URL(req.url);

    // Handle CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      const upgraded = srv.upgrade(req, { data: {} });
      if (upgraded) return undefined;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // ──────────────────────────────────────────────
    // REST API Routes
    // ──────────────────────────────────────────────

    // System & Models Catalog
    if (url.pathname === "/api/system/models-and-hardware" && req.method === "GET") {
      const hw = detectHardware();
      const catalog = await modelsService.getModelCatalog(hw);
      return Response.json(
        {
          hardware: hw,
          providers: catalog.providers,
          models: catalog.models,
          active_model: catalog.active_model,
          total_models: catalog.total_models,
          ollama_running: catalog.ollama_running,
        },
        { headers: CORS_HEADERS },
      );
    }
    // Auth: Save API Key
    if (url.pathname === "/api/auth/api-key" && req.method === "POST") {
      try {
        const body = (await req.json()) as { provider?: string; api_key?: string };
        if (!body.provider || !body.api_key) {
          return Response.json(
            { detail: "Provider and api_key are required" },
            { status: 400, headers: CORS_HEADERS },
          );
        }
        await modelsService.saveApiKey(body.provider, body.api_key);
        return Response.json({ status: "ok", provider: body.provider }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Auth: Delete API Key
    if (url.pathname.startsWith("/api/auth/api-key/") && req.method === "DELETE") {
      const provider = decodeURIComponent(url.pathname.replace("/api/auth/api-key/", ""));
      try {
        await modelsService.removeApiKey(provider);
        return Response.json({ status: "deleted", provider }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }
    // Auth: List OAuth Providers
    if (url.pathname === "/api/auth/oauth/providers" && req.method === "GET") {
      const providers = modelsService.oauthManager.getOAuthProviders();
      return Response.json(providers, { headers: CORS_HEADERS });
    }

    // Auth: Start OAuth Sign-in Flow
    if (url.pathname === "/api/auth/oauth/start" && req.method === "POST") {
      try {
        const body = (await req.json()) as { provider?: string; projectId?: string };
        if (!body.provider) {
          return Response.json({ detail: "Provider is required" }, { status: 400, headers: CORS_HEADERS });
        }
        const session = await modelsService.oauthManager.startLogin(
          body.provider,
          undefined,
          { projectId: body.projectId },
        );
        return Response.json(session, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Auth: Check OAuth Sign-in Status
    if (url.pathname.startsWith("/api/auth/oauth/status/") && req.method === "GET") {
      const provider = decodeURIComponent(url.pathname.replace("/api/auth/oauth/status/", ""));
      const session = modelsService.oauthManager.getSession(provider);
      return Response.json({ session }, { headers: CORS_HEADERS });
    }

    // Auth: Cancel in-flight OAuth Sign-in
    if (url.pathname === "/api/auth/oauth/cancel" && req.method === "POST") {
      try {
        const body = (await req.json()) as { provider?: string };
        if (!body.provider) {
          return Response.json({ detail: "Provider is required" }, { status: 400, headers: CORS_HEADERS });
        }
        const cancelled = modelsService.oauthManager.cancelSession(body.provider);
        return Response.json({ status: cancelled ? "cancelled" : "not_found", provider: body.provider }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Auth: Log out of OAuth / Credentialed Provider
    if (url.pathname.startsWith("/api/auth/oauth/") && req.method === "DELETE") {
      const provider = decodeURIComponent(url.pathname.replace("/api/auth/oauth/", ""));
      try {
        await modelsService.oauthManager.logout(provider);
        await modelsService.removeApiKey(provider);
        return Response.json({ status: "logged_out", provider }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: List
    if (url.pathname === "/api/projects" && req.method === "GET") {
      const projects = await projectManager.listProjects();
      return Response.json(projects, { headers: CORS_HEADERS });
    }

    // Projects: Suggest Name
    if (url.pathname === "/api/projects/suggest-name" && req.method === "GET") {
      const base = url.searchParams.get("base") || "app";
      return Response.json(
        { suggested_name: projectManager.suggestName(base) },
        { headers: CORS_HEADERS },
      );
    }

    // Projects: Create
    if (url.pathname === "/api/projects" && req.method === "POST") {
      try {
        const body = (await req.json()) as { name?: string; template?: string; model?: string };
        if (!body.name) {
          return Response.json({ detail: "Project name is required" }, { status: 400, headers: CORS_HEADERS });
        }
        const project = await projectManager.createProject(body.name, body.template || "node_react", body.model);
        return Response.json(project, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Delete
    if (url.pathname.match(/^\/api\/projects\/[^/]+$/) && req.method === "DELETE") {
      const projectName = decodeURIComponent(url.pathname.split("/")[3]);
      try {
        const project = await projectManager.getProject(projectName).catch(() => null);
        if (project) {
          devServerManager.stopDevServer(project.path);
        }
        await projectManager.deleteProject(projectName);
        return Response.json({ status: "deleted" }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 404, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Open in Finder
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/open-in-finder$/) && req.method === "POST") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        await projectManager.openInFinder(projectName);
        return Response.json({ status: "opened" }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 404, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Chat History
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/chat$/) && req.method === "GET") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        const project = await projectManager.getProject(projectName);
        const history = await ChatHistoryManager.loadHistory(project.path);
        return Response.json(
          { history, ui_events: history.ui_events },
          { headers: CORS_HEADERS },
        );
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 404, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Checkpoints Timeline
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/checkpoints$/) && req.method === "GET") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        const project = await projectManager.getProject(projectName);
        const steps = await CheckpointManager.getCheckpoints(project.path);
        return Response.json({ steps }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 404, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: List Branches
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/branches$/) && req.method === "GET") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        const project = await projectManager.getProject(projectName);
        const branchState = await CheckpointManager.getBranches(project.path);
        return Response.json(branchState, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Branch Tree Graph
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/branch-tree$/) && req.method === "GET") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        const project = await projectManager.getProject(projectName);
        const tree = await CheckpointManager.getBranchTree(project.path);
        return Response.json(tree, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Create Branch
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/branches$/) && req.method === "POST") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        const project = await projectManager.getProject(projectName);
        const body = (await req.json()) as { branch_name?: string; from_step_id?: string };
        if (!body.branch_name || !body.from_step_id) {
          return Response.json({ detail: "branch_name and from_step_id are required" }, { status: 400, headers: CORS_HEADERS });
        }
        const branch = await CheckpointManager.createBranch(project.path, body.branch_name, body.from_step_id);
        return Response.json(branch, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Switch Branch
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/branches\/switch$/) && req.method === "POST") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        const project = await projectManager.getProject(projectName);
        const body = (await req.json()) as { branch_name?: string };
        if (!body.branch_name) {
          return Response.json({ detail: "branch_name is required" }, { status: 400, headers: CORS_HEADERS });
        }
        const branch = await CheckpointManager.switchBranch(project.path, body.branch_name);
        return Response.json(branch, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Delete Branch
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/branches\/[^/]+$/) && req.method === "DELETE") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      const branchName = decodeURIComponent(parts[5]);
      try {
        const project = await projectManager.getProject(projectName);
        await CheckpointManager.deleteBranch(project.path, branchName);
        return Response.json({ status: "deleted", branch: branchName }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Rewind to Step
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/rewind$/) && req.method === "POST") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        const project = await projectManager.getProject(projectName);
        const body = (await req.json()) as { step_id?: string; mode?: "code_and_messages" | "messages_only" };
        if (!body.step_id) {
          return Response.json({ detail: "step_id is required" }, { status: 400, headers: CORS_HEADERS });
        }
        const rollbackCode = body.mode !== "messages_only";
        const result = await CheckpointManager.rewindToStep(project.path, body.step_id, { rollbackCode });
        const prunedEvents = await ChatHistoryManager.pruneHistoryAfter(
          project.path,
          body.step_id,
          result.targetStep.timestamp,
        );
        return Response.json(
          { status: "ok", result, remainingMessages: prunedEvents.length },
          { headers: CORS_HEADERS },
        );
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: File Tree
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/tree$/) && req.method === "GET") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        const tree = await projectManager.getFileTree(projectName);
        return Response.json({ tree }, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Read File Content
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/file$/) && req.method === "GET") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      const filePath = url.searchParams.get("path");
      if (!filePath) {
        return Response.json({ detail: "Query parameter 'path' is required" }, { status: 400, headers: CORS_HEADERS });
      }
      try {
        const file = await projectManager.readFile(projectName, filePath);
        return Response.json(file, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Save File Content
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/file$/) && req.method === "PUT") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        const body = (await req.json()) as { path?: string; content?: string };
        if (!body.path || typeof body.content !== "string") {
          return Response.json({ detail: "Both 'path' and 'content' are required" }, { status: 400, headers: CORS_HEADERS });
        }
        const result = await projectManager.writeFile(projectName, body.path, body.content);
        const now = Date.now();
        for (const send of activeSockets) {
          send({ type: "file_changed", file: body.path, timestamp: now });
        }
        return Response.json(result, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Create File or Directory
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/file$/) && req.method === "POST") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        const body = (await req.json()) as { path?: string; type?: "file" | "directory" };
        if (!body.path) {
          return Response.json({ detail: "'path' is required" }, { status: 400, headers: CORS_HEADERS });
        }
        const result = await projectManager.createFileOrDir(projectName, body.path, body.type || "file");
        const now = Date.now();
        for (const send of activeSockets) {
          send({ type: "file_changed", file: body.path, timestamp: now });
        }
        return Response.json(result, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    // Projects: Delete File or Directory
    if (url.pathname.match(/^\/api\/projects\/[^/]+\/file$/) && req.method === "DELETE") {
      const parts = url.pathname.split("/");
      const projectName = decodeURIComponent(parts[3]);
      try {
        let filePath = url.searchParams.get("path");
        if (!filePath) {
          const body = (await req.json().catch(() => ({}))) as { path?: string };
          filePath = body.path || null;
        }
        if (!filePath) {
          return Response.json({ detail: "'path' is required" }, { status: 400, headers: CORS_HEADERS });
        }
        const result = await projectManager.deleteFileOrDir(projectName, filePath);
        const now = Date.now();
        for (const send of activeSockets) {
          send({ type: "file_changed", file: filePath, timestamp: now });
        }
        return Response.json(result, { headers: CORS_HEADERS });
      } catch (err) {
        return Response.json(
          { detail: err instanceof Error ? err.message : String(err) },
          { status: 400, headers: CORS_HEADERS },
        );
      }
    }

    return new Response("Not Found", { status: 404, headers: CORS_HEADERS });
  },

  websocket: {
    open(ws) {
      console.log("[WebSocket] Client connected");
      ws.data.messageQueue = Promise.resolve();

      const send = (msg: Record<string, unknown>) => {
        try {
          ws.send(JSON.stringify(msg));
        } catch {
          // Socket may have closed
        }
      };

      ws.data.send = send;
      activeSockets.add(send);
      const bridge = new SessionBridge(send, modelsService, devServerManager);
      ws.data.bridge = bridge;

      // Forward dev server events to frontend only for this connection's project
      const unsubscribe = devServerManager.onEvent(event => {
        if (event.project_path && ws.data.activeProjectName) {
          const eventProject = path.basename(event.project_path);
          if (eventProject !== ws.data.activeProjectName) {
            return;
          }
        }
        send(event);
      });
      ws.data.unsubscribeDevServer = unsubscribe;

      // Send initial context telemetry
      send({
        type: "context_telemetry",
        telemetry: {
          context_window: 1_000_000,
          total_tokens: 0,
          usage_pct: 0,
          compact_threshold_pct: 80,
          squash_threshold_pct: 70,
          status: "normal",
        },
      });
    },
    message(ws, messageRaw) {
      const bridge = ws.data.bridge;
      if (!bridge) return;
      const send = ws.data.send || ((msg: Record<string, unknown>) => {
        try {
          ws.send(JSON.stringify(msg));
        } catch {}
      });
      let data: Record<string, unknown>;
      try {
        const text = typeof messageRaw === "string" ? messageRaw : new TextDecoder().decode(messageRaw);
        data = JSON.parse(text) as Record<string, unknown>;
      } catch (err) {
        console.error("[WebSocket] Failed to parse message JSON:", err);
        return;
      }

      const action = data.action as string | undefined;

      // Immediate out-of-band control actions:
      // Must NEVER be queued behind long-running prompt execution (prevents deadlock).
      if (action === "stop_agent") {
        bridge.stop().catch(err => {
          console.error("[WebSocket] Error stopping agent:", err);
        });
        return;
      }

      if (action === "tool_response" || action === "ask_response") {
        const requestId = (data.id || data.request_id || data.tool_call_id) as string;
        const response = data.response ?? data.answer ?? data.value;
        if (requestId) {
          bridge.resolveUiRequest(requestId, response);
        }
        return;
      }

      if (action === "command_approval") {
        const requestId = (data.request_id || data.id || data.tool_call_id) as string;
        const approved = Boolean(data.approved);
        const choice = approved ? "Approve" : "Deny";
        if (requestId) {
          bridge.resolveUiRequest(requestId, choice);
        }
        return;
      }

      if (action === "stop_preview") {
        if (ws.data.activeProjectName) {
          projectManager.getProject(ws.data.activeProjectName).then(project => {
            devServerManager.stopDevServer(project.path);
          }).catch(() => {});
        }
        return;
      }

      if (action === "create_branch") {
        const branchName = (data.branch_name || data.name) as string;
        const fromStepId = (data.from_step_id || data.step_id) as string;
        if (branchName && fromStepId) {
          bridge.createBranch(branchName, fromStepId).catch(err => {
            console.error("[WebSocket] Error creating branch:", err);
            send({ type: "error", message: err instanceof Error ? err.message : String(err) });
          });
        }
        return;
      }

      if (action === "switch_branch") {
        const branchName = (data.branch_name || data.name) as string;
        if (branchName) {
          bridge.switchBranch(branchName).catch(err => {
            console.error("[WebSocket] Error switching branch:", err);
            send({ type: "error", message: err instanceof Error ? err.message : String(err) });
          });
        }
        return;
      }

      if (action === "delete_branch") {
        const branchName = (data.branch_name || data.name) as string;
        if (branchName) {
          bridge.deleteBranch(branchName).catch(err => {
            console.error("[WebSocket] Error deleting branch:", err);
            send({ type: "error", message: err instanceof Error ? err.message : String(err) });
          });
        }
        return;
      }

      const processMessage = async () => {
        try {
          if (action === "open_project") {
            const projectName = (data.name as string) || "default";
            const previousProject = ws.data.activeProjectName;
            ws.data.activeProjectName = projectName;

            // Stop previous project's dev server if switching projects
            if (previousProject && previousProject !== projectName) {
              try {
                const prevProj = await projectManager.getProject(previousProject);
                devServerManager.stopDevServer(prevProj.path);
              } catch {}
            }

            const project = await projectManager.getOrCreateProject(projectName, data.model as string | undefined);
            const history = await ChatHistoryManager.loadHistory(project.path);

            // Prefer explicit model > project persisted model > bridge active model
            const modelName = (data.model as string | undefined) || project.model || bridge.getActiveModel();
            if (!project.model && modelName) {
              project.model = modelName;
              projectManager.saveMeta(project).catch(() => {});
            }
            // 1. Boot dev server for live preview FIRST so port is allocated & known
            const devServer = await devServerManager.startDevServer(project.path).catch(err => {
              console.error("[WebSocket] Failed to start dev server:", err);
              return null;
            });
            if (devServer) {
              project.port = devServer.port;
              project.status = "running";
              projectManager.saveMeta(project).catch(() => {});
            }

            // 2. Open project session (now devServerManager.getServerInfo has the real port & url)
            await bridge.openProject(project.path, modelName);

            ws.send(JSON.stringify({ type: "project_opened", project }));
            ws.send(
              JSON.stringify({
                type: "chat_history_loaded",
                project: project.name,
                messages: history.ui_events,
              }),
            );
            return;
          }


        if (action === "restart_preview") {
          if (ws.data.activeProjectName) {
            const project = await projectManager.getProject(ws.data.activeProjectName);
            const newInfo = await devServerManager.restartDevServer(project.path);
            if (newInfo) {
              project.port = newInfo.port;
              project.status = "running";
              projectManager.saveMeta(project).catch(() => {});
            }
          }
          return;
        }
        if (action === "close_project") {
          await bridge.stop();
          return;
        }

        if (action === "clear") {
          await bridge.clear();
          return;
        }

        if (action === "set_model") {
          const model = data.model as string | undefined;
          if (model) {
            await bridge.setModel(model);
            if (ws.data.activeProjectName) {
              projectManager.updateMeta(ws.data.activeProjectName, { model }).catch(() => {});
            }
          }
          return;
        }

        if (action === "list_checkpoints") {
          if (ws.data.activeProjectName) {
            const project = await projectManager.getProject(ws.data.activeProjectName).catch(() => null);
            if (project) {
              const steps = await CheckpointManager.getCheckpoints(project.path);
              ws.send(JSON.stringify({ type: "checkpoint_timeline", steps }));
            }
          }
          return;
        }

        if (action === "rewind_to_step") {
          const stepId = (data.step_id || data.stepId) as string;
          const mode = (data.mode || "code_and_messages") as "code_and_messages" | "messages_only";
          if (stepId && bridge) {
            await bridge.rewindToStep(stepId, mode);
          }
          return;
        }

        // Direct prompt invocation with optional media/files
        const promptText = (data.prompt as string)?.trim() || "";
        const rawImages = Array.isArray(data.images) ? (data.images as unknown[]) : [];
        const rawFiles = Array.isArray(data.files) ? (data.files as unknown[]) : [];

        const images = rawImages.filter(
          (item): item is { data: string; mimeType: string } => {
            return (
              Boolean(item) &&
              typeof item === "object" &&
              "data" in item &&
              typeof item.data === "string" &&
              "mimeType" in item &&
              typeof item.mimeType === "string"
            );
          }
        );

        const files = rawFiles.filter(
          (item): item is { name: string; content: string; mimeType?: string; size?: number } => {
            return (
              Boolean(item) &&
              typeof item === "object" &&
              "name" in item &&
              typeof item.name === "string" &&
              "content" in item &&
              typeof item.content === "string"
            );
          }
        );

        if (promptText || images.length > 0 || files.length > 0) {
          const modelName = data.model as string | undefined;
          if (modelName) {
            await bridge.setModel(modelName);
          }
          await bridge.prompt(promptText, {
            images: images.length > 0 ? images : undefined,
            files: files.length > 0 ? files : undefined,
          });
        }
        } catch (err) {
          console.error("[WebSocket] Error processing message:", err);
          ws.send(JSON.stringify({ type: "error", content: String(err) }));
        }
      };

      // Execute sequentially in FIFO order on this connection's queue
      ws.data.messageQueue = (ws.data.messageQueue ?? Promise.resolve())
        .then(processMessage)
        .catch(err => {
          console.error("[WebSocket] Uncaught queue error:", err);
        });
    },
    close(ws) {
      console.log("[WebSocket] Client disconnected");
      ws.data.unsubscribeDevServer?.();
      if (ws.data.send) {
        activeSockets.delete(ws.data.send);
      }
      ws.data.bridge?.dispose().catch(() => {});
    },
  },
});

console.log(`\n======================================================`);
console.log(`⚡ 80degrees OMP Bridge Server running on http://${HOST}:${PORT}`);
console.log(`🔌 WebSocket available at ws://${HOST}:${PORT}/ws`);
console.log(`======================================================\n`);
