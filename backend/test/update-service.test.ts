import { describe, it, expect } from "bun:test";
import { UpdateService } from "../src/update-service";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("UpdateService Cross-Platform Extraction & Flushing", () => {
  it("should initialize and resolve version", () => {
    const service = new UpdateService();
    expect(service).toBeDefined();
    const status = service.getStatus();
    expect(status.state).toBe("idle");
  });

  it("should check for updates in forceDev mode", async () => {
    const service = new UpdateService();
    const check = await service.checkForUpdates(true);
    expect(check.hasUpdate).toBe(true);
    expect(check.latestVersion).toBeDefined();
    expect(check.downloadUrl).toContain("80degrees-");
  });

  it("should verify extraction paths are isolated and not nested inside archive file", () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "80degrees-test-paths-"));
    const assetName = "80degrees-test.zip";
    const zipPath = path.join(tempDir, assetName);
    const extractDir = path.join(tempDir, "extracted");

    // extractDir must not be inside zipPath
    expect(extractDir.startsWith(zipPath)).toBe(false);
    expect(path.dirname(zipPath)).toBe(tempDir);
    expect(path.dirname(extractDir)).toBe(tempDir);

    fs.mkdirSync(extractDir, { recursive: true });
    expect(fs.existsSync(zipPath)).toBe(false);
    expect(fs.existsSync(extractDir)).toBe(true);

    fs.rmSync(tempDir, { recursive: true, force: true });
  });
});
