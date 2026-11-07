import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import { ChatHistoryManager } from "../src/chat-history";
import { SessionBridge } from "../src/session-bridge";
import { SessionManager } from "../../pi-harness/packages/coding-agent/src/index";

describe("Multi-Session Support in Project", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "crbn-multi-session-test-"));
  });

  afterEach(async () => {
    try {
      const sessionDir = SessionManager.getDefaultSessionDir(tempDir);
      if (fsSync.existsSync(sessionDir)) {
        await fs.rm(sessionDir, { recursive: true, force: true });
      }
    } catch {}
    await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  });

  describe("ChatHistoryManager Session Isolation", () => {
    it("persists and isolates UI chat events across multiple sessions in the same project", async () => {
      const s1 = "session_001_alpha";
      const s2 = "session_002_beta";

      // 1. Append events to session 1
      await ChatHistoryManager.appendEvent(
        tempDir,
        { role: "user", content: "Session 1 first prompt" },
        "main",
        s1
      );
      await ChatHistoryManager.appendEvent(
        tempDir,
        { role: "assistant", content: "Session 1 response" },
        "main",
        s1
      );

      // 2. Append events to session 2
      await ChatHistoryManager.appendEvent(
        tempDir,
        { role: "user", content: "Session 2 different prompt" },
        "main",
        s2
      );

      // 3. Verify session 1 contains only its 2 events
      const loadedS1 = await ChatHistoryManager.loadHistory(tempDir, "main", { sessionId: s1 });
      expect(loadedS1.ui_events.length).toBe(2);
      expect(loadedS1.ui_events[0].content).toBe("Session 1 first prompt");
      expect(loadedS1.ui_events[1].content).toBe("Session 1 response");

      // 4. Verify session 2 contains only its 1 event
      const loadedS2 = await ChatHistoryManager.loadHistory(tempDir, "main", { sessionId: s2 });
      expect(loadedS2.ui_events.length).toBe(1);
      expect(loadedS2.ui_events[0].content).toBe("Session 2 different prompt");

      // 5. Delete session 1 history and verify clean removal
      await ChatHistoryManager.deleteSessionHistory(tempDir, s1);
      const filePathS1 = ChatHistoryManager.getChatFilePath(tempDir, s1);
      expect(fsSync.existsSync(filePathS1)).toBe(false);

      // Session 2 remains intact
      const loadedS2After = await ChatHistoryManager.loadHistory(tempDir, "main", { sessionId: s2 });
      expect(loadedS2After.ui_events.length).toBe(1);
    });

    it("falls back to legacy chat history when no session-specific history exists", async () => {
      // Seed legacy .80degrees_chat.json
      const legacyPath = ChatHistoryManager.getChatFilePath(tempDir);
      await fs.writeFile(
        legacyPath,
        JSON.stringify({
          version: 3,
          project_name: "legacy-proj",
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          active_branch: "main",
          branches: {
            main: [{ role: "user", content: "Legacy message" }],
          },
          ui_events: [{ role: "user", content: "Legacy message" }],
        }),
        "utf-8"
      );

      // Load for a fresh session ID that has no file yet
      const loaded = await ChatHistoryManager.loadHistory(tempDir, "main", { sessionId: "new_session_xyz" });
      expect(loaded.ui_events.length).toBe(1);
      expect(loaded.ui_events[0].content).toBe("Legacy message");
    });
  });

  describe("SessionBridge Multi-Session Lifecycle", () => {
    it("supports creating, switching, listing, renaming, and deleting multiple sessions", async () => {
      const messages: Record<string, unknown>[] = [];
      const send = (msg: Record<string, unknown>) => {
        messages.push(msg);
      };

      const bridge = new SessionBridge(send);

      // 1. Open project (creates initial session)
      await bridge.openProject(tempDir, "gemini-3.8-flash");
      const s1Id = bridge.getActiveSessionId();
      expect(s1Id).toBeDefined();
      expect(typeof s1Id).toBe("string");

      // Verify sessions_list was broadcast
      const initialSessions = await bridge.listSessions();
      expect(initialSessions.length).toBeGreaterThanOrEqual(1);

      // 2. Rename session 1
      await bridge.renameSession(s1Id!, "Initial Setup Task");
      const sessionsAfterRename = await bridge.listSessions();
      const s1Info = sessionsAfterRename.find((s) => s.id === s1Id);
      expect(s1Info?.title).toBe("Initial Setup Task");

      // 3. Create a second session
      const { session: s2 } = await bridge.createSession("Feature Auth");
      const s2Id = bridge.getActiveSessionId();
      expect(s2Id).toBe(s2.id);
      expect(s2Id).not.toBe(s1Id);
      expect(bridge.getActiveTurns().length).toBe(0);

      // Verify both sessions exist
      const sessionsWithTwo = await bridge.listSessions();
      expect(sessionsWithTwo.length).toBe(2);
      expect(sessionsWithTwo.some((s) => s.id === s1Id)).toBe(true);
      expect(sessionsWithTwo.some((s) => s.id === s2Id)).toBe(true);

      // 4. Switch back to session 1
      await bridge.switchSession(s1Id!);
      expect(bridge.getActiveSessionId()).toBe(s1Id);

      // 5. Delete session 2
      await bridge.deleteSession(s2Id!);
      const sessionsAfterDelete = await bridge.listSessions();
      expect(sessionsAfterDelete.length).toBe(1);
      expect(sessionsAfterDelete.some((s) => s.id === s2Id)).toBe(false);
      expect(sessionsAfterDelete[0].id).toBe(s1Id);

      await bridge.dispose();
    });
  });
});
