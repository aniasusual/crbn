import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import { CheckpointManager } from "../src/checkpoint-manager";
import { ChatHistoryManager } from "../src/chat-history";
import { AttachmentService } from "../src/attachment-service";
import { SessionManager } from "../../pi-harness/packages/coding-agent/src/session/session-manager";

function getMessageText(message: unknown): string {
  if (message && typeof message === "object" && "content" in message) {
    const content = message.content;
    if (Array.isArray(content) && content.length > 0) {
      const first = content[0];
      if (first && typeof first === "object" && "text" in first && typeof first.text === "string") {
        return first.text;
      }
    }
  }
  return "";
}

describe("Comprehensive Chat Functioning & Subsystems Integration Suite", () => {
  let tempDir: string;
  let projectPath: string;
  let sessionManager: SessionManager;
  let defaultBranch: string;
  let step1Id: string;
  let step2Id: string;
  let step3Id: string;

  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "crbn-chat-e2e-"));
    projectPath = path.join(tempDir, "workspace-app");
    await fs.mkdir(projectPath, { recursive: true });

    // 1. Initialize Git Repo & Checkpoints
    await CheckpointManager.ensureGitRepo(projectPath);
    const branchState = await CheckpointManager.getBranches(projectPath);
    defaultBranch = branchState.active_branch;

    // 2. Initialize ChatHistoryManager
    await ChatHistoryManager.saveHistory(projectPath, [], defaultBranch, { immediate: true });

    // 3. Initialize SessionManager
    sessionManager = await SessionManager.create(projectPath);
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("1. Message Turn Ingestion & History Persistence", () => {
    it("persists user and assistant turns with timestamps and tool calls", async () => {
      const userEvent = {
        role: "user",
        content: "Initialize project structure",
        timestamp: new Date().toISOString(),
      };
      await ChatHistoryManager.appendEvent(projectPath, userEvent, defaultBranch);

      const toolCallEvent = {
        type: "tool_call",
        id: "call_123",
        name: "write",
        arguments: { path: "index.html", content: "<h1>Hello World</h1>" },
        timestamp: new Date().toISOString(),
      };
      await ChatHistoryManager.appendEvent(projectPath, toolCallEvent, defaultBranch);

      const toolResultEvent = {
        type: "tool_result",
        id: "call_123",
        name: "write",
        result: "Successfully wrote 22 bytes to index.html",
        is_error: false,
        timestamp: new Date().toISOString(),
      };
      await ChatHistoryManager.appendEvent(projectPath, toolResultEvent, defaultBranch);

      const assistantEvent = {
        role: "assistant",
        content: "I have initialized index.html with Hello World.",
        timestamp: new Date().toISOString(),
      };
      await ChatHistoryManager.appendEvent(projectPath, assistantEvent, defaultBranch);

      const loaded = await ChatHistoryManager.loadHistory(projectPath, defaultBranch);
      expect(loaded.ui_events.length).toBe(4);
      expect(loaded.ui_events[0].role).toBe("user");
      expect(loaded.ui_events[0].content).toBe("Initialize project structure");
      expect(loaded.ui_events[1].type).toBe("tool_call");
      expect(loaded.ui_events[2].type).toBe("tool_result");
      expect(loaded.ui_events[3].role).toBe("assistant");
      expect(loaded.ui_events[3].content).toBe("I have initialized index.html with Hello World.");
    });
  });

  describe("2. Multimodal Attachments Processing", () => {
    it("processes image, video, and code attachments correctly via AttachmentService", async () => {
      const attachmentService = new AttachmentService();

      // Test 1: Image attachment (base64)
      const fakePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      const imageResult = await attachmentService.processAttachments(
        [
          {
            name: "sample.png",
            data: fakePngBase64,
            mimeType: "image/png",
            isImage: true,
          },
        ],
        projectPath,
      );
      expect(imageResult.images.length).toBe(1);
      expect(imageResult.images[0].type).toBe("image");
      expect(imageResult.images[0].mimeType).toBe("image/png");
      expect(imageResult.images[0].data).toBe(fakePngBase64);

      // Test 2: Video attachment
      const fakeVideoData = Buffer.from("fake video bytes").toString("base64");
      const videoResult = await attachmentService.processAttachments(
        [
          {
            name: "demo.mp4",
            data: fakeVideoData,
            mimeType: "video/mp4",
            isVideo: true,
          },
        ],
        projectPath,
      );
      expect(videoResult.savedPaths.length).toBe(1);
      expect(fsSync.existsSync(videoResult.savedPaths[0])).toBe(true);
      expect(videoResult.promptAdditions).toContain("demo.mp4");
      expect(videoResult.promptAdditions).toContain("saved to");

      // Test 3: Text / Code attachment
      const codeResult = await attachmentService.processAttachments(
        [
          {
            name: "config.json",
            data: Buffer.from(JSON.stringify({ port: 8080 })).toString("base64"),
            mimeType: "application/json",
          },
        ],
        projectPath,
      );
      expect(codeResult.savedPaths.length).toBe(1);
      expect(codeResult.promptAdditions).toContain("config.json");
    });
  });

  describe("3. Commits & Checkpoints Pipeline", () => {
    it("creates Git commit and CheckpointStep on file modifications", async () => {
      // Create file in workspace
      await fs.writeFile(path.join(projectPath, "index.html"), "<h1>Hello World</h1>\n");

      const e1 = sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "Create index.html" }],
        timestamp: Date.now(),
      });
      const e2 = sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Created index.html" }],
        timestamp: Date.now(),
      });

      const step1 = await CheckpointManager.createCheckpoint(projectPath, "Create index.html", e2);
      expect(step1).toBeDefined();
      expect(step1?.step_id.startsWith("step_")).toBe(true);
      step1Id = step1!.step_id;
      expect(step1?.step_number).toBeGreaterThanOrEqual(1);
      expect(step1?.prompt).toContain("Create index.html");
      expect(step1?.entry_id).toBe(e2);

      // Stamp step_id on chat history
      await ChatHistoryManager.appendEvent(projectPath, { role: "user", content: "Create index.html", step_id: step1Id }, defaultBranch);
      await ChatHistoryManager.appendEvent(projectPath, { role: "assistant", content: "Created index.html", step_id: step1Id }, defaultBranch);

      const checkpoints = await CheckpointManager.getCheckpoints(projectPath);
      const foundStep1 = checkpoints.find((s) => s.step_id === step1Id);
      expect(foundStep1).toBeDefined();
      expect(foundStep1?.commit_hash.length).toBeGreaterThan(0);
    });

    it("handles zero-modification turns without creating an empty commit", async () => {
      const checkpointsBefore = await CheckpointManager.getCheckpoints(projectPath);
      const lastCommitBefore = checkpointsBefore[checkpointsBefore.length - 1].commit_hash;

      // Turn with no file changes (pure Q&A)
      const e3 = sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "Explain index.html" }],
        timestamp: Date.now(),
      });
      const e4 = sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "index.html is the entry page." }],
        timestamp: Date.now(),
      });

      const zeroStep = await CheckpointManager.createCheckpoint(projectPath, "Explain index.html", e4);
      expect(zeroStep).toBeDefined();
      // Commit hash should match HEAD since there were no changes
      expect(zeroStep?.commit_hash).toBe(lastCommitBefore);
      step2Id = zeroStep!.step_id;

      await ChatHistoryManager.appendEvent(projectPath, { role: "user", content: "Explain index.html", step_id: step2Id }, defaultBranch);
      await ChatHistoryManager.appendEvent(projectPath, { role: "assistant", content: "index.html is the entry page.", step_id: step2Id }, defaultBranch);
    });
  });

  describe("4. Clear Chat & Context Isolation", () => {
    it("drops LLM model context to 0 messages while preserving files and UI history", async () => {
      // Prior context check
      const contextBefore = sessionManager.buildSessionContext();
      expect(contextBefore.messages.length).toBe(4); // 2 turns = 4 messages

      // Execute Clear
      sessionManager.appendResetBoundary();
      await ChatHistoryManager.recordResetBoundary(projectPath, defaultBranch);

      // 1. Model context MUST be reset to 0
      const contextAfter = sessionManager.buildSessionContext();
      expect(contextAfter.messages.length).toBe(0);

      // 2. Chat history preserves previous turns + reset_boundary
      const historyAfter = await ChatHistoryManager.loadHistory(projectPath, defaultBranch);
      expect(historyAfter.ui_events.length).toBeGreaterThanOrEqual(5);
      const lastReset = historyAfter.ui_events.findLast((ev) => ev.type === "reset_boundary");
      expect(lastReset).toBeDefined();

      // 3. Files on disk are untouched
      expect(fsSync.existsSync(path.join(projectPath, "index.html"))).toBe(true);

      // 4. Checkpoints are untouched
      const checkpoints = await CheckpointManager.getCheckpoints(projectPath);
      expect(checkpoints.some((s) => s.step_id === step1Id)).toBe(true);
    });

    it("ensures post-clear messages ONLY see post-boundary context and flags checkpoint", async () => {
      // Modify file after clear
      await fs.writeFile(path.join(projectPath, "app.js"), "console.log('post-clear app');\n");

      const e5 = sessionManager.appendMessage({
        role: "user",
        content: [{ type: "text", text: "Create app.js after reset" }],
        timestamp: Date.now(),
      });
      const e6 = sessionManager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: "Created app.js after reset" }],
        timestamp: Date.now(),
      });

      const step3 = await CheckpointManager.createCheckpoint(projectPath, "Create app.js after reset", e6);
      expect(step3).toBeDefined();
      step3Id = step3!.step_id;
      // has_context_reset MUST be true because a reset_boundary occurred between step2 and step3
      expect(step3?.has_context_reset).toBe(true);

      // Verify model context isolation: ONLY 2 messages (e5, e6)
      const contextPostReset = sessionManager.buildSessionContext();
      expect(contextPostReset.messages.length).toBe(2);
      expect(getMessageText(contextPostReset.messages[0])).toBe("Create app.js after reset");

      await ChatHistoryManager.appendEvent(projectPath, { role: "user", content: "Create app.js after reset", step_id: step3Id }, defaultBranch);
      await ChatHistoryManager.appendEvent(projectPath, { role: "assistant", content: "Created app.js after reset", step_id: step3Id }, defaultBranch);
    });

    it("undoes clear by removing reset_boundary and restoring prior context", async () => {
      const history = await ChatHistoryManager.loadHistory(projectPath, defaultBranch, { raw: true });
      const lastResetIdx = history.ui_events.findLastIndex((ev) => ev.type === "reset_boundary");
      expect(lastResetIdx).toBeGreaterThanOrEqual(0);

      // Splice out boundary (mirroring SessionBridge.undoClear)
      history.ui_events.splice(lastResetIdx, 1);
      await ChatHistoryManager.saveHistory(projectPath, history.ui_events, defaultBranch, { immediate: true });

      const restoredHistory = await ChatHistoryManager.loadHistory(projectPath, defaultBranch);
      expect(restoredHistory.ui_events.some((ev) => ev.type === "reset_boundary")).toBe(false);
    });
  });

  describe("5. Branching & Hierarchy Pipeline", () => {
    it("creates an isolated branch with cloned history up to source checkpoint", async () => {
      const leafId = sessionManager.getLeafId();
      const branchName = "experiment-v2";

      // Create branch from step1Id
      const newBranch = await CheckpointManager.createBranch(projectPath, branchName, step1Id, leafId, defaultBranch);
      expect(newBranch.name).toBe(branchName);
      expect(newBranch.parent_branch).toBe(defaultBranch);
      expect(newBranch.source_step_id).toBe(step1Id);

      // Verify Git switched to the new branch
      const currentGit = await CheckpointManager.getCurrentGitBranch(projectPath);
      expect(currentGit).toBe(newBranch.git_branch);

      // Branch chat history
      const branchedEvents = await ChatHistoryManager.branchHistory(projectPath, defaultBranch, branchName, step1Id);
      // History should only contain events up to step1Id
      expect(branchedEvents.length).toBeGreaterThan(0);
      const hasStep3 = branchedEvents.some((ev) => ev.step_id === step3Id);
      expect(hasStep3).toBe(false);

      // File created in step 3 (app.js) MUST NOT exist on step1 branch!
      expect(fsSync.existsSync(path.join(projectPath, "app.js"))).toBe(false);
      // File created in step 1 (index.html) MUST exist
      expect(fsSync.existsSync(path.join(projectPath, "index.html"))).toBe(true);

      // Create a branch-specific file
      await fs.writeFile(path.join(projectPath, "branch-only.txt"), "branch v2\n");
      await CheckpointManager.createCheckpoint(projectPath, "Add branch-only.txt");
      expect(fsSync.existsSync(path.join(projectPath, "branch-only.txt"))).toBe(true);

      // Switch back to default branch
      await CheckpointManager.switchBranch(projectPath, defaultBranch);
      const switchedGit = await CheckpointManager.getCurrentGitBranch(projectPath);
      expect(switchedGit).toBe(defaultBranch);

      // On default branch, app.js exists, but branch-only.txt does not
      expect(fsSync.existsSync(path.join(projectPath, "app.js"))).toBe(true);
      expect(fsSync.existsSync(path.join(projectPath, "branch-only.txt"))).toBe(false);
    });

    it("builds the branch tree hierarchy correctly", async () => {
      const tree = await CheckpointManager.getBranchTree(projectPath);
      expect(tree.active_branch).toBe(defaultBranch);
      expect(tree.branches.length).toBeGreaterThanOrEqual(2);

      const expBranch = tree.branches.find((b) => b.name === "experiment-v2");
      expect(expBranch).toBeDefined();
      expect(expBranch?.parent_branch_name).toBe(defaultBranch);
    });

    it("enforces branch deletion guards", async () => {
      // 1. Cannot delete main branch
      expect(CheckpointManager.deleteBranch(projectPath, defaultBranch)).rejects.toThrow(/Cannot delete main branch/);

      // 2. Cannot delete currently active branch
      await CheckpointManager.switchBranch(projectPath, "experiment-v2");
      expect(CheckpointManager.deleteBranch(projectPath, "experiment-v2")).rejects.toThrow(/Cannot delete currently active branch/);

      // 3. Delete non-active branch successfully
      await CheckpointManager.switchBranch(projectPath, defaultBranch);
      await CheckpointManager.deleteBranch(projectPath, "experiment-v2");

      const stateAfter = await CheckpointManager.getBranches(projectPath);
      expect(stateAfter.branches.some((b) => b.name === "experiment-v2")).toBe(false);
    });
  });

  describe("6. Rewind / Rollback Pipeline", () => {
    it("rewinds with code_and_messages mode (full filesystem and history rollback)", async () => {
      // Verify app.js exists before rewind
      expect(fsSync.existsSync(path.join(projectPath, "app.js"))).toBe(true);

      // Rewind to step1Id
      const rewindRes = await CheckpointManager.rewindToStep(projectPath, step1Id, { rollbackCode: true });
      expect(rewindRes.success).toBe(true);
      expect(rewindRes.targetStep.step_id).toBe(step1Id);

      const prunedHistory = await ChatHistoryManager.pruneHistoryAfter(
        projectPath,
        step1Id,
        rewindRes.targetStep.timestamp,
      );

      // app.js (created in step 3) must be deleted by git reset --hard and git clean -fd
      expect(fsSync.existsSync(path.join(projectPath, "app.js"))).toBe(false);
      // index.html (created in step 1) must remain
      expect(fsSync.existsSync(path.join(projectPath, "index.html"))).toBe(true);

      // Chat history is pruned
      expect(prunedHistory.some((ev) => ev.step_id === step3Id)).toBe(false);
    });

    it("rewinds with messages_only mode (leaves filesystem code untouched)", async () => {
      // Create a new file
      await fs.writeFile(path.join(projectPath, "keeper.js"), "const keep = true;\n");
      const stepNew = await CheckpointManager.createCheckpoint(projectPath, "Add keeper.js");
      expect(fsSync.existsSync(path.join(projectPath, "keeper.js"))).toBe(true);

      // Rewind to step1Id with rollbackCode: false
      const rewindRes = await CheckpointManager.rewindToStep(projectPath, step1Id, { rollbackCode: false });
      expect(rewindRes.success).toBe(true);

      // keeper.js MUST still exist on disk because rollbackCode was false
      expect(fsSync.existsSync(path.join(projectPath, "keeper.js"))).toBe(true);
    });
  });

  describe("7. Storage Sanitization & Session Recovery", () => {
    it("sanitizes and truncates oversized tool outputs (>4000 chars) for storage", () => {
      const hugeOutput = "A".repeat(10000);
      const event = {
        type: "tool_result",
        id: "call_big",
        name: "read",
        content: hugeOutput,
        result: {
          content: [{ type: "text", text: hugeOutput }],
        },
      };

      const sanitized = ChatHistoryManager.sanitizeEventForStorage(event);
      expect(typeof sanitized.content).toBe("string");
      expect((sanitized.content as string).length).toBeLessThan(4500);
      expect(sanitized.content as string).toContain("... [Output truncated for storage] ...");

      if (sanitized.result && typeof sanitized.result === "object" && "content" in sanitized.result) {
        const resContent = sanitized.result.content;
        if (Array.isArray(resContent) && resContent[0] && typeof resContent[0] === "object" && "text" in resContent[0]) {
          const itemText = String(resContent[0].text);
          expect(itemText.length).toBeLessThan(4500);
          expect(itemText).toContain("... [Output truncated for storage] ...");
        }
      }
    });

    it("recovers conversation history from pi-harness session store if chat file is deleted", async () => {
      const chatFile = ChatHistoryManager.getChatFilePath(projectPath);
      // Delete .80degrees_chat.json
      if (fsSync.existsSync(chatFile)) {
        await fs.unlink(chatFile);
      }
      expect(fsSync.existsSync(chatFile)).toBe(false);

      // Calling loadHistory should auto-recover from sessionManager
      const recovered = await ChatHistoryManager.loadHistory(projectPath);
      expect(recovered).toBeDefined();
      expect(Array.isArray(recovered.ui_events)).toBe(true);
      // File should be re-created
      expect(fsSync.existsSync(chatFile)).toBe(true);
    });
  });
});
