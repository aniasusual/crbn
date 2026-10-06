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
  ui_events: Record<string, unknown>[];
}

export class ChatHistoryManager {
  static getChatFilePath(projectPath: string): string {
    return path.join(projectPath, CHAT_FILENAME);
  }

  static async loadHistory(projectPath: string): Promise<ChatStoragePayload> {
    const filePath = this.getChatFilePath(projectPath);
    const projectName = path.basename(projectPath);
    const now = new Date().toISOString();

    if (!fsSync.existsSync(filePath)) {
      const recovered = await this.recoverFromSession(projectPath);
      const payload: ChatStoragePayload = {
        version: 2,
        project_name: projectName,
        created_at: now,
        updated_at: now,
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
      let uiEvents = Array.isArray(data.ui_events) ? data.ui_events : [];
      if (uiEvents.length === 0) {
        const recovered = await this.recoverFromSession(projectPath);
        if (recovered.length > 0) {
          uiEvents = recovered;
          await this.saveHistory(projectPath, uiEvents).catch(() => {});
        }
      }
      return {
        version: data.version ?? 2,
        project_name: data.project_name ?? projectName,
        created_at: data.created_at ?? now,
        updated_at: data.updated_at ?? now,
        ui_events: uiEvents,
      };
    } catch {
      const recovered = await this.recoverFromSession(projectPath);
      return {
        version: 2,
        project_name: projectName,
        created_at: now,
        updated_at: now,
        ui_events: recovered,
      };
    }
  }

  static async saveHistory(projectPath: string, uiEvents: Record<string, unknown>[]): Promise<void> {
    const filePath = this.getChatFilePath(projectPath);
    const projectName = path.basename(projectPath);
    const now = new Date().toISOString();

    const payload: ChatStoragePayload = {
      version: 2,
      project_name: projectName,
      created_at: now,
      updated_at: now,
      ui_events: uiEvents,
    };

    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), "utf-8");
  }

  static async appendEvent(projectPath: string, event: Record<string, unknown>): Promise<void> {
    const history = await this.loadHistory(projectPath);
    history.ui_events.push(event);
    history.updated_at = new Date().toISOString();
    await fs.writeFile(this.getChatFilePath(projectPath), JSON.stringify(history, null, 2), "utf-8");
  }

  static async clearHistory(projectPath: string): Promise<void> {
    const filePath = this.getChatFilePath(projectPath);
    if (fsSync.existsSync(filePath)) {
      await fs.unlink(filePath).catch(() => {});
    }
  }

  static async recoverFromSession(projectPath: string): Promise<Record<string, unknown>[]> {
    try {
      const sm = await SessionManager.continueRecent(projectPath);
      const branch = sm.getBranch();
      if (!branch || branch.length === 0) return [];

      const events: Record<string, unknown>[] = [];
      for (const entry of branch) {
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
