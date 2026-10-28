import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { getAugmentedEnv } from "./runtime-env";
import { detectGit, installGit } from "./git-provisioner";
export const CHECKPOINTS_FILENAME = ".80degrees_checkpoints.json";
export const BRANCHES_FILENAME = ".80degrees_branches.json";

export interface CheckpointStep {
  step_id: string;
  step_number: number;
  commit_hash: string;
  prompt: string;
  timestamp: string;
  entry_id?: string | null;
  has_context_reset?: boolean;
}

export interface ProjectBranch {
  id: string;
  name: string;
  git_branch: string;
  source_step_id: string;
  source_commit: string;
  created_at: string;
  parent_branch?: string | null;
  leaf_entry_id?: string | null;
}

export interface BranchStatePayload {
  active_branch: string;
  branches: ProjectBranch[];
}

export interface CheckpointsPayload {
  version: number;
  project_name: string;
  steps: CheckpointStep[];
  updated_at: string;
}

export class CheckpointManager {
  /**
   * Run a git command in the target project directory.
   */
  private static async runGit(
    projectPath: string,
    args: string[]
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const proc = Bun.spawn(["git", ...args], {
        cwd: projectPath,
        stdout: "pipe",
        stderr: "pipe",
        env: getAugmentedEnv({
          GIT_TERMINAL_PROMPT: "0",
        }),
      });

      const stdoutPromise = new Response(proc.stdout).text().catch(() => "");
      const stderrPromise = new Response(proc.stderr).text().catch(() => "");
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
      await proc.exited;

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: proc.exitCode ?? 0,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { stdout: "", stderr: msg, exitCode: 1 };
    }
  }

  /**
   * Ensure the project directory is a clean Git repository with an initial commit.
   */
  static async ensureGitRepo(projectPath: string): Promise<boolean> {
    const gitDir = path.join(projectPath, ".git");

    if (!fsSync.existsSync(gitDir)) {
      const gitCheck = await detectGit().catch(() => ({ installed: false }));
      if (!gitCheck.installed) {
        console.log("[CheckpointManager] Git not ready yet. Awaiting automated Git provisioning...");
        await installGit().catch(() => {});
      }
      // 1. Ensure minimal .gitignore
      const gitignorePath = path.join(projectPath, ".gitignore");
      if (!fsSync.existsSync(gitignorePath)) {
        const defaultIgnore = [
          "node_modules",
          ".DS_Store",
          "dist",
          "*.log",
          ".80degrees_chat.json", // Don't track chat history in git commits to avoid self-conflicts
          ".80degrees_checkpoints.json",
          ".80degrees_branches.json",
          ".80degrees_meta.json",
        ].join("\n") + "\n";
        await fs.writeFile(gitignorePath, defaultIgnore, "utf-8");
      }

      // 2. Initialize git repo
      await this.runGit(projectPath, ["init"]);
      await this.runGit(projectPath, ["config", "user.name", "80degrees"]);
      await this.runGit(projectPath, ["config", "user.email", "agent@80degrees.local"]);
      await this.runGit(projectPath, ["add", "-A"]);
      await this.runGit(projectPath, ["commit", "-m", "Initial project state", "--allow-empty"]);

      const initialHashRes = await this.runGit(projectPath, ["rev-parse", "HEAD"]);
      const initialHash = initialHashRes.stdout || "init";

      // 3. Save initial checkpoint
      const now = new Date().toISOString();
      const initialStep: CheckpointStep = {
        step_id: "step_0",
        step_number: 0,
        commit_hash: initialHash,
        prompt: "Initial Project State",
        timestamp: now,
      };

      await this.saveCheckpoints(projectPath, [initialStep]);
      return true;
    }

    return false;
  }

  /**
   * Load all recorded checkpoint steps for a project.
   */
  static async getCheckpoints(projectPath: string): Promise<CheckpointStep[]> {
    const filePath = path.join(projectPath, CHECKPOINTS_FILENAME);
    if (!fsSync.existsSync(filePath)) {
      await this.ensureGitRepo(projectPath);
    }

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const data = JSON.parse(raw) as CheckpointsPayload;
      if (Array.isArray(data.steps) && data.steps.length > 0) {
        return data.steps;
      }
    } catch {}

    // If file still doesn't exist or had empty steps but .git exists, seed from HEAD
    if (fsSync.existsSync(path.join(projectPath, ".git"))) {
      const hashRes = await this.runGit(projectPath, ["rev-parse", "HEAD"]);
      const initialHash = hashRes.stdout || "init";
      const initialStep: CheckpointStep = {
        step_id: "step_0",
        step_number: 0,
        commit_hash: initialHash,
        prompt: "Initial Repository State",
        timestamp: new Date().toISOString(),
      };
      await this.saveCheckpoints(projectPath, [initialStep]);
      return [initialStep];
    }

    return [];
  }

  /**
   * Save checkpoint steps to disk.
   */
  private static async saveCheckpoints(projectPath: string, steps: CheckpointStep[]): Promise<void> {
    const filePath = path.join(projectPath, CHECKPOINTS_FILENAME);
    const projectName = path.basename(projectPath);
    const payload: CheckpointsPayload = {
      version: 1,
      project_name: projectName,
      steps,
      updated_at: new Date().toISOString(),
    };
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  /**
   * Commit working tree changes and append a new checkpoint step.
   */
  static async createCheckpoint(
    projectPath: string,
    promptText: string,
    entryId?: string | null,
  ): Promise<CheckpointStep | null> {
    await this.ensureGitRepo(projectPath);

    // Check if there are changes to commit
    const statusRes = await this.runGit(projectPath, ["status", "--porcelain"]);
    const hasChanges = statusRes.stdout.length > 0;

    const currentSteps = await this.getCheckpoints(projectPath);
    const nextStepNumber = currentSteps.length;
    const now = new Date().toISOString();
    const stepId = `step_${Date.now()}`;

    const promptSummary = (promptText || "App update")
      .trim()
      .slice(0, 70)
      .replace(/[\n\r]+/g, " ");

    if (hasChanges) {
      await this.runGit(projectPath, ["add", "-A"]);
      await this.runGit(projectPath, ["commit", "-m", `Turn ${nextStepNumber}: ${promptSummary}`]);
    }

    const hashRes = await this.runGit(projectPath, ["rev-parse", "HEAD"]);
    const commitHash = hashRes.stdout;
    if (!commitHash) return null;

    let hasContextReset = false;
    try {
      const history = await ChatHistoryManager.loadHistory(projectPath, undefined, { raw: true });
      const lastReset = history.ui_events.findLast((ev) => ev.type === "reset_boundary");
      if (lastReset && typeof lastReset.timestamp === "string") {
        const lastStepTime = currentSteps[currentSteps.length - 1]?.timestamp;
        const resetTime = new Date(lastReset.timestamp).getTime();
        const stepTime = lastStepTime ? new Date(lastStepTime).getTime() : 0;
        if (resetTime > stepTime) {
          hasContextReset = true;
        }
      }
    } catch {}

    const newStep: CheckpointStep = {
      step_id: stepId,
      step_number: nextStepNumber,
      commit_hash: commitHash,
      prompt: promptSummary,
      timestamp: now,
      entry_id: entryId ?? null,
      has_context_reset: hasContextReset,
    };

    currentSteps.push(newStep);
    await this.saveCheckpoints(projectPath, currentSteps);
    console.log(`[CheckpointManager] Created checkpoint ${stepId} (commit ${commitHash.slice(0, 8)}) for ${path.basename(projectPath)}`);
    return newStep;
  }

  /**
   * Roll back the filesystem to a target checkpoint step.
   */
  static async rewindToStep(
    projectPath: string,
    targetStepId: string,
    options?: { rollbackCode?: boolean },
  ): Promise<{
    success: boolean;
    targetStep: CheckpointStep;
    remainingSteps: CheckpointStep[];
    error?: string;
  }> {
    const steps = await this.getCheckpoints(projectPath);
    const targetIndex = steps.findIndex((s) => s.step_id === targetStepId);

    if (targetIndex === -1) {
      throw new Error(`Checkpoint step "${targetStepId}" not found in project history.`);
    }

    const targetStep = steps[targetIndex];
    const rollbackCode = options?.rollbackCode !== false;

    console.log(
      `[CheckpointManager] Rolling back ${path.basename(projectPath)} to ${targetStepId} (commit ${targetStep.commit_hash.slice(0, 8)}, rollbackCode=${rollbackCode})...`
    );

    if (rollbackCode) {
      // 1. Hard reset git working tree to commit
      const resetRes = await this.runGit(projectPath, ["reset", "--hard", targetStep.commit_hash]);
      if (resetRes.exitCode !== 0) {
        throw new Error(`Git reset failed: ${resetRes.stderr}`);
      }

      // 2. Clean untracked files added after this checkpoint
      await this.runGit(projectPath, ["clean", "-fd"]);
    }
    // 3. Prune newer checkpoints, keeping history up to target step
    const remainingSteps = steps.slice(0, targetIndex + 1);
    await this.saveCheckpoints(projectPath, remainingSteps);

    console.log(`[CheckpointManager] Successfully rolled back to ${targetStepId}`);
    return {
      success: true,
      targetStep,
      remainingSteps,
    };
  }

  /**
   * Get all branches and active branch for a project.
   */
  static async getBranches(projectPath: string): Promise<BranchStatePayload> {
    await this.ensureGitRepo(projectPath);
    const filePath = path.join(projectPath, BRANCHES_FILENAME);

    if (fsSync.existsSync(filePath)) {
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const data = JSON.parse(raw) as BranchStatePayload;
        if (Array.isArray(data.branches) && data.branches.length > 0) {
          return data;
        }
      } catch {}
    }

    // Default initial branch state
    const currentGit = await this.getCurrentGitBranch(projectPath);
    const steps = await this.getCheckpoints(projectPath);
    const initialHash = steps[0]?.commit_hash || "init";
    const now = new Date().toISOString();

    const branchListRes = await this.runGit(projectPath, ["branch", "--list", "--format=%(refname:short)"]);
    const rawBranchNames = branchListRes.stdout
      ? branchListRes.stdout.split("\n").map((b) => b.trim()).filter(Boolean)
      : [currentGit || "main"];
    const allNames = Array.from(new Set([currentGit || "main", ...rawBranchNames]));

    const initialPayload: BranchStatePayload = {
      active_branch: currentGit || "main",
      branches: allNames.map((bName, idx) => ({
        id: `b_${bName}_${idx}`,
        name: bName,
        git_branch: bName,
        source_step_id: "step_0",
        source_commit: initialHash,
        created_at: now,
        leaf_entry_id: steps[steps.length - 1]?.entry_id ?? null,
      })),
    };

    await this.saveBranches(projectPath, initialPayload);
    return initialPayload;
  }

  /**
   * Persist branches metadata to disk.
   */
  static async saveBranches(projectPath: string, payload: BranchStatePayload): Promise<void> {
    const filePath = path.join(projectPath, BRANCHES_FILENAME);
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  /**
   * Get the active Git branch name on disk.
   */
  static async getCurrentGitBranch(projectPath: string): Promise<string> {
    const res = await this.runGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    return res.stdout || "main";
  }

  /**
   * Sanitize user input into a safe, valid Git branch ref.
   */
  static sanitizeGitBranchName(name: string): string {
    const cleaned = (name || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 40);
    const base = cleaned || "experiment";
    return base === "main" || base.startsWith("b-") ? base : `b-${base}`;
  }

  /**
   * Commit any pending uncommitted changes on current branch before switching.
   */
  static async commitPendingChanges(projectPath: string, message?: string): Promise<string | null> {
    const statusRes = await this.runGit(projectPath, ["status", "--porcelain"]);
    if (statusRes.stdout.trim().length > 0) {
      await this.runGit(projectPath, ["add", "-A"]);
      const msg = message || `WIP: Auto-commit before branch transition at ${new Date().toISOString()}`;
      await this.runGit(projectPath, ["commit", "-m", msg]);
    }
    const hashRes = await this.runGit(projectPath, ["rev-parse", "HEAD"]);
    return hashRes.stdout || null;
  }

  /**
   * Create a new branch from a given checkpoint step and switch to it.
   */
  static async createBranch(
    projectPath: string,
    branchName: string,
    fromStepId: string,
    leafEntryId?: string | null,
    fromBranch?: string,
  ): Promise<ProjectBranch> {
    await this.ensureGitRepo(projectPath);
    const state = await this.getBranches(projectPath);
    const rawName = branchName.trim() || `exp-${Date.now().toString().slice(-4)}`;

    // Auto-deduplicate branch name if it already exists
    let finalName = rawName;
    let counter = 2;
    while (state.branches.some((b) => b.name.toLowerCase() === finalName.toLowerCase())) {
      finalName = `${rawName}-${counter}`;
      counter++;
    }
    const parentBranchName = fromBranch || state.active_branch || "main";

    // 1. Commit any in-flight changes on active branch so work isn't lost
    await this.commitPendingChanges(projectPath, `WIP on ${state.active_branch}`);

    // 2. Resolve source commit from checkpoint or parent branch HEAD
    const steps = await this.getCheckpoints(projectPath);
    let targetStep = steps.find((s) => s.step_id === fromStepId);
    let targetCommit: string | null = targetStep?.commit_hash || null;
    let targetStepId = targetStep?.step_id || fromStepId;

    if (!targetCommit && fromBranch) {
      const parentBranchObj = state.branches.find(
        (b) => b.name === fromBranch || b.git_branch === fromBranch
      );
      if (parentBranchObj) {
        const revRes = await this.runGit(projectPath, ["rev-parse", parentBranchObj.git_branch]);
        if (revRes.exitCode === 0 && revRes.stdout) {
          targetCommit = revRes.stdout;
        }
      }
    }

    if (!targetCommit) {
      const fallback = steps[steps.length - 1];
      targetCommit = fallback?.commit_hash || null;
      targetStepId = fallback?.step_id || "step_0";
    }

    if (!targetCommit) {
      throw new Error(`Target checkpoint "${fromStepId}" has no valid Git commit.`);
    }
    // 3. Create and checkout the Git branch
    const gitBranch = this.sanitizeGitBranchName(finalName);
    const checkoutRes = await this.runGit(projectPath, ["checkout", "-b", gitBranch, targetCommit]);
    if (checkoutRes.exitCode !== 0) {
      const fallback = await this.runGit(projectPath, ["checkout", gitBranch]);
      if (fallback.exitCode !== 0) {
        throw new Error(`Failed to create Git branch "${gitBranch}": ${checkoutRes.stderr}`);
      }
    }

    const newBranch: ProjectBranch = {
      id: `b_${Date.now()}`,
      name: finalName,
      git_branch: gitBranch,
      source_step_id: targetStepId,
      source_commit: targetCommit,
      created_at: new Date().toISOString(),
      parent_branch: parentBranchName,
      leaf_entry_id: leafEntryId ?? null,
    };
    state.branches.push(newBranch);
    state.active_branch = finalName;
    await this.saveBranches(projectPath, state);

    console.log(`[CheckpointManager] Created & switched to branch "${finalName}" (${gitBranch}) from ${targetStep?.step_id ?? "initial"}`);
    return newBranch;
  }

  /**
   * Switch to an existing branch.
   */
  static async switchBranch(projectPath: string, branchName: string): Promise<ProjectBranch> {
    await this.ensureGitRepo(projectPath);
    const state = await this.getBranches(projectPath);
    const target = state.branches.find((b) => b.name.toLowerCase() === branchName.toLowerCase());

    if (!target) {
      throw new Error(`Branch "${branchName}" not found in project.`);
    }

    if (state.active_branch === target.name) {
      return target;
    }

    // 1. Commit any in-flight changes on the current branch
    await this.commitPendingChanges(projectPath, `WIP on ${state.active_branch}`);

    // 2. Checkout target Git branch (with main/master fallback)
    let checkoutRes = await this.runGit(projectPath, ["checkout", target.git_branch]);
    if (checkoutRes.exitCode !== 0 && target.git_branch === "main") {
      checkoutRes = await this.runGit(projectPath, ["checkout", "master"]);
      if (checkoutRes.exitCode === 0) {
        target.git_branch = "master";
      }
    } else if (checkoutRes.exitCode !== 0 && target.git_branch === "master") {
      checkoutRes = await this.runGit(projectPath, ["checkout", "main"]);
      if (checkoutRes.exitCode === 0) {
        target.git_branch = "main";
      }
    }

    if (checkoutRes.exitCode !== 0) {
      throw new Error(`Git checkout failed for "${target.git_branch}": ${checkoutRes.stderr}`);
    }

    // 3. Update active branch
    state.active_branch = target.name;
    await this.saveBranches(projectPath, state);

    console.log(`[CheckpointManager] Switched active branch to "${target.name}" (${target.git_branch})`);
    return target;
  }

  /**
   * Delete an existing non-active branch.
   */
  static async deleteBranch(projectPath: string, branchName: string): Promise<void> {
    await this.ensureGitRepo(projectPath);
    const state = await this.getBranches(projectPath);
    const target = state.branches.find((b) => b.name.toLowerCase() === branchName.toLowerCase());

    if (!target) {
      throw new Error(`Branch "${branchName}" not found.`);
    }
    if (target.name === "main") {
      throw new Error("Cannot delete main branch.");
    }
    if (target.name === state.active_branch) {
      throw new Error("Cannot delete currently active branch. Switch to another branch first.");
    }

    // Delete git branch
    await this.runGit(projectPath, ["branch", "-D", target.git_branch]);

    state.branches = state.branches.filter((b) => b.id !== target.id);
    await this.saveBranches(projectPath, state);
    console.log(`[CheckpointManager] Deleted branch "${branchName}" (${target.git_branch})`);
  }

  /**
   * Update the recorded pi-harness leaf pointer for a branch.
   */
  static async updateBranchLeaf(projectPath: string, branchName: string, leafEntryId: string): Promise<void> {
    try {
      const state = await this.getBranches(projectPath);
      const b = state.branches.find((x) => x.name === branchName);
      if (b) {
        b.leaf_entry_id = leafEntryId;
        await this.saveBranches(projectPath, state);
      }
    } catch {}
  }

  /**
   * Get full branch tree graph with parent/child links and checkpoint steps.
   */
  static async getBranchTree(projectPath: string): Promise<{
    active_branch: string;
    branches: (ProjectBranch & {
      is_active: boolean;
      parent_branch_name: string | null;
      child_branch_names: string[];
    })[];
    all_checkpoints: CheckpointStep[];
  }> {
    const branchState = await this.getBranches(projectPath);
    const allCheckpoints = await this.getCheckpoints(projectPath);

    const enriched = branchState.branches.map((b) => {
      let parentBranch: string | null = b.parent_branch || null;
      if (!parentBranch && b.name !== "main") {
        for (const candidate of branchState.branches) {
          if (candidate.name === b.name) continue;
          if (new Date(candidate.created_at).getTime() <= new Date(b.created_at).getTime()) {
            parentBranch = candidate.name;
          }
        }
      }
      parentBranch = parentBranch || (b.name === "main" ? null : "main");

      const childBranches = branchState.branches
        .filter(
          (other) =>
            other.name !== b.name &&
            (other.parent_branch === b.name || other.parent_branch === b.git_branch)
        )
        .map((other) => other.name);

      return {
        ...b,
        is_active: b.name === branchState.active_branch,
        parent_branch_name: b.name === "main" ? null : parentBranch,
        child_branch_names: childBranches,
      };
    });

    return {
      active_branch: branchState.active_branch,
      branches: enriched,
      all_checkpoints: allCheckpoints,
    };
  }
}
