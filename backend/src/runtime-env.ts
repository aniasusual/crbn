import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";

let cachedUserDataDir: string | null = null;

export function getUserDataDir(): string {
  if (process.env.USER_DATA_DIR && fs.existsSync(process.env.USER_DATA_DIR)) {
    return process.env.USER_DATA_DIR;
  }
  if (cachedUserDataDir) return cachedUserDataDir;

  const home = os.homedir();
  let baseDir: string;

  if (process.platform === "win32") {
    baseDir = process.env.APPDATA || path.join(home, "AppData", "Roaming");
  } else if (process.platform === "darwin") {
    baseDir = path.join(home, "Library", "Application Support");
  } else {
    baseDir = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  }

  cachedUserDataDir = path.join(baseDir, "80degrees");
  try {
    fs.mkdirSync(cachedUserDataDir, { recursive: true });
  } catch {}
  return cachedUserDataDir;
}

export function getPortableGitPaths(): string[] {
  const userData = getUserDataDir();
  const paths: string[] = [];

  if (process.platform === "win32") {
    const mingitCmd = path.join(userData, "bin", "mingit", "cmd");
    const mingitUsrBin = path.join(userData, "bin", "mingit", "usr", "bin");
    const mingitBin = path.join(userData, "bin", "mingit", "bin");
    if (fs.existsSync(mingitCmd)) paths.push(mingitCmd);
    if (fs.existsSync(mingitUsrBin)) paths.push(mingitUsrBin);
    if (fs.existsSync(mingitBin)) paths.push(mingitBin);
  } else {
    const gitBin = path.join(userData, "bin", "git", "bin");
    const gitUsrBin = path.join(userData, "bin", "git", "usr", "bin");
    if (fs.existsSync(gitBin)) paths.push(gitBin);
    if (fs.existsSync(gitUsrBin)) paths.push(gitUsrBin);
  }

  return paths;
}

export function getBundledBinPaths(): string[] {
  const paths: string[] = [];

  // 1. Packaged Electron resourcesPath
  const resourcesPath = process.env.RESOURCES_PATH;
  if (resourcesPath) {
    const packagedBin = path.join(resourcesPath, "bin");
    if (fs.existsSync(packagedBin)) paths.push(packagedBin);
  }

  // 2. Development resources/bin
  const devResourcesBin = path.resolve(__dirname, "../../frontend/resources/bin");
  if (fs.existsSync(devResourcesBin)) paths.push(devResourcesBin);

  // 3. Executable directory of current Bun process
  const execDir = path.dirname(process.execPath);
  if (fs.existsSync(execDir)) paths.push(execDir);

  // 4. Default user bun bin
  const home = os.homedir();
  const userBunBin = path.join(home, ".bun", "bin");
  if (fs.existsSync(userBunBin)) paths.push(userBunBin);

  return paths;
}

export function getSystemBinaryPaths(): string[] {
  const paths: string[] = [];
  const home = os.homedir();

  if (process.platform === "win32") {
    const progFiles = process.env.ProgramFiles || "C:\\Program Files";
    const progFilesX86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");

    const winCandidates = [
      path.join(progFiles, "Git", "cmd"),
      path.join(progFiles, "Git", "usr", "bin"),
      path.join(progFiles, "Git", "bin"),
      path.join(progFilesX86, "Git", "cmd"),
      path.join(progFilesX86, "Git", "usr", "bin"),
      path.join(localAppData, "Programs", "Git", "cmd"),
      path.join(localAppData, "Programs", "Git", "usr", "bin"),
      path.join(home, "scoop", "apps", "git", "current", "cmd"),
      path.join(home, "scoop", "apps", "git", "current", "bin"),
      "C:\\Windows\\System32",
      "C:\\Windows",
    ];

    for (const c of winCandidates) {
      if (fs.existsSync(c)) paths.push(c);
    }
  } else {
    const unixCandidates = [
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/usr/bin",
      "/bin",
      "/usr/sbin",
      "/sbin",
      path.join(home, ".nvm/current/bin"),
      path.join(home, ".cargo/bin"),
    ];

    for (const c of unixCandidates) {
      if (fs.existsSync(c)) paths.push(c);
    }
  }

  return paths;
}

export function getAugmentedPath(): string {
  const priorityPaths = [
    ...getBundledBinPaths(),
    ...getPortableGitPaths(),
    ...getSystemBinaryPaths(),
  ];

  const existingPaths = (process.env.PATH || "")
    .split(path.delimiter)
    .map((p) => p.trim())
    .filter(Boolean);

  const seen = new Set<string>();
  const combined: string[] = [];

  for (const dir of [...priorityPaths, ...existingPaths]) {
    const normalized = path.normalize(dir);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      combined.push(dir);
    }
  }

  return combined.join(path.delimiter);
}

export function applyAugmentedPath(): void {
  process.env.PATH = getAugmentedPath();
}

export function getAugmentedEnv(extra?: Record<string, string>): Record<string, string> {
  const augmentedPath = getAugmentedPath();
  return {
    ...(process.env as Record<string, string>),
    PATH: augmentedPath,
    ...extra,
  };
}
