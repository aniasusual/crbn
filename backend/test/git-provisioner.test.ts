import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  detectGit,
  installGit,
  getCurrentProvisioningStatus,
} from "../src/git-provisioner";

describe("git-provisioner", () => {
  it("detects system Git instantly on hosts where Git is already installed", async () => {
    const start = Date.now();
    const status = await detectGit();
    const elapsed = Date.now() - start;

    expect(status.installed).toBe(true);
    expect(status.isPortable).toBe(false);
    expect(typeof status.path).toBe("string");
    expect(fs.existsSync(status.path!)).toBe(true);
    expect(typeof status.version).toBe("string");
    expect(status.version!.length).toBeGreaterThan(0);
    // Fast path must complete quickly without network calls
    expect(elapsed).toBeLessThan(200);
  });

  it("detects portable Git installation when provisioned in userData directory", async () => {
    const tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), "80deg-git-test-"));
    const origUserData = process.env.USER_DATA_DIR;

    try {
      process.env.USER_DATA_DIR = tempUserData;

      // Create a mock portable git executable
      const portableBinDir =
        process.platform === "win32"
          ? path.join(tempUserData, "bin", "mingit", "cmd")
          : path.join(tempUserData, "bin", "git", "bin");
      fs.mkdirSync(portableBinDir, { recursive: true });

      const gitExePath = path.join(
        portableBinDir,
        process.platform === "win32" ? "git.cmd" : "git"
      );
      if (process.platform === "win32") {
        fs.writeFileSync(
          gitExePath,
          "@echo off\r\necho git version 2.47.1.portable\r\n"
        );
      } else {
        fs.writeFileSync(
          gitExePath,
          '#!/bin/sh\necho "git version 2.47.1.portable"\n',
          { mode: 0o755 }
        );
      }

      const status = await detectGit();
      expect(status.installed).toBe(true);
      expect(status.isPortable).toBe(true);
      expect(status.version).toBe("2.47.1.portable");
      expect(status.path).toBe(gitExePath);
    } finally {
      if (origUserData) {
        process.env.USER_DATA_DIR = origUserData;
      } else {
        delete process.env.USER_DATA_DIR;
      }
      fs.rmSync(tempUserData, { recursive: true, force: true });
    }
  });

  it("handles fast-path installGit() when Git is already present without downloading", async () => {
    let progressFired = false;
    const status = await installGit((p) => {
      progressFired = true;
      expect(p.phase).toBe("completed");
      expect(p.progress).toBe(100);
    });

    expect(status.installed).toBe(true);
    expect(progressFired).toBe(true);
    expect(getCurrentProvisioningStatus()).toBeNull();
  });

  it("deduplicates concurrent installGit calls without race conditions", async () => {
    const p1 = installGit();
    const p2 = installGit();

    const [res1, res2] = await Promise.all([p1, p2]);
    expect(res1.installed).toBe(true);
    expect(res2.installed).toBe(true);
    expect(res1.version).toBe(res2.version);
  });
});
