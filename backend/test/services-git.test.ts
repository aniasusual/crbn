import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { CheckpointManager } from "../src/checkpoint-manager";
import { GithubService } from "../src/github-service";
import { ProjectManager } from "../src/project-manager";

let tempDir: string;
let projectPath: string;

describe("Git Subprocess Execution via Services", () => {
  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "80deg-service-test-"));
    projectPath = path.join(tempDir, "test-repo");
    fs.mkdirSync(projectPath, { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("CheckpointManager.ensureGitRepo initializes clean git repository", async () => {
    const initialized = await CheckpointManager.ensureGitRepo(projectPath);
    expect(initialized).toBe(true);
    expect(fs.existsSync(path.join(projectPath, ".git"))).toBe(true);

    const checkpoints = await CheckpointManager.getCheckpoints(projectPath);
    expect(checkpoints.length).toBe(1);
    expect(checkpoints[0].step_id).toBe("step_0");
    expect(checkpoints[0].commit_hash.length).toBeGreaterThan(0);
  });

  it("CheckpointManager.createCheckpoint commits changes into git history", async () => {
    // Add a file
    fs.writeFileSync(path.join(projectPath, "app.js"), 'console.log("hello world");\n');

    const step = await CheckpointManager.createCheckpoint(projectPath, "Added app.js");
    expect(step).toBeDefined();
    expect(step?.step_id.startsWith("step_")).toBe(true);
    expect(step?.prompt).toBe("Added app.js");

    const checkpoints = await CheckpointManager.getCheckpoints(projectPath);
    expect(checkpoints.length).toBe(2);
  });

  it("GithubService.runGit executes git commands using augmented environment", async () => {
    const projectManager = new ProjectManager({ root: tempDir });
    const githubService = new GithubService(projectManager);

    const res = await githubService.runGit(projectPath, ["status", "--short"]);
    expect(res.exitCode).toBe(0);
    expect(typeof res.stdout).toBe("string");

    const logRes = await githubService.runGit(projectPath, ["log", "-n", "2", "--oneline"]);
    expect(logRes.exitCode).toBe(0);
    expect(logRes.stdout.includes("Added app.js")).toBe(true);
  });
});
