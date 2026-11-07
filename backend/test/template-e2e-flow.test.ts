import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";

import type { Subprocess } from "bun";

interface ProjectOpenedMessage {
  type: "project_opened";
  project: {
    name: string;
    port: number | null;
    template: string;
  };
  mode: string;
}

interface AgentEventMessage {
  type: string;
  content?: string;
}

describe("Rigorous End-to-End Multi-Template Preparation Flow", () => {
  let backendProc: Subprocess | null = null;
  let testPort: number;
  let tempProjectsRoot: string;
  const backendDir = path.resolve(import.meta.dir, "..");
  beforeAll(async () => {
    tempProjectsRoot = await fs.mkdtemp(path.join(os.tmpdir(), "80deg-e2e-projects-"));
    testPort = 50000 + Math.floor(Math.random() * 5000);

    console.log(`[E2E] Spawning test backend on port ${testPort} with root ${tempProjectsRoot}...`);
    backendProc = Bun.spawn(["bun", "run", path.join(backendDir, "src/index.ts")], {
      cwd: backendDir,
      env: {
        ...process.env as Record<string, string>,
        PORT: String(testPort),
        BACKEND_PORT: String(testPort),
        PROJECTS_ROOT: tempProjectsRoot,
        HOST: "127.0.0.1",
        DISABLE_PORT_SWEEP: "true",
        NODE_ENV: "test",
      },
      stdout: "inherit",
      stderr: "inherit",
    });

    // Wait for healthz
    const deadline = Date.now() + 15000;
    let healthy = false;
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${testPort}/healthz`);
        if (res.ok) {
          healthy = true;
          break;
        }
      } catch {}
      await Bun.sleep(150);
    }

    if (!healthy) {
      throw new Error(`Test backend did not become healthy within 15 seconds on port ${testPort}`);
    }
  }, 30000);

  afterAll(async () => {
    if (backendProc) {
      try {
        backendProc.kill();
      } catch {}
    }
    try {
      await fs.rm(tempProjectsRoot, { recursive: true, force: true });
    } catch {}
  });

  it("completes full lifecycle: template query -> project preparation -> local install -> preview ready -> WebSocket agent session", async () => {
    // 1. Query available templates (User sees chips in composer)
    console.log("[E2E Step 1] Querying /api/templates...");
    const tplRes = await fetch(`http://127.0.0.1:${testPort}/api/templates`);
    expect(tplRes.status).toBe(200);
    const tplData = (await tplRes.json()) as { templates: Array<{ id: string; name: string; icon: string }> };
    expect(Array.isArray(tplData.templates)).toBe(true);

    const selectedTemplate = tplData.templates.find((t) => t.id === "node_react");
    expect(selectedTemplate).toBeDefined();
    expect(selectedTemplate!.name).toBe("Web App");

    // 2. User types prompt and submits workspace creation
    const projectName = "e2e-counter-app";
    console.log(`[E2E Step 2] Submitting project creation for ${projectName}...`);
    const createStartTime = Date.now();
    const createRes = await fetch(`http://127.0.0.1:${testPort}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: projectName,
        template: "node_react",
      }),
    });
    if (createRes.status !== 200) {
      const errText = await createRes.text();
      console.error("[E2E Error] Project creation returned:", createRes.status, errText);
    }
    expect(createRes.status).toBe(200);
    const projectInfo = (await createRes.json()) as {
      name: string;
      path: string;
      template: string;
      port: number | null;
      status: string;
    };
    const createElapsed = Date.now() - createStartTime;
    console.log(`[E2E Step 2 Result] Project prepared in ${createElapsed}ms:`, projectInfo);

    expect(projectInfo.name).toBe(projectName);
    expect(projectInfo.template).toBe("node_react");
    expect(projectInfo.port).not.toBeNull();
    expect(projectInfo.status).toBe("running");

    // 3. Verify on-disk project structure and local isolated dependencies
    console.log("[E2E Step 3] Verifying isolated on-disk project...");
    const projectDir = projectInfo.path;
    expect(fsSync.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "template.json"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "vite.config.js"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, ".git"))).toBe(true);

    const nodeModulesPath = path.join(projectDir, "node_modules");
    expect(fsSync.existsSync(nodeModulesPath)).toBe(true);
    // Crucial requirement: MUST NOT be a symlink
    expect(fsSync.lstatSync(nodeModulesPath).isSymbolicLink()).toBe(false);

    // 4. Verify preview dev server is actively listening and responsive
    const previewPort = projectInfo.port!;
    console.log(`[E2E Step 4] Testing live preview on port ${previewPort}...`);
    const previewRes = await fetch(`http://127.0.0.1:${previewPort}/`);
    expect(previewRes.status).toBe(200);
    const html = await previewRes.text();
    expect(html).toContain("<!DOCTYPE html>");
    // Verify brand attribution chip was injected into HTML
    expect(html).toContain("made-on-80degrees");

    // 5. Connect WebSocket tab and open project
    console.log("[E2E Step 5] Connecting WebSocket to /ws and opening project...");
    const ws = new WebSocket(`ws://127.0.0.1:${testPort}/ws`);
    const { promise: openedPromise, resolve: resolveOpened } = Promise.withResolvers<ProjectOpenedMessage>();
    const { promise: responsePromise, resolve: resolveResponse } = Promise.withResolvers<AgentEventMessage>();

    ws.onmessage = (event) => {
      const data = JSON.parse(typeof event.data === "string" ? event.data : new TextDecoder().decode(event.data));
      if (data.type === "project_opened") {
        resolveOpened(data);
      }
      if (
        data.type === "status" ||
        data.type === "thinking" ||
        data.type === "token" ||
        data.type === "turn_finished" ||
        data.type === "agent_status" ||
        data.type === "auth_required" ||
        data.type === "assistant_error"
      ) {
        resolveResponse(data);
      }
    };

    ws.onopen = () => {
      ws.send(JSON.stringify({
        action: "open_project",
        name: projectName,
        mode: "build",
      }));
    };

    const openedData = await Promise.race([
      openedPromise,
      new Promise((_, r) => setTimeout(() => r(new Error("Timeout waiting for project_opened")), 25000)),
    ]);

    expect(openedData.type).toBe("project_opened");
    expect(openedData.project.name).toBe(projectName);
    expect(openedData.project.port).toBe(previewPort);

    // 6. Send the user message to the agent on the ready workspace
    console.log("[E2E Step 6] Sending user prompt to agent on ready project...");
    ws.send(JSON.stringify({
      action: "prompt",
      prompt: "Please analyze the workspace structure and confirm the template files.",
    }));

    // Verify agent receives prompt and emits active status or events
    const firstAgentEvent = await Promise.race([
      responsePromise,
      new Promise((_, r) => setTimeout(() => r(new Error("Timeout waiting for agent response")), 25000)),
    ]);
    expect(firstAgentEvent).toBeDefined();
    console.log("[E2E Step 6 Result] Agent event received:", firstAgentEvent.type);

    ws.close();
  }, 45000);

  it("prepares and boots game_3d project: scaffolds R3F canvas -> starts dual dev servers -> verifies 3D preview and scores API", async () => {
    const projectName = "e2e-cyber-game";
    console.log(`[E2E Game] Submitting project creation for ${projectName} (game_3d)...`);

    const createRes = await fetch(`http://127.0.0.1:${testPort}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: projectName,
        template: "game_3d",
      }),
    });
    expect(createRes.status).toBe(200);
    const projectInfo = (await createRes.json()) as {
      name: string;
      path: string;
      template: string;
      port: number | null;
      backend_port: number | null;
      status: string;
    };

    expect(projectInfo.name).toBe(projectName);
    expect(projectInfo.template).toBe("game_3d");
    expect(projectInfo.status).toBe("running");
    expect(projectInfo.port).not.toBeNull();

    const projectDir = projectInfo.path;
    expect(fsSync.existsSync(path.join(projectDir, "src/components/game/LogoBrickBreaker.jsx"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "src/components/game/logoBricksData.json"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "src/components/ui/HUD.jsx"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "src/store/useGameStore.js"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "server/index.js"))).toBe(true);

    // Test 3D game preview HTML
    const previewRes = await fetch(`http://127.0.0.1:${projectInfo.port}/`);
    expect(previewRes.status).toBe(200);
    const html = await previewRes.text();
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("3D Game Preview");
    expect(html).toContain("made-on-80degrees");

    // Test backend game leaderboard API
    if (projectInfo.backend_port) {
      const scoresRes = await fetch(`http://127.0.0.1:${projectInfo.backend_port}/api/scores`);
      expect(scoresRes.status).toBe(200);
      const scores = (await scoresRes.json()) as Array<{ player: string; score: number }>;
      expect(Array.isArray(scores)).toBe(true);
      expect(scores.length).toBeGreaterThan(0);
    }
  }, 45000);
});
