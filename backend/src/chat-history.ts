import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import { SessionManager } from "../../pi-harness/packages/coding-agent/src/index";

export const CHAT_FILENAME = ".80degrees_chat.json";

export interface ChatStoragePayload {
  version: number;
  project_name: string;
  created_at: string;
  updated_at: string;
  active_branch?: string;
  branches?: Record<string, Record<string, unknown>[]>;
  ui_events: Record<string, unknown>[];
}
export class ChatHistoryManager {
  static getChatFilePath(projectPath: string): string {
    return path.join(projectPath, CHAT_FILENAME);
  }

  static async loadHistory(
    projectPath: string,
    branchName?: string,
    options?: { raw?: boolean },
  ): Promise<ChatStoragePayload> {
    const filePath = this.getChatFilePath(projectPath);
    const projectName = path.basename(projectPath);
    const now = new Date().toISOString();

    const pending = this.pendingSaves.get(filePath);
    if (pending) {
      const data = pending.payload;
      const branches = data.branches || {};
      const targetBranch = branchName || data.active_branch || "main";
      const branchEvents = branches[targetBranch] || data.ui_events || [];
      return {
        ...data,
        active_branch: targetBranch,
        ui_events: branchEvents,
      };
    }

    if (!fsSync.existsSync(filePath)) {
      const recovered = await this.recoverFromSession(projectPath);
      const payload: ChatStoragePayload = {
        version: 3,
        project_name: projectName,
        created_at: now,
        updated_at: now,
        active_branch: branchName || "main",
        branches: {
          [branchName || "main"]: recovered,
        },
        ui_events: recovered,
      };
      if (recovered.length > 0) {
        await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8").catch(() => {});
      }
      return payload;
    }

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      let data = JSON.parse(raw);
      const branches: Record<string, Record<string, unknown>[]> = data.branches || {};
      let uiEvents = Array.isArray(data.ui_events) ? data.ui_events : [];

      // Auto-compact oversized legacy transcripts (>5MB) by truncating ancient tool result blobs
      if (raw.length > 5 * 1024 * 1024) {
        let compacted = false;
        for (const [bName, bEvents] of Object.entries(branches)) {
          if (Array.isArray(bEvents)) {
            branches[bName] = bEvents.map((ev) => this.sanitizeEventForStorage(ev));
            compacted = true;
          }
        }
        if (compacted) {
          data.branches = branches;
          data.ui_events = branches[data.active_branch || "main"] || uiEvents.map((ev) => this.sanitizeEventForStorage(ev));
          uiEvents = data.ui_events;
          fs.writeFile(filePath, JSON.stringify(data), "utf-8").catch(() => {});
        }
      }
      const targetBranch = branchName || data.active_branch || "main";

      // Ensure target branch has an array
      if (!branches[targetBranch]) {
        if (targetBranch === "main" && uiEvents.length > 0) {
          branches["main"] = uiEvents;
        } else if (uiEvents.length > 0 && Object.keys(branches).length === 0) {
          branches[targetBranch] = uiEvents;
        } else {
          branches[targetBranch] = [];
        }
      }

      const branchEvents = branches[targetBranch] || uiEvents;
      return {
        version: data.version ?? 3,
        project_name: data.project_name ?? projectName,
        created_at: data.created_at ?? now,
        updated_at: data.updated_at ?? now,
        active_branch: targetBranch,
        branches,
        ui_events: branchEvents,
      };
    } catch {
      const recovered = await this.recoverFromSession(projectPath);
      return {
        version: 3,
        project_name: projectName,
        created_at: now,
        updated_at: now,
        active_branch: branchName || "main",
        branches: {
          [branchName || "main"]: recovered,
        },
        ui_events: recovered,
      };
    }
  }

  private static writeDebounceTimers = new Map<string, Timer>();
  private static pendingSaves = new Map<string, { payload: ChatStoragePayload; resolve: () => void }>();

  static async flushPendingWrites(projectPath?: string): Promise<void> {
    if (projectPath) {
      const filePath = this.getChatFilePath(projectPath);
      const timer = this.writeDebounceTimers.get(filePath);
      if (timer) {
        clearTimeout(timer);
        this.writeDebounceTimers.delete(filePath);
      }
      const pending = this.pendingSaves.get(filePath);
      if (pending) {
        this.pendingSaves.delete(filePath);
        await fs.writeFile(filePath, JSON.stringify(pending.payload), "utf-8").catch(() => {});
        pending.resolve();
      }
    } else {
      for (const [filePath, timer] of this.writeDebounceTimers.entries()) {
        clearTimeout(timer);
        const pending = this.pendingSaves.get(filePath);
        if (pending) {
          await fs.writeFile(filePath, JSON.stringify(pending.payload), "utf-8").catch(() => {});
          pending.resolve();
        }
      }
      this.writeDebounceTimers.clear();
      this.pendingSaves.clear();
    }
  }

  static async saveHistory(
    projectPath: string,
    uiEvents: Record<string, unknown>[],
    branchName?: string,
    options?: { immediate?: boolean },
  ): Promise<void> {
    const filePath = this.getChatFilePath(projectPath);
    const projectName = path.basename(projectPath);
    const now = new Date().toISOString();

    let currentBranches: Record<string, Record<string, unknown>[]> = {};
    let activeBranch = branchName || "main";

    if (fsSync.existsSync(filePath)) {
      try {
        const raw = await fs.readFile(filePath, "utf-8");
        const parsed = JSON.parse(raw);
        currentBranches = parsed.branches || {};
        if (!branchName) activeBranch = parsed.active_branch || "main";
      } catch {}
    }

    currentBranches[activeBranch] = uiEvents;

    const payload: ChatStoragePayload = {
      version: 3,
      project_name: projectName,
      created_at: now,
      updated_at: now,
      active_branch: activeBranch,
      branches: currentBranches,
      ui_events: uiEvents,
    };

    if (options?.immediate) {
      const timer = this.writeDebounceTimers.get(filePath);
      if (timer) {
        clearTimeout(timer);
        this.writeDebounceTimers.delete(filePath);
      }
      this.pendingSaves.delete(filePath);
      await fs.writeFile(filePath, JSON.stringify(payload), "utf-8");
      return;
    }

    // Debounced write to coalesce rapid tool events without blocking the event loop
    const { promise, resolve } = Promise.withResolvers<void>();
    const existingTimer = this.writeDebounceTimers.get(filePath);
    clearTimeout(existingTimer);

    this.pendingSaves.set(filePath, { payload, resolve });

    const newTimer = setTimeout(async () => {
      this.writeDebounceTimers.delete(filePath);
      const pending = this.pendingSaves.get(filePath);
      if (pending) {
        this.pendingSaves.delete(filePath);
        try {
          await fs.writeFile(filePath, JSON.stringify(pending.payload), "utf-8");
        } catch {}
        pending.resolve();
      }
    }, 250);

    this.writeDebounceTimers.set(filePath, newTimer);
    return promise;
  }

  static sanitizeEventForStorage(event: Record<string, unknown>): Record<string, unknown> {
    const clone = { ...event };
    const MAX_TOOL_TEXT_LEN = 4000;

    if (clone.type === "tool_result") {
      if (clone.result && typeof clone.result === "object") {
        const res = clone.result as Record<string, unknown>;
        if (Array.isArray(res.content)) {
          clone.result = {
            ...res,
            content: res.content.map((item) => {
              if (item && typeof item === "object") {
                const textVal = "text" in item && typeof item.text === "string" ? item.text : null;
                if (textVal && textVal.length > MAX_TOOL_TEXT_LEN) {
                  return {
                    ...item,
                    text: textVal.slice(0, MAX_TOOL_TEXT_LEN) + "\n\n... [Output truncated for storage] ...",
                  };
                }
                if ("type" in item && item.type === "image" && "data" in item) {
                  return { type: "image", mimeType: item.mimeType, truncated: true };
                }
              }
              return item;
            }),
          };
        }
      }
      if (typeof clone.content === "string" && clone.content.length > MAX_TOOL_TEXT_LEN) {
        clone.content = clone.content.slice(0, MAX_TOOL_TEXT_LEN) + "\n\n... [Output truncated for storage] ...";
      }
    }
    return clone;
  }

  static async branchHistory(
    projectPath: string,
    sourceBranch: string,
    newBranch: string,
    fromStepId?: string,
  ): Promise<Record<string, unknown>[]> {
    const history = await this.loadHistory(projectPath, sourceBranch, { raw: true });
    const sourceEvents = history.ui_events;
    let cutoffIndex = sourceEvents.length - 1;

    if (fromStepId && fromStepId !== "latest") {
      for (let i = sourceEvents.length - 1; i >= 0; i--) {
        const ev = sourceEvents[i];
        if (ev.step_id === fromStepId || ev.id === fromStepId) {
          cutoffIndex = i;
          break;
        }
      }
    }

    const clonedEvents = sourceEvents.slice(0, cutoffIndex + 1);
    await this.saveHistory(projectPath, clonedEvents, newBranch);
    return clonedEvents;
  }

  static async appendEvent(
    projectPath: string,
    event: Record<string, unknown>,
    branchName?: string,
  ): Promise<void> {
    const history = await this.loadHistory(projectPath, branchName, { raw: true });
    const sanitized = this.sanitizeEventForStorage(event);
    history.ui_events.push(sanitized);
    await this.saveHistory(projectPath, history.ui_events, branchName || history.active_branch || "main");
  }

  static async recordResetBoundary(projectPath: string, branchName?: string): Promise<void> {
    const boundaryEvent: Record<string, unknown> = {
      type: "reset_boundary",
      id: `reset_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    await this.appendEvent(projectPath, boundaryEvent, branchName);
    const history = await this.loadHistory(projectPath, branchName, { raw: true });
    await this.saveHistory(projectPath, history.ui_events, branchName, { immediate: true });
  }

  static async clearHistory(projectPath: string, branchName?: string): Promise<void> {
    await this.recordResetBoundary(projectPath, branchName);
  }

  static async pruneHistoryAfter(
    projectPath: string,
    targetStepId: string,
    targetTimestamp?: string,
  ): Promise<Record<string, unknown>[]> {
    const history = await this.loadHistory(projectPath, undefined, { raw: true });
    const events = history.ui_events;
    // 1. Try finding by step_id
    let cutoffIndex = -1;
    for (let i = events.length - 1; i >= 0; i--) {
      const ev = events[i];
      if (ev.step_id === targetStepId || ev.id === targetStepId) {
        cutoffIndex = i;
        break;
      }
    }

    // 2. Fall back to timestamp match
    if (cutoffIndex === -1 && targetTimestamp) {
      const targetTime = new Date(targetTimestamp).getTime();
      for (let i = events.length - 1; i >= 0; i--) {
        const ev = events[i];
        const evTime = ev.timestamp ? new Date(ev.timestamp as string).getTime() : 0;
        if (evTime && evTime <= targetTime) {
          cutoffIndex = i;
          break;
        }
      }
    }

    // If step_0, clear all turns to reset to initial project state
    const prunedEvents = targetStepId === "step_0"
      ? []
      : cutoffIndex !== -1
      ? events.slice(0, cutoffIndex + 1)
      : events;

    await this.saveHistory(projectPath, prunedEvents, history.active_branch);
    const lastBoundaryIdx = prunedEvents.findLastIndex((ev) => ev.type === "reset_boundary");
    return lastBoundaryIdx >= 0 ? prunedEvents.slice(lastBoundaryIdx + 1) : prunedEvents;
  }

  static async recoverFromSession(projectPath: string): Promise<Record<string, unknown>[]> {
    try {
      const sm = await SessionManager.continueRecent(projectPath);
      const branch = sm.getBranch();
      if (!branch || branch.length === 0) return [];

      const events: Record<string, unknown>[] = [];
      for (const entry of branch) {
        if (entry.type === "reset_boundary") {
          events.push({
            type: "reset_boundary",
            id: entry.id,
            timestamp: new Date(entry.timestamp || Date.now()).toISOString(),
          });
          continue;
        }
        if (entry.type !== "message") continue;
        const m = entry.message;
        const msgTime = new Date(m.timestamp || Date.now()).toISOString();

        if (m.role === "user") {
          const text = Array.isArray(m.content)
            ? m.content
                .map((c) => (c && typeof c === "object" && "text" in c && typeof c.text === "string" ? c.text : ""))
                .join("")
            : String(m.content || "");
          if (text.trim()) {
            events.push({ role: "user", content: text, timestamp: msgTime });
          }
        } else if (m.role === "assistant") {
          let text = "";
          for (const block of m.content || []) {
            if (block && typeof block === "object") {
              if ("type" in block && block.type === "text" && "text" in block && typeof block.text === "string") {
                text += block.text;
              } else if ("type" in block && block.type === "toolCall") {
                const tc = block as { id?: string; name?: string; arguments?: unknown };
                events.push({
                  type: "tool_call",
                  id: tc.id || "",
                  name: tc.name || "",
                  arguments: tc.arguments ?? {},
                  timestamp: msgTime,
                });
              }
            }
          }
          if (text.trim()) {
            events.push({ role: "assistant", content: text, timestamp: msgTime });
          }
        } else if (m.role === "toolResult") {
          events.push({
            type: "tool_result",
            id: m.toolCallId,
            name: m.toolName,
            result: {
              content: m.content,
              details: m.details,
              isError: Boolean(m.isError),
            },
            is_error: Boolean(m.isError),
            timestamp: msgTime,
          });
        }
      }

      return events;
    } catch (err) {
      console.warn(`[ChatHistoryManager] Session recovery skipped for ${projectPath}:`, err);
      return [];
    }
  }
}
