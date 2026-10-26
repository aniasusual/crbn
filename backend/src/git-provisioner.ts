import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { execSync, spawn } from "node:child_process";
import {
  getUserDataDir,
  getAugmentedPath,
  applyAugmentedPath,
  getAugmentedEnv,
} from "./runtime-env";

export interface GitStatus {
  installed: boolean;
  isPortable: boolean;
  path?: string;
  version?: string;
  error?: string;
  provisioning?: boolean;
  progress?: number;
  phase?: "idle" | "downloading" | "extracting" | "verifying" | "completed" | "error";
  message?: string;
}

export interface ProvisionProgress {
  phase: "downloading" | "extracting" | "verifying" | "completed" | "error";
  progress: number; // 0 - 100
  downloadedBytes?: number;
  totalBytes?: number;
  message?: string;
}

const MINGIT_URL =
  "https://github.com/git-for-windows/git/releases/download/v2.47.1.windows.1/MinGit-2.47.1-64-bit.zip";

let currentProvisioning: {
  promise: Promise<GitStatus>;
  state: ProvisionProgress;
} | null = null;

/**
 * Test whether a given git binary path is valid and executable.
 */
function testGitExecutable(gitPath: string): { ok: boolean; version?: string } {
  try {
    if (!fs.existsSync(gitPath)) return { ok: false };
    const out = execSync(`"${gitPath}" --version`, {
      encoding: "utf8",
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (out.toLowerCase().includes("git version")) {
      const match = /git\s+version\s+([0-9a-zA-Z._-]+)/i.exec(out);
      return { ok: true, version: match ? match[1] : out };
    }
  } catch {}
  return { ok: false };
}

/**
 * Fast-path check for existing host Git installation.
 * Honors existing user environment without triggering invasive prompts.
 */
export async function detectGit(): Promise<GitStatus> {
  applyAugmentedPath();
  const userData = getUserDataDir();

  // 1. Check portable Git if already provisioned by 80degrees
  if (process.platform === "win32") {
    const portableWinGit = path.join(userData, "bin", "mingit", "cmd", "git.exe");
    const test = testGitExecutable(portableWinGit);
    if (test.ok) {
      return {
        installed: true,
        isPortable: true,
        path: portableWinGit,
        version: test.version,
        phase: "completed",
      };
    }
  } else {
    const portableUnixGit = path.join(userData, "bin", "git", "bin", "git");
    const test = testGitExecutable(portableUnixGit);
    if (test.ok) {
      return {
        installed: true,
        isPortable: true,
        path: portableUnixGit,
        version: test.version,
        phase: "completed",
      };
    }
  }

  // 2. Check standard Homebrew / package manager locations on macOS
  if (process.platform === "darwin") {
    for (const p of ["/opt/homebrew/bin/git", "/usr/local/bin/git"]) {
      const test = testGitExecutable(p);
      if (test.ok) {
        return {
          installed: true,
          isPortable: false,
          path: p,
          version: test.version,
          phase: "completed",
        };
      }
    }

    // Verify if Xcode Command Line Tools are active
    try {
      const xcodePath = execSync("xcode-select -p", {
        encoding: "utf8",
        timeout: 2000,
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      if (xcodePath && fs.existsSync(xcodePath)) {
        const test = testGitExecutable("/usr/bin/git");
        if (test.ok) {
          return {
            installed: true,
            isPortable: false,
            path: "/usr/bin/git",
            version: test.version,
            phase: "completed",
          };
        }
      }
    } catch {}
  }

  // 3. Check system PATH lookup (where/which)
  try {
    const findCmd = process.platform === "win32" ? "where git.exe" : "which git";
    const foundPath = execSync(findCmd, {
      encoding: "utf8",
      timeout: 2000,
      env: getAugmentedEnv(),
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split(/\r?\n/)[0]
      ?.trim();

    if (foundPath) {
      // On macOS, guard against /usr/bin/git when Xcode CLI tools are NOT installed
      if (process.platform === "darwin" && foundPath === "/usr/bin/git") {
        try {
          execSync("xcode-select -p", { stdio: ["ignore", "ignore", "ignore"], timeout: 1500 });
        } catch {
          // Xcode tools absent - do not treat stub as installed
          return { installed: false, isPortable: false, phase: "idle" };
        }
      }

      const test = testGitExecutable(foundPath);
      if (test.ok) {
        return {
          installed: true,
          isPortable: false,
          path: foundPath,
          version: test.version,
          phase: "completed",
        };
      }
    }
  } catch {}

  // 4. Check well-known Windows install paths
  if (process.platform === "win32") {
    const progFiles = process.env.ProgramFiles || "C:\\Program Files";
    const progFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local");

    const winCandidates = [
      path.join(progFiles, "Git", "cmd", "git.exe"),
      path.join(progFilesX86, "Git", "cmd", "git.exe"),
      path.join(localAppData, "Programs", "Git", "cmd", "git.exe"),
      path.join(os.homedir(), "scoop", "apps", "git", "current", "cmd", "git.exe"),
    ];

    for (const cand of winCandidates) {
      const test = testGitExecutable(cand);
      if (test.ok) {
        return {
          installed: true,
          isPortable: false,
          path: cand,
          version: test.version,
          phase: "completed",
        };
      }
    }
  }

  return {
    installed: false,
    isPortable: false,
    phase: currentProvisioning ? currentProvisioning.state.phase : "idle",
    provisioning: Boolean(currentProvisioning),
    progress: currentProvisioning?.state.progress ?? 0,
    message: currentProvisioning?.state.message,
  };
}

/**
 * Download a file with progress reporting.
 */
async function downloadFileWithProgress(
  url: string,
  destPath: string,
  onProgress?: (loaded: number, total: number | undefined) => void
): Promise<void> {
  const res = await fetch(url, { signal: AbortSignal.timeout(300_000) });
  if (!res.ok) {
    throw new Error(`Failed to download ${url}: HTTP ${res.status} ${res.statusText}`);
  }
  if (!res.body) {
    throw new Error(`Download body was empty for ${url}`);
  }

  const contentLength = res.headers.get("content-length");
  const total = contentLength ? parseInt(contentLength, 10) : undefined;
  let loaded = 0;

  const reader = res.body.getReader();
  const fileWriter = Bun.file(destPath).writer();

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        await fileWriter.write(value);
        loaded += value.byteLength;
        onProgress?.(loaded, total);
      }
    }
    await fileWriter.end();
  } catch (err) {
    await fileWriter.end().catch(() => {});
    try {
      fs.unlinkSync(destPath);
    } catch {}
    throw err;
  }
}

/**
 * Provision portable MinGit on Windows.
 * Downloads official MinGit zip (~45MB) and extracts it into userData/bin/mingit.
 * No admin rights or external installers needed.
 */
async function provisionWindowsMinGit(
  onProgress?: (progress: ProvisionProgress) => void
): Promise<GitStatus> {
  const userData = getUserDataDir();
  const targetDir = path.join(userData, "bin", "mingit");
  fs.mkdirSync(targetDir, { recursive: true });

  const tmpZip = path.join(os.tmpdir(), `mingit-${Date.now()}.zip`);

  onProgress?.({
    phase: "downloading",
    progress: 5,
    message: "Downloading standalone Git package (MinGit)...",
  });

  await downloadFileWithProgress(MINGIT_URL, tmpZip, (loaded, total) => {
    const pct = total ? Math.min(85, Math.round((loaded / total) * 80) + 5) : 50;
    onProgress?.({
      phase: "downloading",
      progress: pct,
      downloadedBytes: loaded,
      totalBytes: total,
      message: `Downloading Git... ${Math.round(loaded / 1024 / 1024)} MB`,
    });
  });

  onProgress?.({
    phase: "extracting",
    progress: 88,
    message: "Extracting portable Git and POSIX tools...",
  });

  // Windows 10/11 includes built-in tar.exe which extracts zips
  try {
    execSync(`tar -xf "${tmpZip}" -C "${targetDir}"`, { stdio: "ignore", timeout: 60_000 });
  } catch (err) {
    // Fallback: PowerShell Expand-Archive
    try {
      execSync(
        `powershell -NoProfile -NonInteractive -Command "Expand-Archive -Path '${tmpZip}' -DestinationPath '${targetDir}' -Force"`,
        { stdio: "ignore", timeout: 90_000 }
      );
    } catch (fallbackErr) {
      throw new Error(`Failed to extract MinGit zip: ${err}`);
    }
  } finally {
    try {
      fs.unlinkSync(tmpZip);
    } catch {}
  }

  onProgress?.({
    phase: "verifying",
    progress: 96,
    message: "Verifying Git installation...",
  });

  applyAugmentedPath();
  const gitExe = path.join(targetDir, "cmd", "git.exe");
  const test = testGitExecutable(gitExe);

  if (!test.ok) {
    throw new Error(`MinGit extracted to ${targetDir} but git.exe failed execution verification.`);
  }

  onProgress?.({
    phase: "completed",
    progress: 100,
    message: `Portable Git ready (${test.version})`,
  });

  return {
    installed: true,
    isPortable: true,
    path: gitExe,
    version: test.version,
    phase: "completed",
    progress: 100,
  };
}

/**
 * Trigger or provision Git on macOS.
 */
async function provisionMacGit(
  onProgress?: (progress: ProvisionProgress) => void
): Promise<GitStatus> {
  onProgress?.({
    phase: "downloading",
    progress: 20,
    message: "Triggering Apple Command Line Developer Tools installer...",
  });

  try {
    spawn("xcode-select", ["--install"], { stdio: "ignore", detached: true }).unref();
  } catch (err) {
    throw new Error(`Failed to trigger Apple Developer Tools installation: ${err}`);
  }

  onProgress?.({
    phase: "verifying",
    progress: 50,
    message: "Apple Developer Tools installer launched. Please follow the system prompt.",
  });

  return {
    installed: false,
    isPortable: false,
    phase: "verifying",
    progress: 50,
    message: "Apple Developer Tools installer launched. Please complete the installation.",
  };
}

/**
 * Provision Git on Linux.
 */
async function provisionLinuxGit(
  onProgress?: (progress: ProvisionProgress) => void
): Promise<GitStatus> {
  onProgress?.({
    phase: "downloading",
    progress: 10,
    message: "Attempting package manager installation for Git...",
  });

  // Try pkexec apt-get or dnf if graphical elevation agent is present
  try {
    execSync("pkexec apt-get update && pkexec apt-get install -y git", {
      stdio: "ignore",
      timeout: 120_000,
    });
    const status = await detectGit();
    if (status.installed) {
      onProgress?.({
        phase: "completed",
        progress: 100,
        message: `Git installed (${status.version})`,
      });
      return status;
    }
  } catch {}

  throw new Error(
    "Automatic package installation requires sudo privileges. Please run: sudo apt install git"
  );
}

/**
 * Main entry point: install portable Git automatically.
 * Ensures deduplicated concurrent calls.
 */
export async function installGit(
  onProgress?: (progress: ProvisionProgress) => void
): Promise<GitStatus> {
  const existing = await detectGit();
  if (existing.installed) {
    onProgress?.({
      phase: "completed",
      progress: 100,
      message: `Git is already installed (${existing.version})`,
    });
    return existing;
  }

  if (currentProvisioning) {
    return currentProvisioning.promise;
  }

  const state: ProvisionProgress = {
    phase: "downloading",
    progress: 0,
    message: "Preparing Git installation...",
  };

  const progressHandler = (p: ProvisionProgress) => {
    state.phase = p.phase;
    state.progress = p.progress;
    state.message = p.message;
    state.downloadedBytes = p.downloadedBytes;
    state.totalBytes = p.totalBytes;
    onProgress?.(p);
  };

  const task = (async () => {
    try {
      if (process.platform === "win32") {
        return await provisionWindowsMinGit(progressHandler);
      } else if (process.platform === "darwin") {
        return await provisionMacGit(progressHandler);
      } else {
        return await provisionLinuxGit(progressHandler);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      progressHandler({
        phase: "error",
        progress: 0,
        message: msg,
      });
      return {
        installed: false,
        isPortable: false,
        phase: "error",
        progress: 0,
        error: msg,
      };
    } finally {
      currentProvisioning = null;
    }
  })();

  currentProvisioning = { promise: task, state };
  return task;
}

export function getCurrentProvisioningStatus(): ProvisionProgress | null {
  return currentProvisioning?.state ?? null;
}
