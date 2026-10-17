import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager } from "../../pi-harness/packages/coding-agent/src/index";
import type { DevServerManager } from "./dev-server";
export interface ProjectInfo {
  name: string;
  path: string;
  template: string;
  model?: string;
  status: "running" | "stopped";
  port: number | null;
  backend_port: number | null;
  pid: number | null;
  created_at: string;
  last_opened: string;
}

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  size?: number;
  children?: FileNode[];
}

const EXCLUDED_NAMES = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
  "dist",
  ".cache",
  ".vite",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".bmp",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".mp4",
  ".webm",
  ".mp3",
  ".wav",
  ".ogg",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
]);

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml",
  ".bmp": "image/bmp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
  ".otf": "font/otf",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
  ".json": "application/json",
  ".js": "application/javascript",
  ".jsx": "application/javascript",
  ".ts": "application/typescript",
  ".tsx": "application/typescript",
  ".css": "text/css",
  ".html": "text/html",
  ".md": "text/markdown",
  ".txt": "text/plain",
};

export const META_FILENAME = ".80degrees_meta.json";
export const CHAT_FILENAME = ".80degrees_chat.json";

export class ProjectManager {
  readonly root: string;
  readonly templatesDir: string;
  readonly templateCacheDir: string;
  private devServerManager: DevServerManager | null = null;

  constructor(options?: {
    root?: string;
    templatesDir?: string;
    templateCacheDir?: string;
    devServerManager?: DevServerManager;
  }) {
    this.devServerManager = options?.devServerManager ?? null;
    this.root = options?.root ?? process.env.PROJECTS_ROOT ?? path.join(os.homedir(), ".80degrees", "projects");
    this.templatesDir =
      options?.templatesDir ??
      process.env.TEMPLATES_DIR ??
      path.join(import.meta.dir, "..", "templates");
    this.templateCacheDir =
      options?.templateCacheDir ?? path.join(os.homedir(), ".80degrees", "template_cache");

    fsSync.mkdirSync(this.root, { recursive: true });
    fsSync.mkdirSync(this.templateCacheDir, { recursive: true });
  }
  setDevServerManager(manager: DevServerManager): void {
    this.devServerManager = manager;
  }

  private validateName(name: string): string {
    const cleaned = name.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-");
    if (!cleaned) throw new Error("Invalid project name");
    if (cleaned.length > 50) return cleaned.slice(0, 50);
    return cleaned;
  }

  suggestName(basePrompt: string = "app"): string {
    const words = basePrompt
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, "")
      .trim()
      .split(/\s+/)
      .slice(0, 4)
      .join("-");

    const candidate = words || "my-app";
    let slug = this.validateName(candidate);
    let counter = 2;
    let testPath = path.join(this.root, slug);

    while (fsSync.existsSync(testPath)) {
      slug = `${this.validateName(candidate)}-${counter}`;
      testPath = path.join(this.root, slug);
      counter++;
    }

