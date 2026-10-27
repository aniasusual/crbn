import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ChatHistoryManager } from "../src/chat-history";

describe("ChatHistoryManager with reset_boundary", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "chat-history-test-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  it("records reset_boundary and filters ui_events on loadHistory", async () => {
    // 1. Append initial turns
    await ChatHistoryManager.appendEvent(tempDir, { role: "user", content: "hello turn 1", step_id: "step_1" });
    await ChatHistoryManager.appendEvent(tempDir, { role: "assistant", content: "hi turn 1", step_id: "step_1" });

    const hist1 = await ChatHistoryManager.loadHistory(tempDir);
    expect(hist1.ui_events.length).toBe(2);

    // 2. Record reset boundary
    await ChatHistoryManager.recordResetBoundary(tempDir, "main");

    // 3. Load history should now be empty for visible UI events
    const histAfterReset = await ChatHistoryManager.loadHistory(tempDir);
    expect(histAfterReset.ui_events.length).toBe(0);

    // 4. Raw history still contains all 3 entries (2 turns + reset_boundary)
    const rawHist = await ChatHistoryManager.loadHistory(tempDir, "main", { raw: true });
    expect(rawHist.ui_events.length).toBe(3);
    expect(rawHist.ui_events[2].type).toBe("reset_boundary");

    // 5. Append new post-reset turn
    await ChatHistoryManager.appendEvent(tempDir, { role: "user", content: "post reset turn 2", step_id: "step_2" });
    const histPostReset = await ChatHistoryManager.loadHistory(tempDir);
    expect(histPostReset.ui_events.length).toBe(1);
    expect(histPostReset.ui_events[0].content).toBe("post reset turn 2");
  });

  it("restores pre-clear events when pruning history back to an earlier step", async () => {
    await ChatHistoryManager.appendEvent(tempDir, { role: "user", content: "turn 1", step_id: "step_1" });
    await ChatHistoryManager.recordResetBoundary(tempDir, "main");
    await ChatHistoryManager.appendEvent(tempDir, { role: "user", content: "turn 2", step_id: "step_2" });

    // Prune back to step_1 (which is before the clear)
    const pruned = await ChatHistoryManager.pruneHistoryAfter(tempDir, "step_1");
    expect(pruned.length).toBe(1);
    expect(pruned[0].content).toBe("turn 1");

    // Load history should now show turn 1 since the reset_boundary was pruned away
    const hist = await ChatHistoryManager.loadHistory(tempDir);
    expect(hist.ui_events.length).toBe(1);
    expect(hist.ui_events[0].content).toBe("turn 1");
  });
});
