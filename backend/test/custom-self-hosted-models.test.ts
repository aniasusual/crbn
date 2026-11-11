import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Server, Subprocess } from "bun";
import * as fs from "node:fs/promises";
import * as net from "node:net";
import * as os from "node:os";
import * as path from "node:path";
import * as yaml from "yaml";

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

describe("Self-hosted and custom models integration", () => {
  let tempRoot = "";
  let tempAgentDir = "";
  let backendProc: Subprocess | null = null;
  let backendPort = 0;

  let mockOpenAIServer: Server<unknown> | null = null;
  let mockOpenAIPort = 0;
  let seenAuthHeaders: Array<string | null> = [];

  let mockOllamaServer: Server<unknown> | null = null;
  let mockOllamaPort = 0;

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crbn-custom-models-"));
    tempAgentDir = path.join(tempRoot, "agent");
    await fs.mkdir(tempAgentDir, { recursive: true });

    // Start mock OpenAI-compatible server (e.g., OmniRoute / vLLM)
    mockOpenAIPort = await findFreePort();
    mockOpenAIServer = Bun.serve({
      port: mockOpenAIPort,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        seenAuthHeaders.push(req.headers.get("authorization"));
        if (url.pathname === "/no-models/v1/models") {
          return new Response("Not Found", { status: 404 });
        }
        if (url.pathname === "/no-models/v1/chat/completions" && req.method === "POST") {
          return Response.json({
            id: "chatcmpl-locked",
            choices: [{ message: { role: "assistant", content: "ok" } }],
          });
        }
        if (url.pathname === "/v1/models") {
          return Response.json({
            object: "list",
            data: [
              {
                id: "qwen2.5-coder-32b",
                object: "model",
                max_model_len: 65536,
              },
              {
                id: "deepseek-r1-distill-32b",
                object: "model",
                context_length: 32768,
              },
            ],
          });
        }
        if (url.pathname === "/v1/chat/completions" && req.method === "POST") {
          if (req.headers.get("authorization") === "Bearer bad-key") {
            return Response.json({ error: { message: "Invalid key" } }, { status: 401 });
          }
          return Response.json({
            id: "chatcmpl-1",
            choices: [{ message: { role: "assistant", content: "hi" } }],
          });
        }
        if (url.pathname === "/v1/responses" && req.method === "POST") {
          return Response.json({ id: "resp-1", output_text: "hi" });
        }
        if (url.pathname === "/v1/messages" && req.method === "POST") {
          const xApiKey = req.headers.get("x-api-key");
          const anthVer = req.headers.get("anthropic-version");
          if (xApiKey !== "sk-anth-ok" || !anthVer) {
            return Response.json({ error: { message: "Unauthorized" } }, { status: 401 });
          }
          return Response.json({ id: "msg-1", type: "message", content: [{ type: "text", text: "hi" }] });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    // Reserve a free port for Ollama, but DO NOT start it yet (tests late startup discovery!)
    mockOllamaPort = await findFreePort();
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
        OLLAMA_BASE_URL: `http://127.0.0.1:${mockOllamaPort}`,
      },
      stdout: "ignore",
      stderr: "inherit",
    });

    const deadline = Date.now() + 15_000;
    let healthy = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${backendPort}/healthz`, {
          signal: AbortSignal.timeout(500),
        });
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {}
      // Platform-clock backoff polling external child process TCP /healthz readiness
      await Bun.sleep(100);
    }
    if (!healthy) {
      throw new Error(`Test backend failed to become healthy on port ${backendPort}`);
    }
  }, 30_000);

  afterAll(async () => {
    if (backendProc) {
      try {
        backendProc.kill();
      } catch {}
      backendProc = null;
    }
    mockOpenAIServer?.stop(true);
    mockOllamaServer?.stop(true);
    if (tempRoot) {
      await fs.rm(tempRoot, { recursive: true, force: true }).catch(() => {});
    }
  });

  it("probes a custom OpenAI-compatible endpoint without writing models.yml", async () => {
    const res = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockOpenAIPort}`,
        api: "openai-completions",
        discoveryType: "openai-models-list",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      baseUrl: string;
      models: Array<{ id: string; contextWindow?: number }>;
    };
    expect(body.ok).toBe(true);
    expect(body.baseUrl).toBe(`http://127.0.0.1:${mockOpenAIPort}/v1`);
    expect(body.models.map((m) => m.id)).toContain("qwen2.5-coder-32b");
    expect(body.models.find((m) => m.id === "qwen2.5-coder-32b")?.contextWindow).toBe(65536);

    const exists = await fs
      .access(path.join(tempAgentDir, "models.yml"))
      .then(() => true)
      .catch(() => false);
    expect(exists).toBe(false);
  });

  it("saves a keyless gateway via /api/auth/gateway, marks it ready in catalog, and resolves in SessionBridge", async () => {
    seenAuthHeaders = [];
    const res = await fetch(`http://127.0.0.1:${backendPort}/api/auth/gateway`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "omniroute",
        base_url: `http://127.0.0.1:${mockOpenAIPort}`,
      }),
    });
    expect(res.status).toBe(200);
    const saveBody = (await res.json()) as { success: boolean; provider: string; modelCount: number };
    expect(saveBody.success).toBe(true);
    expect(saveBody.provider).toBe("omniroute");
    expect(saveBody.modelCount).toBe(2);
    expect(seenAuthHeaders.every((h) => h === null)).toBe(true);

    // Verify models.yml has auth: none
    const ymlRaw = await fs.readFile(path.join(tempAgentDir, "models.yml"), "utf-8");
    const parsedYml = yaml.parse(ymlRaw) as { providers: Record<string, Record<string, unknown>> };
    expect(parsedYml.providers.omniroute.auth).toBe("none");

    // Verify catalog exposes real context tokens & has_auth: true
    const catRes = await fetch(`http://127.0.0.1:${backendPort}/api/system/models-and-hardware`);
    expect(catRes.status).toBe(200);
    const catalog = (await catRes.json()) as {
      models: Array<{
        id: string;
        canonical_id: string;
        provider: string;
        has_auth: boolean;
        auth_type: string;
        context_tokens: number;
      }>;
    };
    const qwenModel = catalog.models.find((m) => m.canonical_id === "omniroute/qwen2.5-coder-32b");
    expect(qwenModel).toBeDefined();
    expect(qwenModel?.has_auth).toBe(true);
    expect(qwenModel?.auth_type).toBe("local");
    expect(qwenModel?.context_tokens).toBe(65536);

    // Regression check: verify SessionBridge.resolveModel resolves keyless omniroute model (not auth_required)
    const wsProjectDir = path.join(tempRoot, "proj-keyless");
    await fs.mkdir(wsProjectDir, { recursive: true });
    const scriptFile = path.join(tempRoot, "check-keyless.ts");
    const backendDir = path.resolve(__dirname, "..");
    const modelsServiceFile = path.join(backendDir, "src/models-service.ts").replace(/\\/g, "/");
    const sessionBridgeFile = path.join(backendDir, "src/session-bridge.ts").replace(/\\/g, "/");
    await fs.writeFile(
      scriptFile,
      `import { ModelsService } from ${JSON.stringify(modelsServiceFile)};
import { SessionBridge } from ${JSON.stringify(sessionBridgeFile)};
const ms = new ModelsService();
const bridge = new SessionBridge(() => {}, ms);
const resolved = await bridge.resolveModel("omniroute/qwen2.5-coder-32b");
console.log(JSON.stringify({ id: resolved?.id, provider: resolved?.provider, baseUrl: resolved?.baseUrl, contextWindow: resolved?.contextWindow }));
`
    );
    const checkProc = Bun.spawn(["bun", scriptFile], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...(process.env as Record<string, string>),
        HOME: tempRoot,
        USERPROFILE: tempRoot,
        PI_CODING_AGENT_DIR: tempAgentDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(checkProc.stdout).text();
    const code = await checkProc.exited;
    expect(code).toBe(0);
    const resolved = JSON.parse(out.trim()) as { id?: string; provider?: string; baseUrl?: string; contextWindow?: number };
    expect(resolved.id).toBe("qwen2.5-coder-32b");
    expect(resolved.provider).toBe("omniroute");
    expect(resolved.baseUrl).toBe(`http://127.0.0.1:${mockOpenAIPort}/v1`);
    expect(resolved.contextWindow).toBe(65536);
  });

  it("saves, updates (preserving apiKey), lists, and deletes a custom Anthropic provider", async () => {
    const saveRes = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "corp-claude",
        baseUrl: "https://anthropic-proxy.internal/anthropic",
        api: "anthropic-messages",
        auth: "apiKey",
        apiKey: "sk-corp-secret-1234",
        discoveryType: "none",
        disableStrictTools: true,
        models: [
          {
            id: "claude-proxy-4",
            name: "Claude Proxy 4",
            contextWindow: 200000,
            maxTokens: 16384,
            reasoning: true,
            supportsVision: true,
          },
        ],
      }),
    });
    expect(saveRes.status).toBe(200);

    // Check models.yml explicitly writes auth: "apiKey" (not omitted!) and disableStrictTools: true
    const ymlRaw = await fs.readFile(path.join(tempAgentDir, "models.yml"), "utf-8");
    const parsedYml = yaml.parse(ymlRaw) as { providers: Record<string, Record<string, unknown>> };
    expect(parsedYml.providers["corp-claude"].auth).toBe("apiKey");
    expect(parsedYml.providers["corp-claude"].disableStrictTools).toBe(true);
    expect(parsedYml.providers["corp-claude"].baseUrl).toBe("https://anthropic-proxy.internal/anthropic");

    // Update without re-sending apiKey -> preserves existing key
    const updateRes = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "corp-claude",
        baseUrl: "https://anthropic-proxy-v2.internal/anthropic",
        api: "anthropic-messages",
        auth: "apiKey",
        discoveryType: "none",
        disableStrictTools: true,
        models: [
          {
            id: "claude-proxy-4",
            name: "Claude Proxy 4",
            contextWindow: 200000,
            maxTokens: 16384,
            reasoning: true,
            supportsVision: true,
          },
        ],
      }),
    });
    expect(updateRes.status).toBe(200);
    const updatedYml = yaml.parse(await fs.readFile(path.join(tempAgentDir, "models.yml"), "utf-8")) as {
      providers: Record<string, Record<string, unknown>>;
    };
    expect(updatedYml.providers["corp-claude"].apiKey).toBe("sk-corp-secret-1234");
    expect(updatedYml.providers["corp-claude"].baseUrl).toBe("https://anthropic-proxy-v2.internal/anthropic");

    // Verify listCustomProviders
    const listRes = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers`);
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { providers: Array<{ provider: string; modelCount: number }> };
    expect(listBody.providers.some((p) => p.provider === "corp-claude" && p.modelCount === 1)).toBe(true);

    // Delete custom provider
    const delRes = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers/corp-claude`, {
      method: "DELETE",
    });
    expect(delRes.status).toBe(200);
    const afterDelYml = yaml.parse(await fs.readFile(path.join(tempAgentDir, "models.yml"), "utf-8")) as {
      providers: Record<string, Record<string, unknown>>;
    };
    expect(afterDelYml.providers["corp-claude"]).toBeUndefined();
  });

  it("discovers late-started Ollama via /api/models/local/refresh and resolves in SessionBridge", async () => {
    // Initially Ollama is NOT running
    const beforeCatRes = await fetch(`http://127.0.0.1:${backendPort}/api/system/models-and-hardware`);
    const beforeCat = (await beforeCatRes.json()) as {
      ollama_running: boolean;
      models: Array<{ canonical_id: string }>;
    };
    expect(beforeCat.ollama_running).toBe(false);
    expect(beforeCat.models.some((m) => m.canonical_id === "ollama/qwen3:8b")).toBe(false);

    // Start mock Ollama AFTER backend initialized its registry
    mockOllamaServer = Bun.serve({
      port: mockOllamaPort,
      hostname: "127.0.0.1",
      async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/api/tags") {
          return Response.json({
            models: [{ name: "qwen3:8b", size: 5_000_000_000 }],
          });
        }
        if (url.pathname === "/api/show" && req.method === "POST") {
          return Response.json({
            capabilities: ["completion", "tools", "thinking"],
            model_info: {
              "qwen3.context_length": 40960,
            },
          });
        }
        return new Response("Not Found", { status: 404 });
      },
    });

    // Hit /api/models/local/refresh
    const refreshRes = await fetch(`http://127.0.0.1:${backendPort}/api/models/local/refresh`, {
      method: "POST",
    });
    expect(refreshRes.status).toBe(200);
    const refreshed = (await refreshRes.json()) as {
      ok: boolean;
      ollama_running: boolean;
      models: Array<{
        canonical_id: string;
        has_auth: boolean;
        auth_type: string;
        context_tokens: number;
        supports_thinking: boolean;
      }>;
    };
    expect(refreshed.ok).toBe(true);
    expect(refreshed.ollama_running).toBe(true);

    const ollamaModel = refreshed.models.find((m) => m.canonical_id === "ollama/qwen3:8b");
    expect(ollamaModel).toBeDefined();
    expect(ollamaModel?.has_auth).toBe(true);
    expect(ollamaModel?.auth_type).toBe("local");
    expect(ollamaModel?.context_tokens).toBe(40960);
    expect(ollamaModel?.supports_thinking).toBe(true);
  });

  it("rejects invalid custom provider configurations cleanly without corrupting models.yml", async () => {
    const beforeYml = await fs.readFile(path.join(tempAgentDir, "models.yml"), "utf-8");

    const badRes = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "bad-empty",
        baseUrl: "http://127.0.0.1:9999/v1",
        api: "openai-completions",
        discoveryType: "none",
        models: [],
      }),
    });
    expect(badRes.status).toBe(400);

    const afterYml = await fs.readFile(path.join(tempAgentDir, "models.yml"), "utf-8");
    expect(afterYml).toBe(beforeYml);
  });

  it("saves a custom model via Name + Base URL + Model ID even when /v1/models returns 404, and protects built-in providers", async () => {
    const saveRes = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Locked Proxy",
        baseUrl: `http://127.0.0.1:${mockOpenAIPort}/no-models/v1`,
        format: "openai",
        modelId: "corp-coder-v2",
        discoveryType: "openai-models-list",
      }),
    });
    expect(saveRes.status).toBe(200);
    const saved = (await saveRes.json()) as { success: boolean; provider: string; modelCount: number };
    expect(saved.success).toBe(true);
    expect(saved.provider).toBe("custom-locked-proxy");
    expect(saved.modelCount).toBe(1);

    // Built-in collision guard: attempting to save provider: "openai" must namespace to custom-openai
    const collideRes = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: "openai",
        baseUrl: "https://remote-proxy.example.com/v1",
        format: "openai",
        modelId: "ft-custom-model",
      }),
    });
    expect(collideRes.status).toBe(200);
    const collided = (await collideRes.json()) as { provider: string };
    expect(collided.provider).toBe("custom-openai");

    const yml = yaml.parse(await fs.readFile(path.join(tempAgentDir, "models.yml"), "utf-8")) as {
      providers: Record<string, Record<string, unknown>>;
    };
    expect(yml.providers.openai).toBeUndefined();
    expect(yml.providers["custom-openai"]).toBeDefined();
    expect(yml.providers["custom-locked-proxy"].discovery).toBeUndefined();

    // Remote custom provider gets auth_type: "custom" (not "local")
    const catRes = await fetch(`http://127.0.0.1:${backendPort}/api/system/models-and-hardware`);
    const cat = (await catRes.json()) as {
      models: Array<{ canonical_id: string; auth_type: string; has_auth: boolean; tags: string[] }>;
    };
    const remoteModel = cat.models.find((m) => m.canonical_id === "custom-openai/ft-custom-model");
    expect(remoteModel?.has_auth).toBe(true);
    expect(remoteModel?.auth_type).toBe("custom");
    expect(remoteModel?.tags).toContain("custom");
    expect(remoteModel?.tags).not.toContain("local");
  });

  it("runs 1-token inference probes for OpenAI, Responses, and Anthropic formats with clear error diagnostics", async () => {
    const openaiProbe = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockOpenAIPort}/no-models/v1`,
        format: "openai",
        modelId: "corp-coder-v2",
        testInference: true,
      }),
    });
    expect(openaiProbe.status).toBe(200);
    const openaiBody = (await openaiProbe.json()) as { inferenceTested: boolean; testedModel: string };
    expect(openaiBody.inferenceTested).toBe(true);
    expect(openaiBody.testedModel).toBe("corp-coder-v2");

    const respProbe = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockOpenAIPort}/v1`,
        format: "openai-responses",
        modelId: "qwen2.5-coder-32b",
        testInference: true,
      }),
    });
    expect(respProbe.status).toBe(200);

    const anthProbe = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockOpenAIPort}`,
        format: "anthropic",
        apiKey: "sk-anth-ok",
        modelId: "claude-sonnet-4",
        testInference: true,
      }),
    });
    expect(anthProbe.status).toBe(200);

    const badKeyProbe = await fetch(`http://127.0.0.1:${backendPort}/api/models/custom-providers/probe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        baseUrl: `http://127.0.0.1:${mockOpenAIPort}/v1`,
        format: "openai",
        apiKey: "bad-key",
        modelId: "qwen2.5-coder-32b",
        testInference: true,
      }),
    });
    expect(badKeyProbe.status).toBe(400);
    const errBody = (await badKeyProbe.json()) as { detail: string };
    expect(errBody.detail).toContain("Authentication failed");
  });

  it("hot-reloads active SessionBridge model when custom provider baseUrl is updated", async () => {
    const wsProj = path.join(tempRoot, "hot-reload-proj");
    await fs.mkdir(wsProj, { recursive: true });

    const hotReloadScript = path.join(tempRoot, "check-hot-reload.ts");
    const backendDir = path.resolve(__dirname, "..");
    const modelsServiceFile = path.join(backendDir, "src/models-service.ts").replace(/\\/g, "/");
    const sessionBridgeFile = path.join(backendDir, "src/session-bridge.ts").replace(/\\/g, "/");
    await fs.writeFile(
      hotReloadScript,
      `import { ModelsService } from ${JSON.stringify(modelsServiceFile)};
import { SessionBridge } from ${JSON.stringify(sessionBridgeFile)};
const ms = new ModelsService();
await ms.saveCustomProvider({
  name: "Hot",
  baseUrl: "http://127.0.0.1:19001/v1",
  format: "openai",
  modelId: "hot-model",
});
const bridge = new SessionBridge(() => {}, ms);
await bridge.openProject(${JSON.stringify(wsProj)}, "custom-hot/hot-model");
const beforeUrl = bridge["session"]?.model?.baseUrl;
await ms.saveCustomProvider({
  provider: "custom-hot",
  isEdit: true,
  baseUrl: "http://127.0.0.1:19002/v1",
  format: "openai",
  modelId: "hot-model",
});
await bridge.refreshProviderIfActive("custom-hot");
const afterUrl = bridge["session"]?.model?.baseUrl;
await bridge.dispose();
console.log("HOT_RELOAD_RESULT:" + JSON.stringify({ beforeUrl, afterUrl }));
`
    );
    const checkProc = Bun.spawn(["bun", hotReloadScript], {
      cwd: path.resolve(__dirname, ".."),
      env: {
        ...(process.env as Record<string, string>),
        HOME: tempRoot,
        USERPROFILE: tempRoot,
        PI_CODING_AGENT_DIR: tempAgentDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const out = await new Response(checkProc.stdout).text();
    const errOut = await new Response(checkProc.stderr).text();
    const code = await checkProc.exited;
    if (code !== 0) {
      throw new Error(`Hot-reload check exited ${code}: ${errOut}`);
    }
    const resultLine = out.split("\n").find((l) => l.startsWith("HOT_RELOAD_RESULT:"));
    expect(resultLine).toBeDefined();
    const parsed = JSON.parse(resultLine!.slice("HOT_RELOAD_RESULT:".length)) as {
      beforeUrl?: string;
      afterUrl?: string;
    };
    expect(parsed.beforeUrl).toBe("http://127.0.0.1:19001/v1");
    expect(parsed.afterUrl).toBe("http://127.0.0.1:19002/v1");
  });

  it("never exposes encoded models.json metadata keys or unnamed models in the catalog", async () => {
    const res = await fetch(`http://127.0.0.1:${backendPort}/api/system/models-and-hardware`);
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      providers: Array<{ id: string; label: string; model_count: number }>;
      models: Array<{ id?: string; name?: string; canonical_id?: string; provider?: string }>;
    };

    const forbiddenKeys = new Set(["version", "keys", "booleanShapes", "nodes", "compat", "providers"]);
    const leakedProviders = data.providers.filter((p) => forbiddenKeys.has(p.id));
    expect(leakedProviders).toEqual([]);

    const malformedModels = data.models.filter(
      (m) =>
        !m.id ||
        m.id === "undefined" ||
        !m.name ||
        m.name === "undefined" ||
        !m.canonical_id ||
        m.canonical_id.endsWith("/undefined") ||
        forbiddenKeys.has(m.provider || ""),
    );
    expect(malformedModels).toEqual([]);
    expect(data.models.length).toBeGreaterThan(100);
  });
});
