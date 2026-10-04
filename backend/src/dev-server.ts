import type { Subprocess } from "bun";
import * as path from "node:path";
import * as fsSync from "node:fs";

export interface DevServerInfo {
  port: number;
  url: string;
  backend_port: number;
  backend_url: string;
  pid: number | null;
}

export type PreviewEventCallback = (event: {
  type: "preview_ready" | "preview_stopped";
  port?: number;
  url?: string;
  backend_port?: number;
  backend_url?: string;
}) => void;

export class DevServerManager {
  private activeServers = new Map<string, {
    proc: Subprocess;
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

  async startDevServer(projectPath: string, preferredPort: number = 3000): Promise<DevServerInfo | null> {
    const resolvedPath = path.resolve(projectPath);
    const existing = this.activeServers.get(resolvedPath);
    if (existing) {
      this.emit({
        type: "preview_ready",
        port: existing.info.port,
        url: existing.info.url,
        backend_port: existing.info.backend_port,
        backend_url: existing.info.backend_url,
      });
      return existing.info;
    }

    const packageJsonPath = path.join(resolvedPath, "package.json");
    if (!fsSync.existsSync(packageJsonPath)) {
      return null;
    }

    console.log(`[DevServerManager] Starting dev server for ${resolvedPath} on port ${preferredPort}...`);

    let targetPort = preferredPort;
    const backendPort = 5001;

    // Launch Vite using bun
    const proc = Bun.spawn(["bun", "run", "dev:frontend"], {
      cwd: resolvedPath,
      env: {
        ...process.env,
        PORT: String(targetPort),
        BACKEND_PORT: String(backendPort),
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const info: DevServerInfo = {
      port: targetPort,
      url: `http://127.0.0.1:${targetPort}`,
      backend_port: backendPort,
      backend_url: `http://127.0.0.1:${backendPort}`,
      pid: proc.pid,
    };

    this.activeServers.set(resolvedPath, { proc, info });

    // Stream logs and detect ready URL
    (async () => {
      const reader = proc.stdout.getReader();
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
        });
      }
    }, 1500);

    return info;
  }

  stopDevServer(projectPath: string): void {
    const resolvedPath = path.resolve(projectPath);
    const entry = this.activeServers.get(resolvedPath);
    if (!entry) return;

    try {
      entry.proc.kill();
    } catch {
      // Process might already be dead
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
