import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { getAugmentedEnv } from "../runtime-env";
import type {
  TemplateCategory,
  TemplateManifest,
  TemplateSummary,
} from "./template-types";

const EXCLUDED_ENTRIES: Record<string, true> = {
  node_modules: true,
  ".git": true,
  ".DS_Store": true,
  dist: true,
  ".cache": true,
  ".vite": true,
};

// Registered placeholders for upcoming templates to present in the horizontal chips UI
const UPCOMING_TEMPLATES: TemplateSummary[] = [
  {
    id: "unreal_engine",
    name: "Unreal Engine",
    category: "engine",
    description: "Unreal Engine 5 project skeleton with C++ and Blueprint stubs",
    icon: "joystick",
    placeholder: "Describe game mechanics, actors, or level logic in Unreal Engine...",
    tags: ["game", "unreal", "ue5", "c++"],
    comingSoon: true,
  },
  {
    id: "python_workflow",
    name: "AI Workflow",
    category: "workflow",
    description: "Backend AI automation and workflow pipelines with Python and FastAPI",
    icon: "workflow",
    placeholder: "Describe an AI automation workflow, API endpoints, or data pipeline...",
    tags: ["python", "ai", "fastapi", "workflow"],
    comingSoon: true,
  },
];

export class TemplateService {
  readonly templatesDir: string;
  readonly userTemplatesDir: string;
  private manifestCache = new Map<string, TemplateManifest>();

  constructor(options?: { templatesDir?: string; userTemplatesDir?: string }) {
    this.templatesDir =
      options?.templatesDir ??
      process.env.TEMPLATES_DIR ??
      path.join(import.meta.dir, "..", "..", "templates");

    this.userTemplatesDir =
      options?.userTemplatesDir ??
      path.join(os.homedir(), ".80degrees", "templates");

    try {
      fsSync.mkdirSync(this.userTemplatesDir, { recursive: true });
    } catch {}
  }

  /**
   * Resolve a template directory path by ID. Checks userTemplatesDir first, then bundled templatesDir.
   */
  resolveTemplateDir(templateId: string): string | null {
    const userDir = path.join(this.userTemplatesDir, templateId);
    if (fsSync.existsSync(userDir)) return userDir;

    const bundledDir = path.join(this.templatesDir, templateId);
    if (fsSync.existsSync(bundledDir)) return bundledDir;

    return null;
  }

  /**
   * Load and validate the template manifest.
   */
  async getTemplate(templateId: string): Promise<TemplateManifest | null> {
    if (this.manifestCache.has(templateId)) {
      return this.manifestCache.get(templateId)!;
    }

    const templateDir = this.resolveTemplateDir(templateId);
    if (!templateDir) return null;

    const manifestPath = path.join(templateDir, "template.json");
    let manifest: TemplateManifest;

    if (fsSync.existsSync(manifestPath)) {
      try {
        const raw = await fs.readFile(manifestPath, "utf-8");
        manifest = JSON.parse(raw);
      } catch (err) {
        console.warn(`[TemplateService] Error reading manifest at ${manifestPath}:`, err);
        return null;
      }
    } else {
      // Fallback for unmanifested templates (e.g. legacy node_react)
      manifest = {
        id: templateId,
        name: templateId === "node_react" ? "Web App" : templateId,
        version: "1.0.0",
        category: "web",
        description: "Full-stack React with Vite frontend and lightweight Node.js backend",
        icon: "globe",
        tags: ["web"],
        setup: {
          engine: "bun",
          command: ["bun", "install"],
        },
        devServer: {
          type: "web",
          frontend: {
            command: ["bun", "run", "dev"],
            portEnv: "PORT",
            defaultPort: 3000,
          },
          preview: {
            type: "iframe",
            brandBadge: true,
          },
        },
      };
    }

    this.manifestCache.set(templateId, manifest);
    return manifest;
  }

