import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { DevServerManager } from "../src/dev-server";

// Wait for a subprocess stdout to emit a specific marker line
async function waitForSubprocessOutput(proc: ReturnType<typeof Bun.spawn>, marker: string): Promise<void> {
  const reader = proc.stdout.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    if (buffer.includes(marker)) {
      reader.releaseLock();
      return;
    }
  }
}

describe("DevServerManager Process Reaper & Orphan Port Sweeper", () => {
  let devServerManager: DevServerManager;

  beforeAll(() => {
    devServerManager = new DevServerManager();
  });

  afterAll(async () => {
    await devServerManager.stopAll();
  });

  it("sweepOrphanedPorts detects and terminates unmanaged lingering processes on common dev ports", async () => {
    const testPort = 5005;

    // 1. Spawn a detached background process holding port 5005 outside DevServerManager
    // process.stdin.resume() keeps the process alive without timers
    const serverScript = `
const http = require('http');
http.createServer((req, res) => res.end('lingering ok')).listen(${testPort}, '127.0.0.1', () => {
  console.log('READY');
});
process.stdin.resume();
`;
    const orphanProc = Bun.spawn(["node", "-e", serverScript], {
      detached: true,
      stdout: "pipe",
      stderr: "ignore",
    });

    // Await deterministic signal from subprocess when port is actually bound
    await waitForSubprocessOutput(orphanProc, "READY");

    expect(await devServerManager.isPortListening(testPort)).toBe(true);
    expect(await devServerManager.isPortAvailable(testPort)).toBe(false);

    // 2. Run sweepOrphanedPorts()
    await devServerManager.sweepOrphanedPorts();

    // 3. Verify the orphan process was forcefully terminated and port 5005 is now completely free
    expect(await devServerManager.isPortListening(testPort)).toBe(false);
    expect(await devServerManager.isPortAvailable(testPort)).toBe(true);

    try {
      orphanProc.kill();
    } catch {}
  });

  it("handles multiple concurrent ports being held and frees all of them", async () => {
    const port1 = 5006;
    const port2 = 5007;

    const spawnHoldingServer = async (port: number) => {
      const script = `
const http = require('http');
http.createServer((req, res) => res.end('ok')).listen(${port}, '127.0.0.1', () => {
  console.log('READY');
});
process.stdin.resume();
`;
      const proc = Bun.spawn(["node", "-e", script], {
        detached: true,
        stdout: "pipe",
        stderr: "ignore",
      });
      await waitForSubprocessOutput(proc, "READY");
      return proc;
    };

    const p1 = await spawnHoldingServer(port1);
    const p2 = await spawnHoldingServer(port2);

    expect(await devServerManager.isPortListening(port1)).toBe(true);
    expect(await devServerManager.isPortListening(port2)).toBe(true);

    // Sweep all orphaned ports
    await devServerManager.sweepOrphanedPorts();

    // Verify both ports are freed
    expect(await devServerManager.isPortListening(port1)).toBe(false);
    expect(await devServerManager.isPortListening(port2)).toBe(false);
    expect(await devServerManager.isPortAvailable(port1)).toBe(true);
    expect(await devServerManager.isPortAvailable(port2)).toBe(true);

    try { p1.kill(); } catch {}
    try { p2.kill(); } catch {}
  });
});
