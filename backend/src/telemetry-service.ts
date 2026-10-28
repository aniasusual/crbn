import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const FORBIDDEN_KEYS: Record<string, true> = {
  api_key: true,
  token: true,
  password: true,
  prompt: true,
  prompt_text: true,
  user_prompt: true,
  code: true,
  raw_code: true,
  source_code: true,
  content: true,
  file_content: true,
  secret: true,
};
export interface TelemetryEvent {
  event: string;
  properties?: Record<string, unknown>;
  timestamp: number;
}

export class TelemetryService {
  private configDir = path.join(os.homedir(), ".80degrees");
  private queueFile: string;
  private deviceId: string;
  private disabled: boolean;
  private endpoint: string;
  private flushTimer: NodeJS.Timeout | number | null = null;
  private isFlushing = false;

  constructor() {
    this.disabled =
      process.env.DO_NOT_TRACK === "1" ||
      process.env["80DEGREES_NO_TELEMETRY"] === "1" ||
      process.env.NO_TELEMETRY === "1";

    this.endpoint = process.env.TELEMETRY_ENDPOINT || "https://get.80degreeslabs.com/api/v1/telemetry";
    this.queueFile = path.join(this.configDir, "telemetry_queue.jsonl");
    this.deviceId = this.resolveDeviceId();

    if (!this.disabled) {
      // Periodic flush every 60 seconds
      this.flushTimer = setInterval(() => {
        this.flush().catch(() => {});
      }, 60_000);

      if (this.flushTimer && typeof this.flushTimer.unref === "function") {
        this.flushTimer.unref();
      }

      // Flush when process exits
      process.once("beforeExit", () => {
        this.flushSync();
      });
    }
  }

  private resolveDeviceId(): string {
    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }
      const idPath = path.join(this.configDir, "device_id");
      if (fs.existsSync(idPath)) {
        const id = fs.readFileSync(idPath, "utf8").trim();
        if (id) return id;
      }
      const newId = crypto.randomUUID();
      fs.writeFileSync(idPath, newId, "utf8");
      return newId;
    } catch {
      return "anonymous-fallback";
    }
  }

  public getDeviceId(): string {
    return this.deviceId;
  }

  public isEnabled(): boolean {
    return !this.disabled;
  }

  public track(event: string, properties: Record<string, unknown> = {}): void {
    if (this.disabled) return;

    // Sanitize properties to prevent accidental PII or user code leaks
    const scrubbedProps: Record<string, unknown> = {
      app_version: "0.1.0",
      platform: os.platform(),
      arch: os.arch(),
    };

    const homeDir = os.homedir();
    for (const [key, val] of Object.entries(properties)) {
      if (FORBIDDEN_KEYS[key.toLowerCase()]) continue;

      if (typeof val === "string") {
        // Obfuscate local home directories
        scrubbedProps[key] = val.replace(new RegExp(homeDir, "g"), "~");
      } else {
        scrubbedProps[key] = val;
      }
    }

    const payload: TelemetryEvent = {
      event,
      properties: scrubbedProps,
      timestamp: Date.now(),
    };

    try {
      if (!fs.existsSync(this.configDir)) {
        fs.mkdirSync(this.configDir, { recursive: true });
      }
      fs.appendFileSync(this.queueFile, JSON.stringify(payload) + "\n", "utf8");
    } catch {}
  }

  public async flush(): Promise<void> {
    if (this.disabled || this.isFlushing || !fs.existsSync(this.queueFile)) return;

    this.isFlushing = true;
    try {
      const content = fs.readFileSync(this.queueFile, "utf8").trim();
      if (!content) {
        this.isFlushing = false;
        return;
      }

      const lines = content.split("\n").filter(Boolean);
      const events: TelemetryEvent[] = [];
      for (const line of lines) {
        try {
          events.push(JSON.parse(line));
        } catch {}
      }

      if (events.length === 0) {
        fs.unlinkSync(this.queueFile);
        this.isFlushing = false;
        return;
      }

      // Send batch to Cloudflare Worker
      const res = await fetch(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: this.deviceId,
          events,
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        // Truncate or remove queue file on success
        fs.unlinkSync(this.queueFile);
      }
    } catch {
      // Offline: keep events in queue file for next cycle
    } finally {
      this.isFlushing = false;
    }
  }

  private flushSync(): void {
    if (this.disabled || !fs.existsSync(this.queueFile)) return;
    try {
      // Trigger non-blocking fetch before exit
      this.flush().catch(() => {});
    } catch {}
  }
}

export const telemetry = new TelemetryService();
