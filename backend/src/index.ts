import * as path from "node:path";
import { ProjectManager } from "./project-manager";
import { ModelsService, detectHardware } from "./models-service";
import { DevServerManager } from "./dev-server";
import { SessionBridge } from "./session-bridge";
import { ChatHistoryManager } from "./chat-history";

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
}

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
    if (url.pathname.startsWith("/api/projects/") && req.method === "DELETE") {
      const projectName = decodeURIComponent(url.pathname.replace("/api/projects/", ""));
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

      const processMessage = async () => {
        try {
          const text = typeof messageRaw === "string" ? messageRaw : new TextDecoder().decode(messageRaw);
          const data = JSON.parse(text) as Record<string, unknown>;
          const action = data.action as string | undefined;
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
            await bridge.openProject(project.path, modelName);

            ws.send(JSON.stringify({ type: "project_opened", project }));
            ws.send(
              JSON.stringify({
                type: "chat_history_loaded",
                project: project.name,
                messages: history.ui_events,
              }),
            );

            // Boot dev server for live preview
            devServerManager.startDevServer(project.path).catch(err => {
              console.error("[WebSocket] Failed to start dev server:", err);
            });
            return;
          }

        if (action === "stop_preview") {
          if (ws.data.activeProjectName) {
            const project = await projectManager.getProject(ws.data.activeProjectName);
            devServerManager.stopDevServer(project.path);
          }
          return;
        }

        if (action === "restart_preview") {
          if (ws.data.activeProjectName) {
            const project = await projectManager.getProject(ws.data.activeProjectName);
            await devServerManager.restartDevServer(project.path);
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

        if (action === "stop_agent") {
          await bridge.stop();
          return;
        }
        if (action === "list_checkpoints") {
          ws.send(JSON.stringify({ type: "checkpoint_timeline", steps: [], formatted: "No checkpoints yet." }));
          return;
        }

        // Interactive tool clarification response
        if (action === "tool_response" || action === "ask_response") {
          const requestId = (data.id || data.request_id || data.tool_call_id) as string;
          const response = data.response ?? data.answer ?? data.value;
          if (requestId) {
            bridge.resolveUiRequest(requestId, response);
          }
          return;
        }

        // Tool command approval / denial response
        if (action === "command_approval") {
          const requestId = (data.request_id || data.id || data.tool_call_id) as string;
          const approved = Boolean(data.approved);
          const choice = approved ? "Approve" : "Deny";
          if (requestId) {
            bridge.resolveUiRequest(requestId, choice);
          }
          return;
        }

        // Direct prompt invocation
        const promptText = (data.prompt as string)?.trim();
        if (promptText) {
          const modelName = data.model as string | undefined;
          if (modelName) {
            await bridge.setModel(modelName);
          }
          await bridge.prompt(promptText);
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
      ws.data.bridge?.dispose().catch(() => {});
    },
  },
});

console.log(`\n======================================================`);
console.log(`⚡ Lowkey OMP Bridge Server running on http://${HOST}:${PORT}`);
console.log(`🔌 WebSocket available at ws://${HOST}:${PORT}/ws`);
console.log(`======================================================\n`);
