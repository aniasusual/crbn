import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs";
import * as os from "node:os";
import { CheckpointManager } from "../src/checkpoint-manager";
import { GithubService, parseGithubFullName } from "../src/github-service";
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

  it("parseGithubFullName correctly parses various GitHub repository URL formats", () => {
    expect(parseGithubFullName("owner/repo")).toBe("owner/repo");
    expect(parseGithubFullName("https://github.com/facebook/react")).toBe("facebook/react");
    expect(parseGithubFullName("https://github.com/facebook/react.git")).toBe("facebook/react");
    expect(parseGithubFullName("https://github.com/facebook/react/tree/main")).toBe("facebook/react");
    expect(parseGithubFullName("git@github.com:torvalds/linux.git")).toBe("torvalds/linux");
    expect(parseGithubFullName("   vercel/next.js   ")).toBe("vercel/next.js");
  });

  it("ProjectManager.importLocalProject imports local directory and configures project", async () => {
    const localExternalDir = path.join(tempDir, "my-external-folder");
    fs.mkdirSync(localExternalDir, { recursive: true });
    fs.writeFileSync(path.join(localExternalDir, "index.js"), 'console.log("external");\n');

    const projectManager = new ProjectManager({ root: path.join(tempDir, "workspace-projects") });
    const project = await projectManager.importLocalProject(localExternalDir, "custom-imported-app");

    expect(project.name).toBe("custom-imported-app");
    expect(project.template).toBe("local_import");
    expect(project.path).toBe(localExternalDir);
    expect(fs.existsSync(path.join(localExternalDir, ".git"))).toBe(true);
    expect(fs.existsSync(path.join(localExternalDir, ".80degrees_meta.json"))).toBe(true);

    // Verify deleting from workspace removes the symlink and leaves external directory intact
    await projectManager.deleteProject("custom-imported-app");
    expect(fs.existsSync(localExternalDir)).toBe(true);
    expect(fs.existsSync(path.join(localExternalDir, "index.js"))).toBe(true);
  });

  it("GithubService detects upstream remote and fork status in getProjectGitStatus", async () => {
    const forkDir = path.join(tempDir, "forked-repo");
    fs.mkdirSync(forkDir, { recursive: true });
    fs.writeFileSync(path.join(forkDir, "README.md"), "# Forked\n");

    const projectManager = new ProjectManager({ root: path.join(tempDir, "workspace-projects") });
    const project = await projectManager.importLocalProject(forkDir, "forked-repo");
    const githubService = new GithubService(projectManager);

    // Add origin and upstream remotes
    await githubService.runGit(forkDir, ["remote", "add", "origin", "https://github.com/my-user/cool-app.git"]);
    await githubService.runGit(forkDir, ["remote", "add", "upstream", "https://github.com/original-owner/cool-app.git"]);

    const status = await githubService.getProjectGitStatus("forked-repo");
    expect(status.github_repo).toBe("my-user/cool-app");
    expect(status.upstream_repo).toBe("original-owner/cool-app");
    expect(status.is_fork).toBe(true);
  });
});
