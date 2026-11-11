import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server, Subprocess } from "bun";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

interface TodoTask {
  content: string;
  status: string;
  blocker?: string;
}

interface TodoPhase {
  name: string;
  tasks: TodoTask[];
}

function findFreePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const srv = net.createServer();
  srv.once("error", reject);
  srv.once("listening", () => {
    const address = srv.address();
    const port = typeof address === "object" && address ? address.port : 0;
    srv.close(() => resolve(port));
  });
  srv.listen(0, "127.0.0.1");
  return promise;
}

function sseResponse(chunks: Array<Record<string, unknown>>): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      }
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    },
  });
}

function toolCallChunk(turnId: number, toolName: string, args: Record<string, unknown>) {
  return [
    {
      id: `chatcmpl-todo-${turnId}`,
      object: "chat.completion.chunk",
      model: "todo-test-model",
      choices: [
        {
          index: 0,
          delta: {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: `call_todo_${turnId}`,
                type: "function",
                function: { name: toolName, arguments: JSON.stringify(args) },
              },
            ],
          },
          finish_reason: null,
        },
      ],
    },
    {
      id: `chatcmpl-todo-${turnId}`,
      object: "chat.completion.chunk",
      model: "todo-test-model",
      choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
    },
  ];
}

describe("Todo live state pipeline over WebSocket + SessionBridge + TodoTool", () => {
  let tempRoot = "";
  let tempAgentDir = "";
  let projDir = "";
  let backendProc: Subprocess | null = null;
  let backendPort = 0;

  let mockLlmServer: Server<unknown> | null = null;
  let mockLlmPort = 0;
  let turnCount = 0;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crbn-todo-flow-"));
    tempAgentDir = path.join(tempRoot, "agent");
    projDir = path.join(tempRoot, "project");
    await fs.mkdir(tempAgentDir, { recursive: true });
    await fs.mkdir(projDir, { recursive: true });
    await fs.writeFile(path.join(projDir, "package.json"), JSON.stringify({ name: "todo-test-proj" }));

    mockLlmPort = await findFreePort();
    mockLlmServer = Bun.serve({
      port: mockLlmPort,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/models") {
          return Response.json({
            object: "list",
            data: [{ id: "todo-test-model", max_model_len: 128000 }],
          });
        }
        if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
          const body = (await req.json()) as {
            messages?: Array<{ role?: string; content?: unknown }>;
          };
          turnCount += 1;
          const toolCount = (body.messages ?? []).filter((m) => m.role === "tool").length;

          if (toolCount === 0) {
            return sseResponse(
              toolCallChunk(turnCount, "todo", {
                op: "init",
                list: [
                  { phase: "Setup", items: ["Create schema", "Wire API"] },
                  { phase: "UI", items: ["Build view"] },
                ],
              }),
            );
          }
          if (toolCount === 1) {
            return sseResponse(
              toolCallChunk(turnCount, "todo", {
                op: "done",
                task: "Create schema",
              }),
            );
          }
          if (toolCount === 2) {
            return sseResponse(
              toolCallChunk(turnCount, "todo", {
                op: "block",
                task: "Build view",
                reason: "Waiting on schema review",
              }),
            );
          }
          if (toolCount === 3) {
            return sseResponse(
              toolCallChunk(turnCount, "todo", {
                op: "done",
                task: "Nonexistent task",
              }),
            );
          }
          if (toolCount === 4) {
            return sseResponse(
              toolCallChunk(turnCount, "todo", {
                op: "view",
              }),
            );
          }
          if (toolCount === 5) {
            return sseResponse(
              toolCallChunk(turnCount, "todo", {
                op: "done",
                task: "Wire API",
              }),
            );
          }

          return sseResponse([
            {
              id: "chatcmpl-todo-done",
              object: "chat.completion.chunk",
              model: "todo-test-model",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "Actionable tasks complete." },
                  finish_reason: null,
                },
              ],
            },
            {
              id: "chatcmpl-todo-done",
              object: "chat.completion.chunk",
              model: "todo-test-model",
              choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            },
          ]);
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    backendPort = await findFreePort();
    const backendDir = path.resolve(__dirname, "..");
    backendProc = Bun.spawn(["bun", "run", path.join(backendDir, "src/index.ts")], {
      cwd: backendDir,
      env: {
        ...(process.env as Record<string, string>),
        PORT: String(backendPort),
        BACKEND_PORT: String(backendPort),
        HOST: "127.0.0.1",
        HOME: tempRoot,
        PI_CODING_AGENT_DIR: tempAgentDir,
      },
      stdout: "ignore",
      stderr: "inherit",
    });

    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${backendPort}/healthz`, { signal: AbortSignal.timeout(500) });
        if (res.ok) break;
      } catch {}
      await Bun.sleep(100);
    }

    const saveRes = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "TodoMock",
        baseUrl: `http://127.0.0.1:${mockLlmPort}/v1`,
        format: "openai",
        modelId: "todo-test-model",
      }),
    });
    expect(saveRes.status).toBe(200);
  }, 30_000);

  afterAll(async () => {
    if (backendProc) {
      try {
        backendProc.kill();
      } catch {}
      backendProc = null;
    }
    mockLlmServer?.stop(true);
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  function connectWs() {
    const ws = new WebSocket(`ws://127.0.0.1:${backendPort}/ws`);
    const events: Array<Record<string, unknown>> = [];

    const waitForEvent = (
      predicate: (ev: Record<string, unknown>) => boolean,
      timeoutMs = 15_000,
    ): Promise<Record<string, unknown>> => {
      const existing = events.find(predicate);
      if (existing) return Promise.resolve(existing);
      const { promise, resolve, reject } = Promise.withResolvers<Record<string, unknown>>();
      const timer = setTimeout(() => {
        ws.removeEventListener("message", onMsg);
        reject(new Error("Timed out waiting for WS event"));
      }, timeoutMs);
      const onMsg = (evt: MessageEvent) => {
        try {
          const data = JSON.parse(String(evt.data)) as Record<string, unknown>;
          if (predicate(data)) {
            clearTimeout(timer);
            ws.removeEventListener("message", onMsg);
            resolve(data);
          }
        } catch {}
      };
      ws.addEventListener("message", onMsg);
      return promise;
    };

    ws.addEventListener("message", (evt) => {
      try {
        events.push(JSON.parse(String(evt.data)) as Record<string, unknown>);
      } catch {}
    });

    const openReady = new Promise<void>((resolve, reject) => {
      ws.addEventListener("open", () => resolve(), { once: true });
      ws.addEventListener("error", (e) => reject(e), { once: true });
    });

    return { ws, events, waitForEvent, openReady };
  }

  it("emits canonical TodoPhase[] on mutating tool_execution_end, ignores errors/views, and syncs across session switches and reconnect", async () => {
    const impRes = await fetch(`http://127.0.0.1:${backendPort}/api/projects/import-local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projDir }),
    });
    const impBody = (await impRes.json()) as { name: string };
    expect(impRes.status).toBe(200);

    const conn1 = connectWs();
    await conn1.openReady;

    conn1.ws.send(
      JSON.stringify({
        action: "open_project",
        name: impBody.name,
        model: "custom-todomock/todo-test-model",
      }),
    );
    const opened = await conn1.waitForEvent((e) => e.type === "project_opened");
    const firstSessionId = opened.activeSessionId as string;
    expect(typeof firstSessionId).toBe("string");

    // Initial empty sync on project open
    const initialTodoSync = await conn1.waitForEvent((e) => e.type === "todo_update");
    expect(initialTodoSync.phases).toEqual([]);

    conn1.events.length = 0;
    conn1.ws.send(JSON.stringify({ action: "prompt", prompt: "Plan and execute tasks" }));

    await conn1.waitForEvent((e) => e.type === "status" && e.content === "Done", 20_000);

    const todoUpdates = conn1.events.filter((e) => e.type === "todo_update");
    const todoResults = conn1.events
      .filter((e) => e.type === "tool_result" && e.name === "todo")
      .map((e) => ({ is_error: e.is_error, op: (e.arguments as Record<string, unknown>)?.op, content: (e.result as { content?: Array<{ text?: string }> })?.content?.[0]?.text }));
    expect(todoResults.length).toBe(6);
    expect(todoUpdates.map((u) => u.op)).toEqual(["init", "done", "block", "done"]);

    // 1. init: canonical phases with normalized in_progress on first task
    const initPhases = todoUpdates[0]?.phases as TodoPhase[];
    expect(todoUpdates[0]?.op).toBe("init");
    expect(initPhases).toEqual([
      {
        name: "Setup",
        tasks: [
          { content: "Create schema", status: "in_progress" },
          { content: "Wire API", status: "pending" },
        ],
      },
      {
        name: "UI",
        tasks: [{ content: "Build view", status: "pending" }],
      },
    ]);

    // 2. done("Create schema"): advances "Wire API" to in_progress
    const afterDone1 = todoUpdates[1]?.phases as TodoPhase[];
    expect(todoUpdates[1]?.op).toBe("done");
    expect(afterDone1[0]?.tasks).toEqual([
      { content: "Create schema", status: "completed" },
      { content: "Wire API", status: "in_progress" },
    ]);

    // 3. block("Build view"): captures blocker reason
    const afterBlock = todoUpdates[2]?.phases as TodoPhase[];
    expect(todoUpdates[2]?.op).toBe("block");
    expect(afterBlock[1]?.tasks[0]).toEqual({
      content: "Build view",
      status: "blocked",
      blocker: "Waiting on schema review",
    });

    // 4. done("Wire API"): final state
    const finalPhases = todoUpdates[3]?.phases as TodoPhase[];
    expect(todoUpdates[3]?.op).toBe("done");
    expect(finalPhases).toEqual([
      {
        name: "Setup",
        tasks: [
          { content: "Create schema", status: "completed" },
          { content: "Wire API", status: "completed" },
        ],
      },
      {
        name: "UI",
        tasks: [
          {
            content: "Build view",
            status: "blocked",
            blocker: "Waiting on schema review",
          },
        ],
      },
    ]);

    // Errored todo call still recorded as tool_result with is_error: true
    const errorResult = conn1.events.find(
      (e) => e.type === "tool_result" && e.name === "todo" && e.is_error === true,
    );
    expect(errorResult).toBeDefined();

    // Session lifecycle: create_session resets todos to [], switch_session restores saved phases
    conn1.events.length = 0;
    conn1.ws.send(JSON.stringify({ action: "create_session", title: "Second" }));
    const createdTodo = await conn1.waitForEvent((e) => e.type === "todo_update" && e.op === "clear");
    expect(createdTodo.phases).toEqual([]);

    conn1.events.length = 0;
    conn1.ws.send(JSON.stringify({ action: "switch_session", sessionId: firstSessionId }));
    const switchedTodo = await conn1.waitForEvent((e) => e.type === "todo_update" && e.op === "sync");
    expect(switchedTodo.phases).toEqual(finalPhases);

    conn1.ws.close();

    // Fresh WebSocket reconnect rehydrates latest todo snapshot from session branch
    const conn2 = connectWs();
    await conn2.openReady;
    conn2.ws.send(
      JSON.stringify({
        action: "open_project",
        name: impBody.name,
        model: "custom-todomock/todo-test-model",
        sessionId: firstSessionId,
      }),
    );
    const rehydrated = await conn2.waitForEvent((e) => e.type === "todo_update" && e.op === "sync");
    expect(rehydrated.phases).toEqual(finalPhases);
    conn2.ws.close();
  }, 30_000);
});
