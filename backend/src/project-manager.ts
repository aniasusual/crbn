import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { SessionManager } from "../../pi-harness/packages/coding-agent/src/index";
export interface ProjectInfo {
  name: string;
  path: string;
  template: string;
  model?: string;
  status: "running" | "stopped";
  port: number | null;
  pid: number | null;
  created_at: string;
  last_opened: string;
}

export const META_FILENAME = ".lowkey_meta.json";
export const CHAT_FILENAME = ".lowkey_chat.json";

export class ProjectManager {
  readonly root: string;
  readonly templatesDir: string;
  readonly templateCacheDir: string;

  constructor(options?: { root?: string; templatesDir?: string; templateCacheDir?: string }) {
    this.root = options?.root ?? process.env.PROJECTS_ROOT ?? path.join(os.homedir(), ".lowkey", "projects");
    this.templatesDir =
      options?.templatesDir ?? path.join(import.meta.dir, "..", "templates");
    this.templateCacheDir =
      options?.templateCacheDir ?? path.join(os.homedir(), ".lowkey", "template_cache");

    fsSync.mkdirSync(this.root, { recursive: true });
    fsSync.mkdirSync(this.templateCacheDir, { recursive: true });
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

    if (fsSync.existsSync(cachedNodeModules)) {
      return cachedNodeModules;
    }

    const templateSrc = path.join(this.templatesDir, templateName);
    const srcPackageJson = path.join(templateSrc, "package.json");

    if (fsSync.existsSync(srcPackageJson)) {
      await fs.mkdir(cachedTplDir, { recursive: true });
      await fs.copyFile(srcPackageJson, path.join(cachedTplDir, "package.json"));
      console.log(`[ProjectManager] Installing template dependencies into cache (${cachedTplDir})...`);
      const proc = Bun.spawn(["bun", "install"], {
        cwd: cachedTplDir,
        stdout: "inherit",
        stderr: "inherit",
      });
      await proc.exited;
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

    // Link node_modules from cache for instant zero-install startup
    try {
      const cachedNodeModules = await this.ensureTemplateCache(template);
      if (fsSync.existsSync(cachedNodeModules)) {
        const targetLink = path.join(projectDir, "node_modules");
        if (!fsSync.existsSync(targetLink)) {
          await fs.symlink(cachedNodeModules, targetLink, "junction");
        }
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
          status: meta.status ?? "stopped",
          port: meta.port ?? null,
          pid: meta.pid ?? null,
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
      status: "stopped",
      port: null,
      pid: null,
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
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      if (exclude.includes(entry.name)) continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirRecursive(srcPath, destPath, exclude);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
