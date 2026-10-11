import type { Subprocess } from "bun";
import * as path from "node:path";
import * as fsSync from "node:fs";

export interface DevServerInfo {
  port: number;
  url: string;
  backend_port: number | null;
  backend_url: string | null;
  pid: number | null;
  backend_pid?: number | null;
}

export type PreviewEventCallback = (event: {
  type: "preview_ready" | "preview_stopped";
  port?: number;
  url?: string;
  backend_port?: number | null;
  backend_url?: string | null;
  project_path?: string;
}) => void;

export class DevServerManager {
  private activeServers = new Map<string, {
    frontendProc: Subprocess;
    backendProc: Subprocess | null;
    info: DevServerInfo;
  }>();

  private eventCallbacks = new Set<PreviewEventCallback>();

  onEvent(cb: PreviewEventCallback): () => void {
    this.eventCallbacks.add(cb);
    return () => this.eventCallbacks.delete(cb);
  }

  private emit(event: Parameters<PreviewEventCallback>[0]): void {
    for (const cb of this.eventCallbacks) {
      try {
        cb(event);
      } catch (err) {
        console.error("[DevServerManager] Error in event callback:", err);
      }
    }
  }

  getServerInfo(projectPath: string): DevServerInfo | null {
    const key = path.resolve(projectPath);
    return this.activeServers.get(key)?.info ?? null;
  }

  private getOccupiedPorts(): Set<number> {
    const ports = new Set<number>();
    for (const server of this.activeServers.values()) {
      ports.add(server.info.port);
      if (server.info.backend_port) {
        ports.add(server.info.backend_port);
      }
    }
    return ports;
  }

  async isPortAvailable(port: number): Promise<boolean> {
    try {
      const server = Bun.listen({
        port,
        hostname: "127.0.0.1",
        socket: {
          data() {},
        },
      });
      server.stop(true);
      return true;
    } catch {
      return false;
    }
  }

  async isPortListening(port: number): Promise<boolean> {
    try {
      await Bun.connect({
        hostname: "127.0.0.1",
        port,
        socket: {
          data() {},
          open(s) {
            s.end();
          },
          error() {},
        },
      });
      return true;
    } catch {
      return false;
    }
  }

  async findAvailablePort(startPort: number = 3000, maxPort: number = 3050): Promise<number> {
    const occupied = this.getOccupiedPorts();
    for (let p = startPort; p <= maxPort; p++) {
      if (!occupied.has(p) && (await this.isPortAvailable(p))) {
        return p;
      }
    }
    return startPort;
  }

  detectBackendCommand(resolvedPath: string, scripts: Record<string, string>): string[] | null {
    if (scripts["dev:backend"]) {
      return ["bun", "run", "dev:backend"];
    }
    if (scripts["server"]) {
      return ["bun", "run", "server"];
    }
    if (scripts["api"]) {
      return ["bun", "run", "api"];
    }

    const candidateFiles = [
      "server/index.js",
      "server/index.ts",
      "server/server.js",
      "server.js",
      "server.ts",
      "src/server.js",
      "src/server.ts",
    ];

    for (const rel of candidateFiles) {
      const full = path.join(resolvedPath, rel);
      if (fsSync.existsSync(full)) {
        return ["bun", "--watch", rel];
      }
    }

    return null;
  }


  async startDevServer(projectPath: string, preferredPort?: number): Promise<DevServerInfo | null> {
    const resolvedPath = path.resolve(projectPath);
    const existing = this.activeServers.get(resolvedPath);
    if (existing) {
      this.emit({
        type: "preview_ready",
        port: existing.info.port,
        url: existing.info.url,
        backend_port: existing.info.backend_port,
        backend_url: existing.info.backend_url,
        project_path: resolvedPath,
      });
      return existing.info;
    }

    const packageJsonPath = path.join(resolvedPath, "package.json");
    if (!fsSync.existsSync(packageJsonPath)) {
      return null;
    }

    const occupied = this.getOccupiedPorts();
    let targetPort: number;
    if (preferredPort && !occupied.has(preferredPort) && (await this.isPortAvailable(preferredPort))) {
      targetPort = preferredPort;
    } else {
      targetPort = await this.findAvailablePort(3000, 3050);
    }

    let scripts: Record<string, string> = {};
    try {
      const rawPkg = fsSync.readFileSync(packageJsonPath, "utf-8");
      scripts = JSON.parse(rawPkg).scripts || {};
    } catch {}

    const frontendScript = scripts["dev:frontend"] || scripts["dev"] || scripts["start"] || null;
    if (!frontendScript) {
      console.log(`[DevServerManager] No runnable dev script found in ${packageJsonPath}`);
      return null;
    }

    const backendCmd = this.detectBackendCommand(resolvedPath, scripts);
    let backendPort: number | null = null;
    if (backendCmd) {
      backendPort = await this.findAvailablePort(5001, 5099);
    }

    console.log(`[DevServerManager] Starting frontend for ${resolvedPath} on port ${targetPort}...`);

    const frontendEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      PORT: String(targetPort),
      VITE_PORT: String(targetPort),
    };
    if (backendPort) {
      frontendEnv.BACKEND_PORT = String(backendPort);
      frontendEnv.VITE_BACKEND_PORT = String(backendPort);
    }

