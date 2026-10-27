import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import { CheckpointManager } from "../src/checkpoint-manager";
import { ChatHistoryManager } from "../src/chat-history";
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

describe("Rigorous Clear & Subsystem Integration Suite", () => {
  let tempDir: string;
  let projectPath: string;
  let sessionManager: SessionManager;
  let defaultBranch: string;
  let step1Id: string;
  let step2Id: string;
  let step3Id: string;
  beforeAll(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "crbn-clear-rigorous-"));
    projectPath = path.join(tempDir, "workspace-app");
    await fs.mkdir(projectPath, { recursive: true });

    // 1. Initialize Git Repo & Checkpoints
    await CheckpointManager.ensureGitRepo(projectPath);
    const branchState = await CheckpointManager.getBranches(projectPath);
    defaultBranch = branchState.active_branch;

    // 2. Initialize ChatHistoryManager
    await ChatHistoryManager.saveHistory(projectPath, [], defaultBranch);

    // 3. Initialize SessionManager
    sessionManager = await SessionManager.create(projectPath);
  });

  afterAll(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("Step 1: Creates initial pre-clear commits and chat turns", async () => {
    // Add file 1
    await fs.writeFile(path.join(projectPath, "app.js"), "console.log('v1');\n");
    const e1 = sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Create app.js" }],
      timestamp: Date.now(),
    });
    const e2 = sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Created app.js" }],
      timestamp: Date.now(),
    });

    const step1 = await CheckpointManager.createCheckpoint(projectPath, "Create app.js", e2);
    expect(step1).toBeDefined();
    expect(step1?.step_id.startsWith("step_")).toBe(true);
    step1Id = step1!.step_id;
    expect(step1?.entry_id).toBe(e2);
    await ChatHistoryManager.appendEvent(projectPath, { role: "user", content: "Create app.js", step_id: step1Id }, defaultBranch);
    await ChatHistoryManager.appendEvent(projectPath, { role: "assistant", content: "Created app.js", step_id: step1Id }, defaultBranch);
    // Add file 2
    await fs.writeFile(path.join(projectPath, "style.css"), "body { margin: 0; }\n");
    const e3 = sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Add style.css" }],
      timestamp: Date.now(),
    });
    const e4 = sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Added style.css" }],
      timestamp: Date.now(),
    });

    const step2 = await CheckpointManager.createCheckpoint(projectPath, "Add style.css", e4);
    expect(step2?.step_id.startsWith("step_")).toBe(true);
    step2Id = step2!.step_id;
    await ChatHistoryManager.appendEvent(projectPath, { role: "user", content: "Add style.css", step_id: step2Id }, defaultBranch);
    await ChatHistoryManager.appendEvent(projectPath, { role: "assistant", content: "Added style.css", step_id: step2Id }, defaultBranch);
    // Verify context before clear
    const contextBefore = sessionManager.buildSessionContext();
    expect(contextBefore.messages.length).toBe(4);

    const historyBefore = await ChatHistoryManager.loadHistory(projectPath);
    expect(historyBefore.ui_events.length).toBe(4);

    const checkpointsBefore = await CheckpointManager.getCheckpoints(projectPath);
    expect(checkpointsBefore.length).toBe(3); // step_0, step_1, step_2
  });

  it("Step 2: Executes Clear and verifies context drops while preserving files and checkpoints", async () => {
    // Record reset boundary in SessionManager (matching AgentSession.resetSessionContext)
    const resetEntryId = sessionManager.appendResetBoundary();
    expect(resetEntryId).toBeDefined();

    // Record boundary in ChatHistoryManager
    await ChatHistoryManager.recordResetBoundary(projectPath, defaultBranch);
    // 1. Model context must be empty (0 messages)
    const contextAfterClear = sessionManager.buildSessionContext();
    expect(contextAfterClear.messages.length).toBe(0);

    // 2. Visible UI chat events must be empty
    const historyAfterClear = await ChatHistoryManager.loadHistory(projectPath);
    expect(historyAfterClear.ui_events.length).toBe(0);

    // 3. Raw history must preserve all previous events + reset_boundary
    const rawHistory = await ChatHistoryManager.loadHistory(projectPath, defaultBranch, { raw: true });
    expect(rawHistory.ui_events[4].type).toBe("reset_boundary");

    // 4. Git working tree and checkpoints must remain completely untouched
    expect(fsSync.existsSync(path.join(projectPath, "app.js"))).toBe(true);
    expect(fsSync.existsSync(path.join(projectPath, "style.css"))).toBe(true);

    const checkpoints = await CheckpointManager.getCheckpoints(projectPath);
    expect(checkpoints.length).toBe(3);
    expect(checkpoints.map(c => c.step_id)).toEqual(["step_0", step1Id, step2Id]);
  });

  it("Step 3: Creates post-clear commits and verifies context isolation", async () => {
    // Add file 3
    await fs.writeFile(path.join(projectPath, "feature.js"), "export const feat = true;\n");
    const e5 = sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Create feature.js" }],
      timestamp: Date.now(),
    });
    const e6 = sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Created feature.js" }],
      timestamp: Date.now(),
    });

    const step3 = await CheckpointManager.createCheckpoint(projectPath, "Create feature.js", e6);
    expect(step3?.step_id.startsWith("step_")).toBe(true);
    step3Id = step3!.step_id;
    expect(step3?.entry_id).toBe(e6);

    await ChatHistoryManager.appendEvent(projectPath, { role: "user", content: "Create feature.js", step_id: step3Id }, defaultBranch);
    await ChatHistoryManager.appendEvent(projectPath, { role: "assistant", content: "Created feature.js", step_id: step3Id }, defaultBranch);
    // 1. Model context must ONLY see the 2 post-clear messages!
    const contextPostClear = sessionManager.buildSessionContext();
    expect(contextPostClear.messages.length).toBe(2);
    expect(contextPostClear.messages[0].role).toBe("user");
    const userText = getMessageText(contextPostClear.messages[0]);
    expect(userText).toBe("Create feature.js");

    // 2. Visible UI events must ONLY see post-clear turns
    const historyPostClear = await ChatHistoryManager.loadHistory(projectPath);
    expect(historyPostClear.ui_events.length).toBe(2);
    expect(historyPostClear.ui_events[0].content).toBe("Create feature.js");

    // 3. Checkpoints timeline includes all steps
    const checkpoints = await CheckpointManager.getCheckpoints(projectPath);
    expect(checkpoints.length).toBe(4); // step_0, step_1, step_2, step_3
  });

  it("Step 4: Branches from post-clear state and verifies branch-tree hierarchy", async () => {
    const leafId = sessionManager.getLeafId();
    expect(leafId).toBeDefined();

    // Create branch "exp-feature" from step3Id
    const newBranch = await CheckpointManager.createBranch(projectPath, "exp-feature", step3Id, leafId, defaultBranch);
    expect(newBranch.name).toBe("exp-feature");
    expect(newBranch.parent_branch).toBe(defaultBranch);

    // Branch chat history
    const branchEvents = await ChatHistoryManager.branchHistory(projectPath, defaultBranch, "exp-feature", step3Id);
    expect(branchEvents.length).toBe(2);

    // Verify branch tree data structure
    const tree = await CheckpointManager.getBranchTree(projectPath);
    expect(tree.active_branch).toBe("exp-feature");
    expect(tree.branches.length).toBe(2); // main and exp-feature

    const expBranch = tree.branches.find(b => b.name === "exp-feature");
    expect(expBranch?.parent_branch_name).toBe(defaultBranch);

    // Switch back to defaultBranch
    const switched = await CheckpointManager.switchBranch(projectPath, defaultBranch);
    expect(switched.name).toBe(defaultBranch);

    const currentBranch = await CheckpointManager.getCurrentGitBranch(projectPath);
    expect(currentBranch).toBe(defaultBranch);
  });

  it("Step 5: Rewinds to pre-clear checkpoint (code_and_messages) and restores pre-clear state", async () => {
    // We are currently at step_3. We rewind back to step_1 (which was before /clear!)
    const rewindRes = await CheckpointManager.rewindToStep(projectPath, step1Id, { rollbackCode: true });
    expect(rewindRes.success).toBe(true);
    expect(rewindRes.targetStep.step_id).toBe(step1Id);
    expect(rewindRes.remainingSteps.length).toBe(2); // step_0, step_1

    // Prune chat history back to step_1
    const prunedEvents = await ChatHistoryManager.pruneHistoryAfter(
      projectPath,
      step1Id,
      rewindRes.targetStep.timestamp,
    );

    // 1. Files created at step_2 and step_3 must be GONE
    expect(fsSync.existsSync(path.join(projectPath, "feature.js"))).toBe(false);
    expect(fsSync.existsSync(path.join(projectPath, "style.css"))).toBe(false);

    // 2. File from step_1 must be RESTORED
    expect(fsSync.existsSync(path.join(projectPath, "app.js"))).toBe(true);

    // 3. Chat history must be restored back to step_1 turns (since reset_boundary was pruned)
    expect(prunedEvents.length).toBe(2);
    expect(prunedEvents[0].content).toBe("Create app.js");
    expect(prunedEvents[1].content).toBe("Created app.js");

    const historyAfterRewind = await ChatHistoryManager.loadHistory(projectPath);
    expect(historyAfterRewind.ui_events.length).toBe(2);
    expect(historyAfterRewind.ui_events[0].content).toBe("Create app.js");

    // 4. SessionManager tree navigation back to step_1 entry_id
    if (rewindRes.targetStep.entry_id) {
      sessionManager.branch(rewindRes.targetStep.entry_id);
      const contextAtStep1 = sessionManager.buildSessionContext();
      // Step 1 had 2 messages (user & assistant)
      expect(contextAtStep1.messages.length).toBe(2);
      expect(getMessageText(contextAtStep1.messages[0])).toBe("Create app.js");
    }
  });

  it("Step 6: Rewinds with messages_only and verifies git code remains untouched", async () => {
    // Add a new file at step 2
    await fs.writeFile(path.join(projectPath, "component.jsx"), "<Component />\n");
    const e7 = sessionManager.appendMessage({
      role: "user",
      content: [{ type: "text", text: "Create component.jsx" }],
      timestamp: Date.now(),
    });
    const e8 = sessionManager.appendMessage({
      role: "assistant",
      content: [{ type: "text", text: "Created component.jsx" }],
      timestamp: Date.now(),
    });
    await CheckpointManager.createCheckpoint(projectPath, "Create component.jsx", e8);
    const stepComponent = await CheckpointManager.createCheckpoint(projectPath, "Create component.jsx", e8);
    const compStepId = stepComponent?.step_id!;
    await ChatHistoryManager.appendEvent(projectPath, { role: "user", content: "Create component.jsx", step_id: compStepId });
    await ChatHistoryManager.appendEvent(projectPath, { role: "assistant", content: "Created component.jsx", step_id: compStepId });

    expect(fsSync.existsSync(path.join(projectPath, "component.jsx"))).toBe(true);

    // Rewind with rollbackCode: false (messages_only) back to step1Id
    const rewindMessagesOnly = await CheckpointManager.rewindToStep(projectPath, step1Id, { rollbackCode: false });
    expect(rewindMessagesOnly.success).toBe(true);

    // Prune history
    const pruned = await ChatHistoryManager.pruneHistoryAfter(projectPath, step1Id);
    expect(pruned.length).toBe(2);

    // Component file MUST still exist because rollbackCode was false!
    expect(fsSync.existsSync(path.join(projectPath, "component.jsx"))).toBe(true);
  });
});
