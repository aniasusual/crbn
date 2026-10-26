import { describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { execSync } from "node:child_process";

const BIN_DIR = path.resolve(__dirname, "../../frontend/resources/bin");

describe("Bun Node/npm/npx Shims", () => {
  it("verifies all expected shim files exist", () => {
    const requiredShims = [
      "node",
      "npm",
      "npx",
      "node.cmd",
      "npm.cmd",
      "npx.cmd",
    ];

    for (const shim of requiredShims) {
      const fullPath = path.join(BIN_DIR, shim);
      expect(fs.existsSync(fullPath)).toBe(true);
      const stat = fs.statSync(fullPath);
      expect(stat.size).toBeGreaterThan(0);
    }
  });

  it("executes JavaScript expressions via node shim", () => {
    const nodeBin = path.join(BIN_DIR, "node");
    const output = execSync(`"${nodeBin}" -e "console.log(JSON.stringify({ sum: 40 + 2 }))"`, {
      encoding: "utf8",
    }).trim();

    const parsed = JSON.parse(output);
    expect(parsed.sum).toBe(42);
  });

  it("forwards CLI arguments correctly through node shim", () => {
    const nodeBin = path.join(BIN_DIR, "node");
    const tmpScript = path.join(os.tmpdir(), `test-args-${Date.now()}.js`);
    try {
      fs.writeFileSync(tmpScript, "console.log(JSON.stringify(process.argv.slice(2)));\n");
      const output = execSync(`"${nodeBin}" "${tmpScript}" hello world 123`, {
        encoding: "utf8",
      }).trim();
      const args = JSON.parse(output);
      expect(args).toEqual(["hello", "world", "123"]);
    } finally {
      try { fs.unlinkSync(tmpScript); } catch {}
    }
  });

  it("forwards commands through npm and npx shims", () => {
    const npmBin = path.join(BIN_DIR, "npm");
    const npxBin = path.join(BIN_DIR, "npx");

    // npm --version should route to bun --version and exit 0
    const npmOut = execSync(`"${npmBin}" --version`, { encoding: "utf8" }).trim();
    expect(npmOut.length).toBeGreaterThan(0);

    // npx --version should route to bun --version and exit 0
    const npxOut = execSync(`"${npxBin}" --version`, { encoding: "utf8" }).trim();
    expect(npxOut.length).toBeGreaterThan(0);
  });

  it("verifies Windows batch shims have valid structure", () => {
    const nodeCmd = fs.readFileSync(path.join(BIN_DIR, "node.cmd"), "utf8");
    const npmCmd = fs.readFileSync(path.join(BIN_DIR, "npm.cmd"), "utf8");
    const npxCmd = fs.readFileSync(path.join(BIN_DIR, "npx.cmd"), "utf8");

    expect(nodeCmd.includes("@echo off")).toBe(true);
    expect(nodeCmd.includes("%~dp0\\bun.exe")).toBe(true);
    expect(nodeCmd.includes("%*")).toBe(true);

    expect(npmCmd.includes("install")).toBe(true);
    expect(npxCmd.includes("x %*")).toBe(true);
  });
});
