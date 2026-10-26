import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { DevServerManager } from "../src/dev-server";

describe("DevServer Lifecycle and Port Vacancy", () => {
  it("terminates processes and releases ports completely upon stopDevServer", async () => {
    const devServerManager = new DevServerManager();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "80deg-lifecycle-test-"));
    const projectDir = path.join(tempDir, "mock-project");
    fs.mkdirSync(projectDir, { recursive: true });

    // Create a mock node server in the project
    fs.mkdirSync(path.join(projectDir, "server"), { recursive: true });
    const serverScript = path.join(projectDir, "server", "index.js");
    fs.writeFileSync(
      serverScript,
      `
const http = require('http');
const port = process.env.PORT || 4100;
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('ok');
});
server.listen(port, () => {
  console.log('Mock server listening on port ' + port);
});
`
    );

    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        name: "mock-project",
        scripts: {
          start: "node server/index.js",
        },
      })
    );

    try {
      // 1. Allocate available port
      const testPort = await devServerManager.findAvailablePort(4100, 4150);
      expect(await devServerManager.isPortAvailable(testPort)).toBe(true);

      // 2. Start server
      const info = await devServerManager.startDevServer(projectDir, testPort);
      expect(info.port).toBe(testPort);

      // Verify port is occupied / listening
      let isListening = false;
      for (let i = 0; i < 20; i++) {
        if (await devServerManager.isPortListening(testPort)) {
          isListening = true;
          break;
        }
        await Bun.sleep(100);
      }
      expect(isListening).toBe(true);

      // 3. Stop server
      await devServerManager.stopDevServer(projectDir);

      // 4. Verify process is killed and port is completely vacant
      const portFree = await devServerManager.isPortAvailable(testPort);
      const portListening = await devServerManager.isPortListening(testPort);

      expect(portListening).toBe(false);
      expect(portFree).toBe(true);

      // 5. Verify the port can immediately be bound by a new listener with zero collision
      const listener = Bun.listen({
        port: testPort,
        hostname: "127.0.0.1",
        socket: { data() {} },
      });
      expect(listener).toBeDefined();
      listener.stop(true);
    } finally {
      await devServerManager.stopAll();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("terminates BOTH frontend and backend project servers and frees both ports", async () => {
    const devServerManager = new DevServerManager();
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "80deg-dual-server-test-"));
    const projectDir = path.join(tempDir, "fullstack-project");
    fs.mkdirSync(projectDir, { recursive: true });

    // 1. Frontend server mock
    const frontendScript = path.join(projectDir, "frontend.js");
    fs.writeFileSync(
      frontendScript,
      `
const http = require('http');
const port = process.env.PORT || 4200;
http.createServer((req, res) => res.end('frontend ok')).listen(port);
`
    );

    // 2. Backend API server mock
    fs.mkdirSync(path.join(projectDir, "server"), { recursive: true });
    const backendScript = path.join(projectDir, "server", "index.js");
    fs.writeFileSync(
      backendScript,
      `
const http = require('http');
const port = process.env.BACKEND_PORT || process.env.PORT || 5200;
http.createServer((req, res) => res.end('backend api ok')).listen(port);
`
    );

    fs.writeFileSync(
      path.join(projectDir, "package.json"),
      JSON.stringify({
        name: "fullstack-project",
        scripts: {
          dev: "node frontend.js",
          server: "node server/index.js",
        },
      })
    );

    try {
      const frontendPort = 4200;
      const backendPort = 5200;

      // Start fullstack dev server
      const info = await devServerManager.startDevServer(projectDir, frontendPort, backendPort);
      expect(info?.port).toBe(frontendPort);
      expect(info?.backend_port).toBe(backendPort);

      // Wait for both to be listening
      let frontendListening = false;
      let backendListening = false;
      for (let i = 0; i < 25; i++) {
        if (!frontendListening && (await devServerManager.isPortListening(frontendPort))) {
          frontendListening = true;
        }
        if (!backendListening && (await devServerManager.isPortListening(backendPort))) {
          backendListening = true;
        }
        if (frontendListening && backendListening) break;
        await Bun.sleep(100);
      }
      expect(frontendListening).toBe(true);
      expect(backendListening).toBe(true);

      // Stop project servers
      await devServerManager.stopDevServer(projectDir);

      // Verify BOTH ports are now free
      expect(await devServerManager.isPortListening(frontendPort)).toBe(false);
      expect(await devServerManager.isPortListening(backendPort)).toBe(false);
      expect(await devServerManager.isPortAvailable(frontendPort)).toBe(true);
      expect(await devServerManager.isPortAvailable(backendPort)).toBe(true);

      // Verify both ports can be rebound immediately
      const l1 = Bun.listen({ port: frontendPort, hostname: "127.0.0.1", socket: { data() {} } });
      const l2 = Bun.listen({ port: backendPort, hostname: "127.0.0.1", socket: { data() {} } });
      expect(l1).toBeDefined();
      expect(l2).toBeDefined();
      l1.stop(true);
      l2.stop(true);
    } finally {
      await devServerManager.stopAll();
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
