import * as fsSync from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const LOG_FILE = path.join(os.homedir(), ".80degrees", "company-integration.log");

export function logCompany(category: string, message: string, data?: unknown) {
  const timestamp = new Date().toISOString();
  let logLine = `[${timestamp}] [${category}] ${message}`;
  if (data !== undefined) {
    try {
      logLine += "\n" + (typeof data === "object" ? JSON.stringify(data, null, 2) : String(data));
    } catch {
      logLine += " [unstringifiable data]";
    }
  }
  
  // Terminal output
  if (data !== undefined) {
    console.log(`\x1b[36m[Company:${category}]\x1b[0m ${message}`, data);
  } else {
    console.log(`\x1b[36m[Company:${category}]\x1b[0m ${message}`);
  }

  // Persistent file output
  try {
    fsSync.appendFileSync(LOG_FILE, logLine + "\n\n", "utf-8");
  } catch {}
}

export function getCompanyLogPath(): string {
  return LOG_FILE;
}
