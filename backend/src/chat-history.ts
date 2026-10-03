import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";

export const CHAT_FILENAME = ".lowkey_chat.json";

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
      return {
        version: 2,
        project_name: projectName,
        created_at: now,
        updated_at: now,
        ui_events: [],
      };
    }

    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const data = JSON.parse(raw);
      return {
        version: data.version ?? 2,
        project_name: data.project_name ?? projectName,
        created_at: data.created_at ?? now,
        updated_at: data.updated_at ?? now,
        ui_events: Array.isArray(data.ui_events) ? data.ui_events : [],
      };
    } catch {
      return {
        version: 2,
        project_name: projectName,
        created_at: now,
        updated_at: now,
        ui_events: [],
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
}
