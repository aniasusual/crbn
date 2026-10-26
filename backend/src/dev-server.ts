import type { Subprocess } from "bun";
import * as path from "node:path";
import * as fsSync from "node:fs";
import * as os from "node:os";
import { getAugmentedPath } from "./runtime-env";
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

async function killSubprocessTree(proc?: Subprocess | null, timeoutMs: number = 1500): Promise<void> {
  if (!proc) return;
  const pid = proc.pid;
  try {
    proc.kill();
  } catch {}

  if (pid && pid > 0) {
    if (process.platform === "win32") {
      try {
        Bun.spawnSync(["taskkill", "/pid", String(pid), "/T", "/F"]);
      } catch {}
    } else {
      try {
        process.kill(pid, "SIGTERM");
      } catch {}
      try {
        process.kill(-pid, "SIGTERM");
      } catch {}

      await Promise.race([
        proc.exited,
        Bun.sleep(timeoutMs),
      ]);

      try {
        process.kill(pid, "SIGKILL");
      } catch {}
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    }
  }
}

function drainStream(stream?: ReadableStream<Uint8Array> | null, onData?: (text: string) => void): void {
  if (!stream) return;
  (async () => {
    try {
      const reader = stream.getReader();
      const decoder = onData ? new TextDecoder() : null;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (onData && value && decoder) {
          onData(decoder.decode(value, { stream: true }));
        }
      }
    } catch {}
  })();
}
const BRAND_BADGE_SNIPPET = `    <!-- 80degrees Platform Attribution Chip -->
    <style id="made-on-80degrees-style">
      #made-on-80degrees {
        position: fixed !important;
        bottom: 16px !important;
        right: 16px !important;
        z-index: 2147483647 !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 6px !important;
        margin: 0 !important;
        padding: 6px 12px 6px 10px !important;
        background-color: rgba(17, 17, 19, 0.92) !important;
        backdrop-filter: blur(12px) !important;
        -webkit-backdrop-filter: blur(12px) !important;
        border: none !important;
        outline: none !important;
        border-radius: 9999px !important;
        box-shadow: 0 6px 18px rgba(0, 0, 0, 0.22), 0 1px 3px rgba(0, 0, 0, 0.18) !important;
        text-decoration: none !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Plus Jakarta Sans", sans-serif !important;
        font-size: 11.5px !important;
        font-weight: 500 !important;
        line-height: 1 !important;
        color: rgba(255, 255, 255, 0.72) !important;
        cursor: pointer !important;
        transition: transform 0.15s ease, background-color 0.15s ease, box-shadow 0.15s ease, color 0.15s ease !important;
        user-select: none !important;
        -webkit-user-select: none !important;
        pointer-events: auto !important;
        box-sizing: border-box !important;
      }
      #made-on-80degrees:hover {
        background-color: rgba(26, 26, 30, 0.96) !important;
        color: #ffffff !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 10px 24px rgba(0, 0, 0, 0.28), 0 2px 4px rgba(0, 0, 0, 0.18) !important;
      }
      #made-on-80degrees:focus-visible {
        outline: 2px solid #B2451F !important;
        outline-offset: 2px !important;
      }
      #made-on-80degrees .degrees-badge-logo {
        width: 15px !important;
        height: 15px !important;
        display: block !important;
        flex-shrink: 0 !important;
      }
      #made-on-80degrees .degrees-badge-text {
        display: inline-block !important;
        white-space: nowrap !important;
      }
      #made-on-80degrees .degrees-badge-brand {
        font-weight: 600 !important;
        color: #ffffff !important;
        letter-spacing: -0.01em !important;
      }
      @media (max-width: 480px) {
        #made-on-80degrees {
          bottom: 10px !important;
          right: 10px !important;
          padding: 5px 10px 5px 8px !important;
          font-size: 11px !important;
        }
        #made-on-80degrees .degrees-badge-logo {
          width: 14px !important;
          height: 14px !important;
        }
      }
      @media print {
        #made-on-80degrees {
          display: none !important;
        }
      }
    </style>
    <a
      id="made-on-80degrees"
      href="https://80degrees.dev"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Made on 80degrees"
    >
      <svg class="degrees-badge-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" fill="none" aria-hidden="true">
        <path d="M 376 310 A 154 154 0 1 1 336 142" stroke="#B2451F" stroke-width="60" stroke-linecap="round" />
        <circle cx="424" cy="169" r="33" fill="#B2451F" />
      </svg>
      <span class="degrees-badge-text">Made on <span class="degrees-badge-brand">80degrees</span></span>
    </a>`;

