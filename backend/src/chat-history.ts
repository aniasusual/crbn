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
      const data = JSON.parse(raw);
      const branches: Record<string, Record<string, unknown>[]> = data.branches || {};
      let uiEvents = Array.isArray(data.ui_events) ? data.ui_events : [];
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
      let visibleEvents = branchEvents;
      if (!options?.raw) {
        const lastBoundaryIdx = branchEvents.findLastIndex(
          (ev: Record<string, unknown>) => ev.type === "reset_boundary"
        );
        if (lastBoundaryIdx >= 0) {
          visibleEvents = branchEvents.slice(lastBoundaryIdx + 1);
        }
      }

      return {
        version: data.version ?? 3,
        project_name: data.project_name ?? projectName,
        created_at: data.created_at ?? now,
        updated_at: data.updated_at ?? now,
        active_branch: targetBranch,
        branches,
        ui_events: visibleEvents,
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

  static async saveHistory(
    projectPath: string,
    uiEvents: Record<string, unknown>[],
    branchName?: string,
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
      ui_events: activeBranch === "main" ? uiEvents : (currentBranches["main"] || uiEvents),
    };

    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
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
    const lastBoundaryIdx = clonedEvents.findLastIndex((ev) => ev.type === "reset_boundary");
    return lastBoundaryIdx >= 0 ? clonedEvents.slice(lastBoundaryIdx + 1) : clonedEvents;
  }

  static async appendEvent(
    projectPath: string,
    event: Record<string, unknown>,
    branchName?: string,
  ): Promise<void> {
    const history = await this.loadHistory(projectPath, branchName, { raw: true });
    history.ui_events.push(event);
    await this.saveHistory(projectPath, history.ui_events, branchName || history.active_branch || "main");
  }

  static async recordResetBoundary(projectPath: string, branchName?: string): Promise<void> {
    const boundaryEvent: Record<string, unknown> = {
      type: "reset_boundary",
      id: `reset_${Date.now()}`,
      timestamp: new Date().toISOString(),
    };
    await this.appendEvent(projectPath, boundaryEvent, branchName);
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

      const lastResetIdx = branch.findLastIndex((e) => e.type === "reset_boundary");
      const activeEntries = lastResetIdx >= 0 ? branch.slice(lastResetIdx + 1) : branch;

      const events: Record<string, unknown>[] = [];
      for (const entry of activeEntries) {
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
