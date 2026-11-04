import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import type { Subprocess } from "bun";
import * as net from "node:net";
import * as path from "node:path";

let serverProc: Subprocess | null = null;
let testPort = 8991;

function findFreePort(): Promise<number> {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const srv = net.createServer();
  srv.once("error", reject);
  srv.once("listening", () => {
    const address = srv.address();
    const port = typeof address === "object" && address ? address.port : 8991;
    srv.close(() => resolve(port));
  });
  srv.listen(0, "127.0.0.1");
  return promise;
}

describe("Backend HTTP API", () => {
  beforeAll(async () => {
    testPort = await findFreePort();
    console.log(`[Test] Launching test backend on port ${testPort}...`);

    const backendDir = path.resolve(__dirname, "..");
    serverProc = Bun.spawn(["bun", "run", path.join(backendDir, "src/index.ts")], {
      cwd: backendDir,
      env: {
        ...process.env as Record<string, string>,
        PORT: String(testPort),
        BACKEND_PORT: String(testPort),
        HOST: "127.0.0.1",
      },
      stdout: "ignore",
      stderr: "inherit",
    });

    // Wait for /healthz to be ready
    const deadline = Date.now() + 10_000;
    let healthy = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${testPort}/healthz`, {
          signal: AbortSignal.timeout(500),
        });
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await Bun.sleep(100);
    }

    if (!healthy) {
      throw new Error(`Test backend did not become healthy within 10 seconds on port ${testPort}`);
    }
  }, 30_000);

  afterAll(() => {
    if (serverProc) {
      try {
        serverProc.kill();
      } catch {}
      serverProc = null;
    }
  });

  it("responds to /healthz with status: ok", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/healthz`);
    expect(res.status).toBe(200);

    const body = (await res.json()) as { status: string; port: number; pid: number };
    expect(body.status).toBe("ok");
    expect(body.port).toBe(testPort);
  });

  it("responds to GET /api/templates with template list", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/templates`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as { templates: Array<{ id: string; name: string }> };
    expect(data.templates).toBeDefined();
    expect(Array.isArray(data.templates)).toBe(true);
    expect(data.templates.some((t) => t.id === "node_react")).toBe(true);
  });

  it("streams real-time project creation progress on POST /api/projects?stream=true", async () => {
    const streamProjName = `test-stream-proj-${Date.now()}`;
    const res = await fetch(`http://127.0.0.1:${testPort}/api/projects?stream=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: streamProjName,
        template: "node_react",
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");

    const text = await res.text();
    const lines = text.trim().split("\n").map((l) => JSON.parse(l));

    const progressEvents = lines.filter((l) => l.type === "progress");
    expect(progressEvents.length).toBeGreaterThanOrEqual(3);
    expect(progressEvents.some((p) => p.phase === "scaffolding")).toBe(true);
    expect(progressEvents.some((p) => p.phase === "git")).toBe(true);
    expect(progressEvents.some((p) => p.phase === "dependencies")).toBe(true);

    const completeEvent = lines.find((l) => l.type === "complete");
    expect(completeEvent).toBeDefined();
    expect(completeEvent.project.name).toBe(streamProjName);
    expect(completeEvent.project.template).toBe("node_react");
  });
  it("responds to GET /api/system/git-status with structured status", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/system/git-status`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      installed: boolean;
      isPortable: boolean;
      version?: string;
      phase?: string;
    };

    expect(typeof data.installed).toBe("boolean");
    expect(typeof data.isPortable).toBe("boolean");
    expect(data.installed).toBe(true);
    expect(data.version).toBeDefined();
    expect(data.phase).toBe("completed");
  });

  it("responds to POST /api/system/install-git without errors", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/system/install-git`, {
      method: "POST",
    });
    expect(res.status).toBe(200);

    const data = (await res.json()) as { success: boolean; installed?: boolean };
    expect(data.success).toBe(true);
  });

  it("responds to GET /api/system/update/check with version details", async () => {
    const res = await fetch(`http://127.0.0.1:${testPort}/api/system/update/check`);
    expect(res.status).toBe(200);

    const data = (await res.json()) as {
      hasUpdate: boolean;
      currentVersion: string;
      latestVersion: string;
    };

    expect(typeof data.hasUpdate).toBe("boolean");
    expect(typeof data.currentVersion).toBe("string");
    expect(typeof data.latestVersion).toBe("string");
  });
});
