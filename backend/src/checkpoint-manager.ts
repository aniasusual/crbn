import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";

export const CHECKPOINTS_FILENAME = ".80degrees_checkpoints.json";

export interface CheckpointStep {
  step_id: string;
  step_number: number;
  commit_hash: string;
  prompt: string;
  timestamp: string;
  entry_id?: string | null;
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
  private static async runGit(projectPath: string, args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const proc = Bun.spawn(["git", ...args], {
      cwd: projectPath,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ]);

    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode };
  }

  /**
   * Ensure the project directory is a clean Git repository with an initial commit.
   */
  static async ensureGitRepo(projectPath: string): Promise<boolean> {
    const gitDir = path.join(projectPath, ".git");

    if (!fsSync.existsSync(gitDir)) {
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
      return Array.isArray(data.steps) ? data.steps : [];
    } catch {
      return [];
    }
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

    const newStep: CheckpointStep = {
      step_id: stepId,
      step_number: nextStepNumber,
      commit_hash: commitHash,
      prompt: promptSummary,
      timestamp: now,
      entry_id: entryId ?? null,
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
}
