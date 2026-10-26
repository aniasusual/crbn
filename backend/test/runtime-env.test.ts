import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import {
  getUserDataDir,
  getAugmentedPath,
  getAugmentedEnv,
  getPortableGitPaths,
  getBundledBinPaths,
  getSystemBinaryPaths,
  applyAugmentedPath,
} from "../src/runtime-env";

describe("runtime-env", () => {
  it("resolves valid userData directory for the current platform", () => {
    const userData = getUserDataDir();
    expect(userData).toBeDefined();
    expect(typeof userData).toBe("string");
    expect(userData.length).toBeGreaterThan(0);
    expect(userData.endsWith("80degrees")).toBe(true);
    expect(fs.existsSync(userData)).toBe(true);
  });

  it("prioritizes bundled resources/bin and bun directories", () => {
    const bundledBins = getBundledBinPaths();
    expect(Array.isArray(bundledBins)).toBe(true);
    // Executable dir of Bun or dev resources/bin must exist
    expect(bundledBins.length).toBeGreaterThan(0);
    for (const binPath of bundledBins) {
      expect(fs.existsSync(binPath)).toBe(true);
    }
  });

  it("produces clean deduplicated augmented PATH", () => {
    const augmented = getAugmentedPath();
    expect(typeof augmented).toBe("string");
    expect(augmented.length).toBeGreaterThan(0);

    const parts = augmented.split(path.delimiter);
    expect(parts.length).toBeGreaterThan(1);

    // Verify deduplication
    const normalizedParts = parts.map((p) => path.normalize(p));
    const unique = new Set(normalizedParts);
    expect(normalizedParts.length).toBe(unique.size);
  });

  it("augments process.env.PATH without corrupting existing variables", () => {
    const originalPath = process.env.PATH;
    applyAugmentedPath();
    expect(process.env.PATH).toBe(getAugmentedPath());

    const env = getAugmentedEnv({ TEST_VAR: "80degrees_test" });
    expect(env.TEST_VAR).toBe("80degrees_test");
    expect(env.PATH).toBe(getAugmentedPath());
    expect(env.PATH.includes(path.delimiter)).toBe(true);
  });

  it("handles portable git paths when directories exist", () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "80deg-env-test-"));
    try {
      const origUserData = process.env.USER_DATA_DIR;
      process.env.USER_DATA_DIR = tempRoot;

      // Create fake portable git directory
      if (process.platform === "win32") {
        const mingitCmd = path.join(tempRoot, "bin", "mingit", "cmd");
        fs.mkdirSync(mingitCmd, { recursive: true });
        const paths = getPortableGitPaths();
        expect(paths.some((p) => p.includes("mingit"))).toBe(true);
      } else {
        const gitBin = path.join(tempRoot, "bin", "git", "bin");
        fs.mkdirSync(gitBin, { recursive: true });
        const paths = getPortableGitPaths();
        expect(paths.some((p) => p.includes("git"))).toBe(true);
      }

      if (origUserData) {
        process.env.USER_DATA_DIR = origUserData;
      } else {
        delete process.env.USER_DATA_DIR;
      }
    } finally {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});
