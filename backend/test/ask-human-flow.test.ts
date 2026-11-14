import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server, Subprocess } from "bun";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";

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

describe("Ask human multi-question flow over WebSocket + SessionBridge + AskTool", () => {
  let tempRoot = "";
  let tempAgentDir = "";
  let projDir = "";
  let backendProc: Subprocess | null = null;
  let backendPort = 0;

  let mockLlmServer: Server<unknown> | null = null;
  let mockLlmPort = 0;
  let turnCount = 0;
  let capturedTurn2ToolMessages: Array<{ role?: string; content?: unknown }> = [];

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crbn-ask-flow-"));
    tempAgentDir = path.join(tempRoot, "agent");
    projDir = path.join(tempRoot, "project");
    await fs.mkdir(tempAgentDir, { recursive: true });
    await fs.mkdir(projDir, { recursive: true });
    await fs.writeFile(path.join(projDir, "package.json"), JSON.stringify({ name: "ask-test-proj" }));

    mockLlmPort = await findFreePort();
    mockLlmServer = Bun.serve({
      port: mockLlmPort,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/v1/models") {
          return Response.json({
            object: "list",
            data: [{ id: "ask-test-model", max_model_len: 128000 }],
          });
        }
        if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
          const body = (await req.json()) as {
            messages?: Array<{ role?: string; content?: unknown }>;
          };
          turnCount += 1;

          // First LLM response calls `ask` with 3 questions
          if (turnCount === 1 || turnCount === 3) {
            const toolArgs = JSON.stringify({
              html: [
                "<form>",
                "  <fieldset><legend>Storage</legend>",
                "    <p>Which database should we use?</p>",
                '    <label><input type="radio" name="db" value="SQLite" checked> SQLite: Embedded zero-config file DB <code>db.sqlite</code></label>',
                '    <label><input type="radio" name="db" value="Postgres"> Postgres: Hosted relational database <code>postgres://...</code></label>',
                "  </fieldset>",
                "  <fieldset><legend>Modules</legend>",
                "    <p>Which integrations do you want?</p>",
                '    <label><input type="checkbox" name="features" value="Auth"> Auth: Session authentication</label>',
                '    <label><input type="checkbox" name="features" value="Stripe"> Stripe: Billing &amp; checkout</label>',
                '    <label><input type="checkbox" name="features" value="Email"> Email: Transactional email</label>',
                "  </fieldset>",
                "  <fieldset><legend>Deploy</legend>",
                "    <p>Where will you host it?</p>",
                '    <label><input type="radio" name="hosting" value="Vercel"> Vercel: Edge serverless</label>',
                '    <label><input type="radio" name="hosting" value="Docker"> Docker: Self-hosted container</label>',
                "  </fieldset>",
                "</form>",
              ].join("\n"),
            });
            return sseResponse([
              {
                id: `chatcmpl-ask-${turnCount}`,
                object: "chat.completion.chunk",
                model: "ask-test-model",
                choices: [
                  {
                    index: 0,
                    delta: {
                      role: "assistant",
                      tool_calls: [
                        {
                          index: 0,
                          id: `call_ask_${turnCount}`,
                          type: "function",
                          function: { name: "ask", arguments: toolArgs },
                        },
                      ],
                    },
                    finish_reason: null,
                  },
                ],
              },
              {
                id: `chatcmpl-ask-${turnCount}`,
                object: "chat.completion.chunk",
                model: "ask-test-model",
                choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
              },
            ]);
          }

          // Turn 2 receives the AskTool result and replies
          capturedTurn2ToolMessages = (body.messages ?? []).filter((m) => m.role === "tool");
          return sseResponse([
            {
              id: "chatcmpl-done",
              object: "chat.completion.chunk",
              model: "ask-test-model",
              choices: [
                {
                  index: 0,
                  delta: { role: "assistant", content: "Configured everything cleanly." },
                  finish_reason: null,
                },
              ],
            },
            {
              id: "chatcmpl-done",
              object: "chat.completion.chunk",
              model: "ask-test-model",
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
      // Platform-clock backoff polling child process /healthz readiness
      await Bun.sleep(100);
    }

    // Register custom mock model cleanly via API
    const saveRes = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "AskMock",
        baseUrl: `http://127.0.0.1:${mockLlmPort}/v1`,
        format: "openai",
        modelId: "ask-test-model",
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

  it("emits exactly one ask_human prompt with all 3 questions & descriptions and resolves distinct answers per question", async () => {
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

    const { promise: openPromise, resolve: resolveOpen, reject: rejectOpen } = Promise.withResolvers<void>();
    ws.addEventListener("open", () => resolveOpen(), { once: true });
    ws.addEventListener("error", (e) => rejectOpen(e), { once: true });
    await openPromise;
    // Import project via local path
    const impRes = await fetch(`http://127.0.0.1:${backendPort}/api/projects/import-local`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: projDir }),
    });
    const impBody = (await impRes.json()) as { name: string };
    expect(impRes.status).toBe(200);

    ws.send(
      JSON.stringify({
        action: "open_project",
        name: impBody.name,
        model: "custom-askmock/ask-test-model",
      }),
    );
    await waitForEvent((e) => e.type === "project_opened");

    ws.send(JSON.stringify({ action: "prompt", prompt: "Set up project" }));

    const askEvt = await waitForEvent((e) => e.type === "ask_human");
    // Must emit ONLY 1 ask_human event (no duplicate from tool_execution_start)
    const askEventsSoFar = events.filter((e) => e.type === "ask_human");
    expect(askEventsSoFar.length).toBe(1);
    expect(String(askEvt.id)).toStartWith("ask_");

    const questions = askEvt.questions as Array<{
      id: string;
      multi: boolean;
      options: Array<{ label: string; description?: string; preview?: string }>;
    }>;
    expect(questions.length).toBe(3);
    expect(questions[0]?.options[1]?.description).toBe("Hosted relational database");
    expect(questions[0]?.options[1]?.preview).toBe("postgres://...");
    expect(questions[1]?.multi).toBe(true);

    // Submit distinct answers for all 3 questions together
    ws.send(
      JSON.stringify({
        action: "tool_response",
        id: askEvt.id,
        response: {
          kind: "submit",
          answers: {
            db: { selectedOptions: ["Postgres"] },
            features: { selectedOptions: ["Auth", "Stripe"] },
            hosting: { selectedOptions: [], customInput: "Deploy on Fly.io" },
          },
        },
      }),
    );

    const resolvedEvt = await waitForEvent((e) => e.type === "ask_resolved" && e.id === askEvt.id);
    expect(resolvedEvt.type).toBe("ask_resolved");

    const toolEndEvt = await waitForEvent(
      (e) => e.type === "tool_result" && e.name === "ask",
    );
    const details = (toolEndEvt.result as { details?: { results?: Array<{ id: string; selectedOptions: string[]; customInput?: string }> } })?.details;
    expect(details?.results?.length).toBe(3);
    expect(details?.results?.[0]?.selectedOptions).toEqual(["Postgres"]);
    expect(details?.results?.[1]?.selectedOptions).toEqual(["Auth", "Stripe"]);
    expect(details?.results?.[2]?.customInput).toBe("Deploy on Fly.io");

    await waitForEvent((e) => e.type === "status" && e.content === "Done");

    // Verify turn 2 LLM tool message carried all 3 distinct answers
    const toolText = JSON.stringify(capturedTurn2ToolMessages);
    expect(toolText).toContain("Postgres");
    expect(toolText).toContain("Auth");
    expect(toolText).toContain("Stripe");
    expect(toolText).toContain("Deploy on Fly.io");

    // Verify stop_agent emits ask_resolved when an ask prompt is open
    events.length = 0;
    ws.send(JSON.stringify({ action: "prompt", prompt: "Ask again" }));
    const askEvt2 = await waitForEvent((e) => e.type === "ask_human");
    ws.send(JSON.stringify({ action: "stop_agent" }));
    const resolved2 = await waitForEvent((e) => e.type === "ask_resolved" && e.id === askEvt2.id);
    expect(resolved2.id).toBe(askEvt2.id);

    ws.close();
  }, 30_000);
});