    // Launch frontend dev server using bun
    const frontendProc = Bun.spawn(["bun", "run", frontendScript], {
      cwd: resolvedPath,
      env: frontendEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Launch backend server if detected
    let backendProc: Subprocess | null = null;
    if (backendCmd && backendPort) {
      try {
        console.log(`[DevServerManager] Starting backend for ${resolvedPath} on port ${backendPort}...`);
        backendProc = Bun.spawn(backendCmd, {
          cwd: resolvedPath,
          env: {
            ...process.env as Record<string, string>,
            PORT: String(backendPort),
            BACKEND_PORT: String(backendPort),
          },
          stdout: "pipe",
          stderr: "pipe",
        });
      } catch (err) {
        console.error(`[DevServerManager] Failed to start backend server:`, err);
      }
    }

    const info: DevServerInfo = {
      port: targetPort,
      url: `http://127.0.0.1:${targetPort}`,
      backend_port: backendPort,
      backend_url: backendPort ? `http://127.0.0.1:${backendPort}` : null,
      pid: frontendProc.pid,
      backend_pid: backendProc?.pid ?? null,
    };

    this.activeServers.set(resolvedPath, { frontendProc, backendProc, info });

    // Stream frontend logs and detect ready URL
    (async () => {
      const reader = frontendProc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value, { stream: true });
          buffer += chunk;

          // Check for Vite ready signal: e.g. "Local:   http://localhost:3000/" or "http://127.0.0.1:3000/"
          const match = /(?:http:\/\/(?:localhost|127\.0\.0\.1):)(\d+)/.exec(buffer);
          if (match) {
            const detectedPort = parseInt(match[1], 10);
            if (detectedPort !== targetPort) {
              targetPort = detectedPort;
              info.port = detectedPort;
              info.url = `http://127.0.0.1:${detectedPort}`;
            }
            this.emit({
              type: "preview_ready",
              port: info.port,
              url: info.url,
              backend_port: info.backend_port,
              backend_url: info.backend_url,
              project_path: resolvedPath,
            });
            break;
          }
        }
      } catch {
        // Read stream ended
      }
    })();

    // Always emit ready fallback after 1.5 seconds if process is still alive
    setTimeout(() => {
      if (this.activeServers.has(resolvedPath)) {
        this.emit({
          type: "preview_ready",
          port: info.port,
          url: info.url,
          backend_port: info.backend_port,
          backend_url: info.backend_url,
          project_path: resolvedPath,
        });
      }
    }, 1500);

    return info;
  }

  async ensureBackendRunning(projectPath: string): Promise<number | null> {
    const resolvedPath = path.resolve(projectPath);
    const entry = this.activeServers.get(resolvedPath);
    if (!entry) return null;

    // Check if backend is already alive and listening
    if (entry.backendProc && entry.info.backend_port) {
      const isListening = await this.isPortListening(entry.info.backend_port);
      if (isListening) {
        return entry.info.backend_port;
      }
    }

    const packageJsonPath = path.join(resolvedPath, "package.json");
    let scripts: Record<string, string> = {};
    if (fsSync.existsSync(packageJsonPath)) {
      try {
        const rawPkg = fsSync.readFileSync(packageJsonPath, "utf-8");
        scripts = JSON.parse(rawPkg).scripts || {};
      } catch {}
    }

    const backendCmd = this.detectBackendCommand(resolvedPath, scripts);
    if (!backendCmd) {
      return null;
    }

    const backendPort = entry.info.backend_port || (await this.findAvailablePort(5001, 5099));

    // Terminate existing dead or unresponsive backend process
    if (entry.backendProc) {
      try {
        entry.backendProc.kill();
      } catch {}
    }

    try {
      console.log(`[DevServerManager] Dynamically starting backend for ${resolvedPath} on port ${backendPort}...`);
      const backendProc = Bun.spawn(backendCmd, {
        cwd: resolvedPath,
        env: {
          ...process.env as Record<string, string>,
          PORT: String(backendPort),
          BACKEND_PORT: String(backendPort),
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      entry.backendProc = backendProc;
      entry.info.backend_port = backendPort;
      entry.info.backend_url = `http://127.0.0.1:${backendPort}`;
      entry.info.backend_pid = backendProc.pid;

      this.emit({
        type: "preview_ready",
        port: entry.info.port,
        url: entry.info.url,
        backend_port: entry.info.backend_port,
        backend_url: entry.info.backend_url,
        project_path: resolvedPath,
      });

      return backendPort;
    } catch (err) {
      console.error(`[DevServerManager] Failed to dynamically start backend:`, err);
      return null;
    }
  }

  async getServerStatus(projectPath: string): Promise<{
    frontend: { running: boolean; port: number; url: string };
    backend: { running: boolean; port: number | null; url: string | null };
  } | null> {
    const resolvedPath = path.resolve(projectPath);
    const entry = this.activeServers.get(resolvedPath);
    if (!entry) return null;

    const frontendActive = await this.isPortListening(entry.info.port);
    const backendActive = entry.info.backend_port
      ? await this.isPortListening(entry.info.backend_port)
      : false;

    return {
      frontend: {
        running: frontendActive,
        port: entry.info.port,
        url: entry.info.url,
      },
      backend: {
        running: backendActive,
        port: entry.info.backend_port,
        url: entry.info.backend_url,
      },
    };
  }

  stopDevServer(projectPath: string): void {
    const resolvedPath = path.resolve(projectPath);
    const entry = this.activeServers.get(resolvedPath);
    if (!entry) return;

    try {
      entry.frontendProc.kill();
    } catch {
      // Process might already be dead
    }

    if (entry.backendProc) {
      try {
        entry.backendProc.kill();
      } catch {
        // Backend process might already be dead
      }
    }

    this.activeServers.delete(resolvedPath);
    this.emit({ type: "preview_stopped" });
  }

  async restartDevServer(projectPath: string): Promise<DevServerInfo | null> {
    this.stopDevServer(projectPath);
    return await this.startDevServer(projectPath);
  }

  stopAll(): void {
    for (const [projectPath] of this.activeServers) {
      this.stopDevServer(projectPath);
    }
  }
}