  /**
   * List all discovered templates + upcoming templates for UI chips.
   */
  async listTemplates(): Promise<TemplateSummary[]> {
    const summaries: TemplateSummary[] = [];
    const seenIds = new Set<string>();

    const scanDir = async (dir: string) => {
      if (!fsSync.existsSync(dir)) return;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory() || EXCLUDED_ENTRIES[entry.name]) continue;
          if (seenIds.has(entry.name)) continue;

          const manifest = await this.getTemplate(entry.name);
          if (manifest) {
            seenIds.add(manifest.id);
            summaries.push({
              id: manifest.id,
              name: manifest.name,
              category: manifest.category,
              description: manifest.description,
              icon: manifest.icon || "box",
              placeholder: manifest.placeholder,
              tags: manifest.tags || [],
              disabled: manifest.disabled,
              comingSoon: manifest.comingSoon,
            });
          }
        }
      } catch (err) {
        console.warn(`[TemplateService] Error scanning directory ${dir}:`, err);
      }
    };

    // Scan user templates first, then bundled
    await scanDir(this.userTemplatesDir);
    await scanDir(this.templatesDir);

    // If node_react wasn't picked up for any reason, ensure it exists
    if (!seenIds.has("node_react")) {
      summaries.unshift({
        id: "node_react",
        name: "Web App",
        category: "web",
        description: "Full-stack React with Vite frontend and lightweight Node.js backend",
        icon: "globe",
        placeholder: "Describe a web application, dashboard, or tool you'd like to build...",
        tags: ["react", "vite", "nodejs"],
      });
      seenIds.add("node_react");
    }

    // Append upcoming template placeholders for horizontal chip display
    for (const upcoming of UPCOMING_TEMPLATES) {
      if (!seenIds.has(upcoming.id)) {
        summaries.push(upcoming);
      }
    }

    return summaries;
  }

  /**
   * Scaffold template skeleton into target project directory.
   */
  async scaffoldProject(templateId: string, targetProjectDir: string): Promise<TemplateManifest> {
    const template = await this.getTemplate(templateId);
    if (!template) {
      throw new Error(`Template "${templateId}" not found.`);
    }

    const templateDir = this.resolveTemplateDir(templateId);
    if (!templateDir) {
      throw new Error(`Directory for template "${templateId}" not found on disk.`);
    }

    await fs.mkdir(targetProjectDir, { recursive: true });
    await this.copyDirRecursive(templateDir, targetProjectDir);

    return template;
  }

  /**
   * Install dependencies strictly inside the project directory (no shared cache).
   */
  async installDependencies(
    template: TemplateManifest,
    projectDir: string,
    onProgress?: (message: string) => void
  ): Promise<void> {
    if (!template.setup || template.setup.engine === "none" || !template.setup.command?.length) {
      return;
    }

    const cmd = template.setup.command;
    const executable = cmd[0] === "bun" ? process.execPath : cmd[0];
    const args = [executable, ...cmd.slice(1)];

    const statusMsg = `[TemplateService] Installing dependencies (${cmd.join(" ")}) in ${projectDir}...`;
    console.log(statusMsg);
    onProgress?.(statusMsg);

    const proc = Bun.spawn(args, {
      cwd: projectDir,
      env: getAugmentedEnv(),
      stdout: "pipe",
      stderr: "pipe",
    });

    (async () => {
      try {
        const reader = proc.stdout.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const clean = line.trim();
            if (clean) onProgress?.(clean);
          }
        }
      } catch {}
    })();

    (async () => {
      try {
        const reader = proc.stderr.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const clean = line.trim();
            if (clean && !clean.includes("warning")) {
              console.warn(`[TemplateService] [install stderr]:`, clean);
            }
          }
        }
      } catch {}
    })();
    const timeoutMs = template.setup.timeoutMs || 180000;
    const { promise: timeoutPromise, reject } = Promise.withResolvers<never>();
    const timer = setTimeout(() => {
      try {
        proc.kill();
      } catch {}
      reject(new Error(`Dependency installation timed out after ${timeoutMs / 1000}s`));
    }, timeoutMs);

    try {
      const exitCode = await Promise.race([proc.exited, timeoutPromise]);
      if (exitCode !== 0) {
        console.warn(`[TemplateService] Warning: dependency installation exited with code ${exitCode}`);
      } else {
        console.log(`[TemplateService] Dependencies successfully installed in ${projectDir}`);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Retrieve AI rules declared by the template.
   */
  async getTemplateAiRules(templateId: string): Promise<string[]> {
    const template = await this.getTemplate(templateId);
    return template?.aiRules || [];
  }

  private async copyDirRecursive(
    src: string,
    dest: string,
    exclude: Record<string, true> = EXCLUDED_ENTRIES
  ): Promise<void> {
    await fs.mkdir(dest, { recursive: true });
    const entries = await fs.readdir(src, { withFileTypes: true });

    for (const entry of entries) {
      if (exclude[entry.name]) continue;

      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);

      if (entry.isDirectory()) {
        await this.copyDirRecursive(srcPath, destPath, exclude);
      } else if (entry.isFile()) {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