function ensureBrandBadge(projectPath: string): void {
  try {
    const indexPath = path.join(projectPath, "index.html");
    if (!fsSync.existsSync(indexPath)) return;
    const content = fsSync.readFileSync(indexPath, "utf-8");
    if (content.includes('id="made-on-80degrees"')) return;

    let updated = content;
    if (content.includes("</body>")) {
      updated = content.replace("</body>", `${BRAND_BADGE_SNIPPET}\n  </body>`);
    } else {
      updated = `${content}\n${BRAND_BADGE_SNIPPET}`;
    }
    fsSync.writeFileSync(indexPath, updated, "utf-8");
  } catch {}
}

export class DevServerManager {
  private activeServers = new Map<string, {
    frontendProc: Subprocess;
    backendProc: Subprocess | null;
    info: DevServerInfo;
  }>();

  private reservedPorts = new Set<number>();

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
    const ports = new Set<number>(this.reservedPorts);
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
      const server1 = Bun.listen({
        port,
        hostname: "127.0.0.1",
        socket: {
          data() {},
        },
      });
      server1.stop(true);
    } catch {
      return false;
    }
    try {
      const server2 = Bun.listen({
        port,
        hostname: "0.0.0.0",
        socket: {
          data() {},
        },
      });
      server2.stop(true);
    } catch {
      return false;
    }
    return true;
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
        this.reservedPorts.add(p);
        return p;
      }
    }
    this.reservedPorts.add(startPort);
    return startPort;
  }

  detectBackendCommand(resolvedPath: string, scripts: Record<string, string>): string[] | null {
    const directServer = path.join(resolvedPath, "server", "index.js");
    if (fsSync.existsSync(directServer)) {
      return [process.execPath, "--watch", "server/index.js"];
    }
    if (scripts["dev:backend"]) {
      return [process.execPath, "run", "dev:backend"];
    }
    if (scripts["server"]) {
      return [process.execPath, "run", "server"];
    }
    if (scripts["api"]) {
      return [process.execPath, "run", "api"];
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
        return [process.execPath, "--watch", rel];
      }
    }

    return null;
  }


  async startDevServer(projectPath: string, preferredPort?: number, preferredBackendPort?: number): Promise<DevServerInfo | null> {
    const resolvedPath = path.resolve(projectPath);
    ensureBrandBadge(resolvedPath);
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

    const activePorts = new Set(
      Array.from(this.activeServers.values()).flatMap((s) =>
        [s.info.port, s.info.backend_port].filter(Boolean) as number[]
      )
    );
    let targetPort: number;
    if (preferredPort && !activePorts.has(preferredPort) && (await this.isPortAvailable(preferredPort))) {
      this.reservedPorts.add(preferredPort);
      targetPort = preferredPort;
    } else {
      targetPort = await this.findAvailablePort(3000, 3050);
    }

    let scripts: Record<string, string> = {};
    try {
      const rawPkg = fsSync.readFileSync(packageJsonPath, "utf-8");
      scripts = JSON.parse(rawPkg).scripts || {};
    } catch {}

    const frontendScript =
      ("dev:frontend" in scripts ? "dev:frontend" : null) ||
      ("dev" in scripts ? "dev" : null) ||
      ("start" in scripts ? "start" : null);
    if (!frontendScript) {
      console.log(`[DevServerManager] No runnable dev script found in ${packageJsonPath}`);
      return null;
    }

    const backendCmd = this.detectBackendCommand(resolvedPath, scripts);
    let backendPort: number | null = null;
    if (backendCmd) {
      if (preferredBackendPort && !activePorts.has(preferredBackendPort) && (await this.isPortAvailable(preferredBackendPort))) {
        this.reservedPorts.add(preferredBackendPort);
        backendPort = preferredBackendPort;
      } else {
        backendPort = await this.findAvailablePort(5001, 5099);
      }
    }

    console.log(`[DevServerManager] Starting frontend for ${resolvedPath} on port ${targetPort}...`);

    const projectBinDir = path.join(resolvedPath, "node_modules", ".bin");
    const augmentedPath = [projectBinDir, getAugmentedPath()].filter(Boolean).join(path.delimiter);

    const frontendEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      PATH: augmentedPath,
      PORT: String(targetPort),
      VITE_PORT: String(targetPort),
    };
    if (backendPort) {
      frontendEnv.BACKEND_PORT = String(backendPort);
      frontendEnv.VITE_BACKEND_PORT = String(backendPort);
    }

    // Launch frontend dev server: prefer project vite.js directly or run project dev script with explicit port
    const directViteJs = path.join(resolvedPath, "node_modules", "vite", "bin", "vite.js");
    let frontendCmd: string[];
    if (fsSync.existsSync(directViteJs)) {
      frontendCmd = [process.execPath, directViteJs, "--port", String(targetPort), "--strictPort"];
    } else {
      frontendCmd = [process.execPath, "run", frontendScript, "--", "--port", String(targetPort), "--strictPort"];
    }
    const frontendProc = Bun.spawn(frontendCmd, {
      cwd: resolvedPath,
      env: frontendEnv,
      stdout: "pipe",
      stderr: "pipe",
      detached: process.platform !== "win32",
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
            PATH: augmentedPath,
            PORT: String(backendPort),
            BACKEND_PORT: String(backendPort),
          },
          stdout: "pipe",
          stderr: "pipe",
          detached: process.platform !== "win32",
        });
        drainStream(backendProc.stdout);
        drainStream(backendProc.stderr, (text) => {
          if (text.includes("error") || text.includes("Error") || text.includes("EADDRINUSE")) {
            console.warn(`[DevServerManager] [${path.basename(resolvedPath)} backend stderr]:`, text.trim());
          }
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
    this.reservedPorts.delete(targetPort);
    if (backendPort) {
      this.reservedPorts.delete(backendPort);
    }

    frontendProc.exited.then((code) => {
      const entry = this.activeServers.get(resolvedPath);
      if (entry?.frontendProc === frontendProc) {
        console.warn(`[DevServerManager] Frontend for ${resolvedPath} exited with code ${code}`);
        this.stopDevServer(resolvedPath);
      }
    });

    if (backendProc) {
      const allocatedBackendPort = backendPort;
      backendProc.exited.then((code) => {
        const entry = this.activeServers.get(resolvedPath);
        if (entry?.backendProc === backendProc) {
          console.warn(`[DevServerManager] Backend for ${resolvedPath} exited with code ${code}`);
          entry.backendProc = null;
          entry.info.backend_port = null;
          entry.info.backend_url = null;
          entry.info.backend_pid = null;
          if (allocatedBackendPort) {
            this.reservedPorts.delete(allocatedBackendPort);
            void this.forceFreePort(allocatedBackendPort);
          }
        }
      });
    }
    let emittedReady = false;
    const emitReady = (port: number) => {
      if (emittedReady) return;
      emittedReady = true;
      info.port = port;
      info.url = `http://127.0.0.1:${port}`;
      this.emit({
        type: "preview_ready",
        port: info.port,
        url: info.url,
        backend_port: info.backend_port,
        backend_url: info.backend_url,
        project_path: resolvedPath,
      });
    };

    // Stream frontend logs and detect ready URL
    (async () => {
      const reader = frontendProc.stdout.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (!emittedReady) {
            const chunk = decoder.decode(value, { stream: true });
            buffer += chunk;

            // Check for Vite ready signal: e.g. "Local:   http://localhost:3000/" or "http://127.0.0.1:3000/"
            const match = /(?:http:\/\/(?:localhost|127\.0\.0\.1):)(\d+)/.exec(buffer);
            if (match) {
              const detectedPort = parseInt(match[1], 10);
              emitReady(detectedPort);
            }
          }
        }
      } catch {
        // Read stream ended
      }
    })();

    // Stream frontend stderr for error visibility
    (async () => {
      try {
        const errReader = frontendProc.stderr.getReader();
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = await errReader.read();
          if (done) break;
          const errText = decoder.decode(value, { stream: true });
          if (errText.includes("error") || errText.includes("failed") || errText.includes("Port")) {
            console.warn(`[DevServerManager] [${path.basename(resolvedPath)} stderr]:`, errText.trim());
          }
        }
      } catch {}
    })();

    // Actively poll until port is listening or detected via stdout
    (async () => {
      const startTime = Date.now();
      const maxWaitMs = 10000;
      while (Date.now() - startTime < maxWaitMs && !emittedReady) {
        if (!this.activeServers.has(resolvedPath)) break;
        if (await this.isPortListening(info.port)) {
          emitReady(info.port);
          break;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
    })();

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

    const needsFrontendProxySync = !entry.info.backend_port;
    const backendPort = entry.info.backend_port || (await this.findAvailablePort(5001, 5099));

    // Terminate existing dead or unresponsive backend process
    if (entry.backendProc) {
      await killSubprocessTree(entry.backendProc);
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
        detached: process.platform !== "win32",
      });
      drainStream(backendProc.stdout);
      drainStream(backendProc.stderr);

      entry.backendProc = backendProc;
      entry.info.backend_port = backendPort;
      entry.info.backend_url = `http://127.0.0.1:${backendPort}`;
      entry.info.backend_pid = backendProc.pid;
      // If frontend was started without backend knowledge, restart frontend dev server
      // so Vite's proxy configuration inherits the new BACKEND_PORT environment variable
      if (needsFrontendProxySync) {
        const frontendScript =
          ("dev:frontend" in scripts ? "dev:frontend" : null) ||
          ("dev" in scripts ? "dev" : null) ||
          ("start" in scripts ? "start" : null);
        if (frontendScript) {
          await killSubprocessTree(entry.frontendProc);
          const projectBinDir = path.join(resolvedPath, "node_modules", ".bin");
          const augmentedPath = [projectBinDir, getAugmentedPath()].filter(Boolean).join(path.delimiter);
          const frontendEnv: Record<string, string> = {
            ...process.env as Record<string, string>,
            PATH: augmentedPath,
            PORT: String(entry.info.port),
            VITE_PORT: String(entry.info.port),
            BACKEND_PORT: String(backendPort),
            VITE_BACKEND_PORT: String(backendPort),
          };
          const directViteJs = path.join(resolvedPath, "node_modules", "vite", "bin", "vite.js");
          let frontendCmd: string[];
          if (fsSync.existsSync(directViteJs)) {
            frontendCmd = [process.execPath, directViteJs, "--port", String(entry.info.port), "--strictPort"];
          } else {
            frontendCmd = [process.execPath, "run", frontendScript, "--", "--port", String(entry.info.port), "--strictPort"];
          }
          const newFrontendProc = Bun.spawn(frontendCmd, {
            cwd: resolvedPath,
            env: frontendEnv,
            stdout: "pipe",
            stderr: "pipe",
            detached: process.platform !== "win32",
          });
          drainStream(newFrontendProc.stdout);
          drainStream(newFrontendProc.stderr);
          entry.frontendProc = newFrontendProc;
          entry.info.pid = newFrontendProc.pid;
        }
      }
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
  private async forceFreePort(port?: number | null): Promise<void> {
    if (!port || port <= 0) return;
    const available = await this.isPortAvailable(port);
    if (available) return;

    console.warn(`[DevServerManager] Port ${port} still held after subprocess kill. Force-clearing port listener...`);
    try {
      if (process.platform === "win32") {
        const netstat = Bun.spawnSync(["cmd.exe", "/c", `netstat -ano | findstr :${port}`]).stdout.toString().trim();
        if (netstat) {
          for (const line of netstat.split(/\r?\n/)) {
            const parts = line.trim().split(/\s+/);
            const pidStr = parts[parts.length - 1];
            const pid = parseInt(pidStr, 10);
            if (pid && pid > 0 && pid !== process.pid) {
              try {
                Bun.spawnSync(["taskkill", "/pid", String(pid), "/T", "/F"]);
              } catch {}
            }
          }
        }
      } else {
        const out = Bun.spawnSync(["lsof", "-ti", `:${port}`]).stdout.toString().trim();
        if (out) {
          for (const pidStr of out.split(/\r?\n/)) {
            const pid = parseInt(pidStr, 10);
            if (pid && pid > 0 && pid !== process.pid) {
              try {
                process.kill(pid, "SIGKILL");
              } catch {}
            }
          }
        }
      }
    } catch {}
  }

  async stopDevServer(projectPath: string): Promise<void> {
    const resolvedPath = path.resolve(projectPath);
    const entry = this.activeServers.get(resolvedPath);
    if (!entry) return;

    this.activeServers.delete(resolvedPath);
    this.emit({ type: "preview_stopped", project_path: resolvedPath });

    const kills: Promise<void>[] = [killSubprocessTree(entry.frontendProc)];
    if (entry.backendProc) {
      kills.push(killSubprocessTree(entry.backendProc));
    }
    await Promise.all(kills);

    this.reservedPorts.delete(entry.info.port);
    if (entry.info.backend_port) {
      this.reservedPorts.delete(entry.info.backend_port);
    }

    await Promise.all([
      this.forceFreePort(entry.info.port),
      this.forceFreePort(entry.info.backend_port),
    ]);
  }

  async restartDevServer(projectPath: string): Promise<DevServerInfo | null> {
    const resolvedPath = path.resolve(projectPath);
    const existing = this.activeServers.get(resolvedPath);
    const preferredPort = existing?.info.port;
    const preferredBackendPort = existing?.info.backend_port ?? undefined;
    await this.stopDevServer(projectPath);

    if (preferredPort || preferredBackendPort) {
      for (let i = 0; i < 15; i++) {
        const p1 = preferredPort ? await this.isPortAvailable(preferredPort) : true;
        const p2 = preferredBackendPort ? await this.isPortAvailable(preferredBackendPort) : true;
        if (p1 && p2) break;
        await Bun.sleep(100);
      }
    }

    return await this.startDevServer(projectPath, preferredPort, preferredBackendPort);
  }

  async stopAll(): Promise<void> {
    const promises = Array.from(this.activeServers.keys()).map((p) => this.stopDevServer(p));
    await Promise.all(promises);
  }
}