    return slug;
  }

  async ensureTemplateCache(templateName: string = "node_react"): Promise<string> {
    const cachedTplDir = path.join(this.templateCacheDir, templateName);
    const cachedNodeModules = path.join(cachedTplDir, "node_modules");

    const osPlatform = process.platform === "win32" ? "win32" : process.platform === "darwin" ? "darwin" : "linux";
    const osArch = process.arch === "arm64" ? "arm64" : process.arch === "ia32" ? "ia32" : "x64";
    const esbuildPlatformPkg = `@esbuild/${osPlatform}-${osArch}`;

    // If cached node_modules exists, verify it is not a broken/read-only symlink pointing inside an .app bundle
    // and verify that the native compiler package (@esbuild) matches the current host platform/architecture
    if (fsSync.existsSync(cachedNodeModules)) {
      try {
        const stat = fsSync.lstatSync(cachedNodeModules);
        if (stat.isSymbolicLink()) {
          const linkTarget = fsSync.readlinkSync(cachedNodeModules);
          if (linkTarget.includes(".app/") || linkTarget.includes("Resources/backend/templates")) {
            console.log(`[ProjectManager] Removing read-only symlink in template cache: ${cachedNodeModules} -> ${linkTarget}`);
            fsSync.unlinkSync(cachedNodeModules);
          }
        }
      } catch {}

      const esbuildPkgPath = path.join(cachedNodeModules, esbuildPlatformPkg);
      if (fsSync.existsSync(cachedNodeModules) && fsSync.existsSync(esbuildPkgPath)) {
        this.repairBinSymlinks(cachedNodeModules);
        return cachedNodeModules;
      }
      console.log(`[ProjectManager] Template cache needs ${esbuildPlatformPkg} for ${process.platform}-${process.arch}, refreshing cache...`);
      try {
        fsSync.rmSync(cachedNodeModules, { recursive: true, force: true });
      } catch {}
    }

    const templateSrc = path.join(this.templatesDir, templateName);
    const srcNodeModules = path.join(templateSrc, "node_modules");
    const srcHasMatchingEsbuild = fsSync.existsSync(path.join(srcNodeModules, esbuildPlatformPkg));

    // If pre-installed template node_modules exists and matches current host architecture, copy to user-writable cache
    if (fsSync.existsSync(srcNodeModules) && srcHasMatchingEsbuild) {
      try {
        console.log(`[ProjectManager] Initializing writable template cache from ${srcNodeModules}...`);
        await fs.mkdir(cachedTplDir, { recursive: true });
        await this.copyDirRecursive(srcNodeModules, cachedNodeModules);
        this.repairBinSymlinks(cachedNodeModules);
        return cachedNodeModules;
      } catch (err) {
        console.warn(`[ProjectManager] Warning: failed to copy template node_modules to cache: ${err}`);
      }
    }

    const srcPackageJson = path.join(templateSrc, "package.json");
    if (fsSync.existsSync(srcPackageJson)) {
      await fs.mkdir(cachedTplDir, { recursive: true });
      await fs.copyFile(srcPackageJson, path.join(cachedTplDir, "package.json"));
      const srcLock = path.join(templateSrc, "bun.lock");
      if (fsSync.existsSync(srcLock)) {
        await fs.copyFile(srcLock, path.join(cachedTplDir, "bun.lock"));
      }
      console.log(`[ProjectManager] Installing template dependencies into cache (${cachedTplDir})...`);
      const bunBinDir = path.dirname(process.execPath);
      const augmentedPath = process.env.PATH?.includes(bunBinDir)
        ? process.env.PATH
        : `${bunBinDir}:${process.env.PATH || ""}`;
      const proc = Bun.spawn([process.execPath, "install"], {
        cwd: cachedTplDir,
        env: {
          ...process.env as Record<string, string>,
          PATH: augmentedPath,
        },
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
      this.repairBinSymlinks(cachedNodeModules);
    }

    return cachedNodeModules;
  }

  async createProject(name: string, template: string = "node_react", model?: string): Promise<ProjectInfo> {
    const validatedName = this.validateName(name);
    const projectDir = path.join(this.root, validatedName);

    if (fsSync.existsSync(projectDir)) {
      throw new Error(`Project "${validatedName}" already exists.`);
    }

    await fs.mkdir(projectDir, { recursive: true });

    // Copy template files
    const templateSrc = path.join(this.templatesDir, template);
    if (fsSync.existsSync(templateSrc)) {
      await this.copyDirRecursive(templateSrc, projectDir, ["node_modules", ".git"]);
    }

    // Link node_modules from user-writable cache for instant zero-install startup without read-only EROFS errors
    try {
      const targetLink = path.join(projectDir, "node_modules");
      const cachedNodeModules = await this.ensureTemplateCache(template);
      if (!fsSync.existsSync(targetLink)) {
        if (fsSync.existsSync(cachedNodeModules) && !fsSync.existsSync(targetLink)) {
          await fs.symlink(cachedNodeModules, targetLink, "junction");
        }
      } else {
        // If targetLink is a broken symlink, heal it
        try {
          const stat = fsSync.lstatSync(targetLink);
          if (stat.isSymbolicLink()) {
            const linkTarget = fsSync.readlinkSync(targetLink);
            if (!fsSync.existsSync(linkTarget) || !fsSync.existsSync(targetLink)) {
              fsSync.unlinkSync(targetLink);
              await fs.symlink(cachedNodeModules, targetLink, "junction");
            }
          }
        } catch {}
      }
    } catch (err) {
      console.warn(`[ProjectManager] Warning: failed to symlink template node_modules: ${err}`);
    }
    const now = new Date().toISOString();
    const project: ProjectInfo = {
      name: validatedName,
      path: projectDir,
      template,
      model: model || undefined,
      status: "stopped",
      port: null,
      backend_port: null,
      pid: null,
      created_at: now,
      last_opened: now,
    };
    await this.saveMeta(project);
    return project;
  }

  async getProject(name: string): Promise<ProjectInfo> {
    const validatedName = this.validateName(name);
    const projectDir = path.join(this.root, validatedName);

    if (!fsSync.existsSync(projectDir)) {
      throw new Error(`Project "${validatedName}" not found at ${projectDir}`);
    }

    const live = this.devServerManager?.getServerInfo(projectDir);
    const metaPath = path.join(projectDir, META_FILENAME);
    if (fsSync.existsSync(metaPath)) {
      try {
        const raw = await fs.readFile(metaPath, "utf-8");
        const meta = JSON.parse(raw);
        return {
          name: meta.name ?? validatedName,
          path: projectDir,
          template: meta.template ?? "node_react",
          model: meta.model ?? undefined,
          status: live ? "running" : (this.devServerManager ? "stopped" : (meta.status ?? "stopped")),
          port: live ? live.port : (this.devServerManager ? null : (meta.port ?? null)),
          backend_port: live ? live.backend_port : (this.devServerManager ? null : (meta.backend_port ?? null)),
          pid: live ? live.pid : null,
          created_at: meta.created_at ?? new Date().toISOString(),
          last_opened: meta.last_opened ?? new Date().toISOString(),
        };
      } catch {
        // Fall back to inferred project info
      }
    }

    return {
      name: validatedName,
      path: projectDir,
      template: "node_react",
      status: live ? "running" : "stopped",
      port: live ? live.port : null,
      backend_port: live ? live.backend_port : null,
      pid: live ? live.pid : null,
      created_at: new Date().toISOString(),
      last_opened: new Date().toISOString(),
    };
  }

  async getOrCreateProject(name: string, model?: string): Promise<ProjectInfo> {
    try {
      return await this.getProject(name);
    } catch {
      return await this.createProject(name, "node_react", model);
    }
  }

  async listProjects(): Promise<ProjectInfo[]> {
    const entries = await fs.readdir(this.root, { withFileTypes: true });
    const projects: ProjectInfo[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        const proj = await this.getProject(entry.name);
        projects.push(proj);
      } catch {
        // Skip unreadable directories
      }
    }

    projects.sort((a, b) => Date.parse(b.last_opened) - Date.parse(a.last_opened));
    return projects;
  }

  async deleteProject(name: string): Promise<void> {
    const validatedName = this.validateName(name);
    const projectDir = path.join(this.root, validatedName);
    if (fsSync.existsSync(projectDir)) {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
    try {
      const sessionDir = SessionManager.getDefaultSessionDir(projectDir);
      if (fsSync.existsSync(sessionDir)) {
        await fs.rm(sessionDir, { recursive: true, force: true });
      }
    } catch {}
  }

  async openInFinder(name: string): Promise<void> {
    const proj = await this.getProject(name);
    Bun.spawn(["open", proj.path], { stdout: "ignore", stderr: "ignore" });
  }

  async saveMeta(project: ProjectInfo): Promise<void> {
    const metaPath = path.join(project.path, META_FILENAME);
    const payload = {
      name: project.name,
      template: project.template,
      model: project.model,
      status: project.status,
      port: project.port,
      backend_port: project.backend_port ?? null,
      pid: project.pid,
      created_at: project.created_at,
      last_opened: project.last_opened,
    };
    await fs.writeFile(metaPath, JSON.stringify(payload, null, 2), "utf-8");
  }

  async updateMeta(name: string, updates: Partial<ProjectInfo>): Promise<ProjectInfo> {
    const current = await this.getProject(name);
    const updated: ProjectInfo = { ...current, ...updates, last_opened: new Date().toISOString() };
    await this.saveMeta(updated);
    return updated;
  }

  private async copyDirRecursive(src: string, dest: string, exclude: string[] = []): Promise<void> {
    try {
      await fs.cp(src, dest, {
        recursive: true,
        verbatimSymlinks: true,
        filter: (sourcePath) => {
          const name = path.basename(sourcePath);
          return !exclude.includes(name);
        },
      });
    } catch {
      await fs.mkdir(dest, { recursive: true });
      const entries = await fs.readdir(src, { withFileTypes: true });

      for (const entry of entries) {
        if (exclude.includes(entry.name)) continue;
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);

        if (entry.isDirectory()) {
          await this.copyDirRecursive(srcPath, destPath, exclude);
        } else if (entry.isSymbolicLink()) {
          try {
            const linkTarget = await fs.readlink(srcPath);
            await fs.symlink(linkTarget, destPath);
          } catch {
            await fs.copyFile(srcPath, destPath);
          }
        } else {
          await fs.copyFile(srcPath, destPath);
        }
      }
    }
  }

  private repairBinSymlinks(nodeModulesDir: string): void {
    try {
      const binDir = path.join(nodeModulesDir, ".bin");
      if (!fsSync.existsSync(binDir)) return;

      // Dynamically discover all declared binaries across all packages in node_modules
      const discoveredBins: Record<string, string> = {
        vite: "../vite/bin/vite.js",
        esbuild: "../esbuild/bin/esbuild",
        tailwindcss: "../tailwindcss/lib/cli.js",
        concurrently: "../concurrently/dist/bin/concurrently.js",
      };

      try {
        const topEntries = fsSync.readdirSync(nodeModulesDir, { withFileTypes: true });
        for (const entry of topEntries) {
          if (entry.name.startsWith(".")) continue;
          if (entry.isDirectory()) {
            if (entry.name.startsWith("@")) {
              try {
                const subEntries = fsSync.readdirSync(path.join(nodeModulesDir, entry.name), { withFileTypes: true });
                for (const sub of subEntries) {
                  if (!sub.isDirectory()) continue;
                  const pkgJsonPath = path.join(nodeModulesDir, entry.name, sub.name, "package.json");
                  if (fsSync.existsSync(pkgJsonPath)) {
                    const parsed = JSON.parse(fsSync.readFileSync(pkgJsonPath, "utf-8"));
                    if (parsed.bin) {
                      const binMap = typeof parsed.bin === "string" ? { [parsed.name?.split("/").pop() || sub.name]: parsed.bin } : parsed.bin;
                      for (const [binName, binRel] of Object.entries(binMap)) {
                        discoveredBins[binName] = path.join("..", entry.name, sub.name, String(binRel));
                      }
                    }
                  }
                }
              } catch {}
            } else {
              const pkgJsonPath = path.join(nodeModulesDir, entry.name, "package.json");
              if (fsSync.existsSync(pkgJsonPath)) {
                try {
                  const parsed = JSON.parse(fsSync.readFileSync(pkgJsonPath, "utf-8"));
                  if (parsed.bin) {
                    const binMap = typeof parsed.bin === "string" ? { [entry.name]: parsed.bin } : parsed.bin;
                    for (const [binName, binRel] of Object.entries(binMap)) {
                      discoveredBins[binName] = path.join("..", entry.name, String(binRel));
                    }
                  }
                } catch {}
              }
            }
          }
        }
      } catch {}

      // Ensure every binary in .bin is a working relative symbolic link
      for (const [name, relTarget] of Object.entries(discoveredBins)) {
        const targetFile = path.resolve(binDir, relTarget);
        if (fsSync.existsSync(targetFile)) {
          const bFile = path.join(binDir, name);
          let needsFix = true;
          if (fsSync.existsSync(bFile)) {
            try {
              const stat = fsSync.lstatSync(bFile);
              if (stat.isSymbolicLink()) {
                const currentLink = fsSync.readlinkSync(bFile);
                if (currentLink === relTarget) {
                  needsFix = false;
                }
              }
            } catch {}
          }
          if (needsFix) {
            try { fsSync.rmSync(bFile, { force: true }); } catch {}
            try {
              fsSync.symlinkSync(relTarget, bFile);
            } catch {}
          }
        }
      }
    } catch (err) {
      console.warn(`[ProjectManager] Warning: failed to repair .bin symlinks: ${err}`);
    }
  }
  private resolveSafePath(projectRoot: string, relativePath: string): string {
    const cleanRel = (relativePath || "").replace(/^(\/|\\)+/, "");
    const resolved = path.resolve(projectRoot, cleanRel);
    const rootWithSep = projectRoot.endsWith(path.sep) ? projectRoot : projectRoot + path.sep;
    if (resolved !== projectRoot && !resolved.startsWith(rootWithSep)) {
      throw new Error("Access denied: path outside project directory");
    }
    return resolved;
  }

  private async buildFileTree(rootDir: string, currentDir: string): Promise<FileNode[]> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    const nodes: FileNode[] = [];

    for (const entry of entries) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      if (entry.name.startsWith(".80degrees_")) continue;

      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootDir, fullPath);

      if (entry.isDirectory()) {
        const children = await this.buildFileTree(rootDir, fullPath);
        nodes.push({
          name: entry.name,
          path: relPath,
          type: "directory",
          children,
        });
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          nodes.push({
            name: entry.name,
            path: relPath,
            type: "file",
            size: stat.size,
          });
        } catch {
          nodes.push({
            name: entry.name,
            path: relPath,
            type: "file",
          });
        }
      }
    }

    nodes.sort((a, b) => {
      if (a.type === b.type) {
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      }
      return a.type === "directory" ? -1 : 1;
    });

    return nodes;
  }

  async getFileTree(name: string): Promise<FileNode[]> {
    const project = await this.getProject(name);
    return this.buildFileTree(project.path, project.path);
  }

  async readFile(name: string, relativePath: string): Promise<{
    path: string;
    name: string;
    content: string;
    isBinary: boolean;
    size: number;
    mimeType: string;
  }> {
    const project = await this.getProject(name);
    const safePath = this.resolveSafePath(project.path, relativePath);
    const stat = await fs.stat(safePath);
    if (stat.isDirectory()) {
      throw new Error("Cannot read directory as file");
    }

    const ext = path.extname(safePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || "text/plain";
    const isBinary = BINARY_EXTENSIONS.has(ext);

    if (isBinary) {
      const buffer = await fs.readFile(safePath);
      return {
        path: relativePath,
        name: path.basename(safePath),
        content: buffer.toString("base64"),
        isBinary: true,
        size: stat.size,
        mimeType,
      };
    }

    const content = await fs.readFile(safePath, "utf-8");
    return {
      path: relativePath,
      name: path.basename(safePath),
      content,
      isBinary: false,
      size: stat.size,
      mimeType,
    };
  }

  async writeFile(name: string, relativePath: string, content: string): Promise<{
    success: boolean;
    path: string;
    size: number;
  }> {
    const project = await this.getProject(name);
    const safePath = this.resolveSafePath(project.path, relativePath);
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, content, "utf-8");
    const stat = await fs.stat(safePath);
    return {
      success: true,
      path: relativePath,
      size: stat.size,
    };
  }

  async createFileOrDir(
    name: string,
    relativePath: string,
    type: "file" | "directory" = "file",
  ): Promise<{ success: boolean; path: string }> {
    const project = await this.getProject(name);
    const safePath = this.resolveSafePath(project.path, relativePath);
    if (fsSync.existsSync(safePath)) {
      throw new Error(`Target already exists: ${relativePath}`);
    }
    if (type === "directory") {
      await fs.mkdir(safePath, { recursive: true });
    } else {
      await fs.mkdir(path.dirname(safePath), { recursive: true });
      await fs.writeFile(safePath, "", "utf-8");
    }
    return { success: true, path: relativePath };
  }

  async deleteFileOrDir(name: string, relativePath: string): Promise<{ success: boolean; path: string }> {
    const project = await this.getProject(name);
    if (!relativePath || relativePath.trim() === "" || relativePath === "." || relativePath === "/") {
      throw new Error("Cannot delete project root");
    }
    const safePath = this.resolveSafePath(project.path, relativePath);
    if (!fsSync.existsSync(safePath)) {
      throw new Error(`Path does not exist: ${relativePath}`);
    }
    await fs.rm(safePath, { recursive: true, force: true });
    return { success: true, path: relativePath };
  }
}
