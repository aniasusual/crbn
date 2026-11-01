import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import { TemplateService } from "../src/templates/template-service";

describe("TemplateService & Template Architecture", () => {
  let tempDir: string;
  let templateService: TemplateService;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "80deg-tpl-test-"));
    templateService = new TemplateService({
      templatesDir: path.join(import.meta.dir, "..", "templates"),
      userTemplatesDir: path.join(tempDir, "user-templates"),
    });
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("discovers bundled node_react template with valid manifest", async () => {
    const templates = await templateService.listTemplates();
    expect(templates.length).toBeGreaterThanOrEqual(1);

    const nodeReact = templates.find((t) => t.id === "node_react");
    expect(nodeReact).toBeDefined();
    expect(nodeReact!.name).toBe("Web App");
    expect(nodeReact!.category).toBe("web");
    expect(nodeReact!.icon).toBe("globe");

    // mobile_expo is now discovered on disk as an active template
    const mobile = templates.find((t) => t.id === "mobile_expo");
    expect(mobile).toBeDefined();
    expect(mobile!.name).toBe("Mobile App");
    expect(mobile!.category).toBe("mobile");
    expect(Boolean(mobile!.comingSoon)).toBe(false);

    // Upcoming categories should also be listed for UI chips
    const unreal = templates.find((t) => t.id === "unreal_engine");
    expect(unreal).toBeDefined();
    expect(unreal!.comingSoon).toBe(true);
  });
  it("loads template manifest directly", async () => {
    const manifest = await templateService.getTemplate("node_react");
    expect(manifest).not.toBeNull();
    expect(manifest!.id).toBe("node_react");
    expect(manifest!.setup?.engine).toBe("bun");
    expect(manifest!.devServer?.type).toBe("web");
    expect(manifest!.aiRules).toBeDefined();
    expect(manifest!.aiRules!.length).toBeGreaterThan(0);
  });

  it("scaffolds template into target project without copying node_modules or .git", async () => {
    const projectDir = path.join(tempDir, "scaffolded-app");
    const manifest = await templateService.scaffoldProject("node_react", projectDir);

    expect(manifest.id).toBe("node_react");
    expect(fsSync.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "template.json"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "vite.config.js"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "src/App.jsx"))).toBe(true);

    // Verify node_modules and .git were NOT copied
    expect(fsSync.existsSync(path.join(projectDir, "node_modules"))).toBe(false);
    expect(fsSync.existsSync(path.join(projectDir, ".git"))).toBe(false);
  });

  it("scaffolds mobile_expo template into target project with Expo Router structure", async () => {
    const projectDir = path.join(tempDir, "scaffolded-mobile-app");
    const manifest = await templateService.scaffoldProject("mobile_expo", projectDir);

    expect(manifest.id).toBe("mobile_expo");
    expect(manifest.category).toBe("mobile");
    expect(manifest.devServer?.type).toBe("mobile");
    expect(fsSync.existsSync(path.join(projectDir, "package.json"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "template.json"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "app.json"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "app/_layout.tsx"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "app/index.tsx"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "server/index.js"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "assets/imagelogo.png"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectDir, "node_modules"))).toBe(false);
    expect(fsSync.existsSync(path.join(projectDir, ".git"))).toBe(false);
  });
});
