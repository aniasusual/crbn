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
  private appVersion: string;
  private flushTimer: NodeJS.Timeout | number | null = null;
  private isFlushing = false;

  constructor() {
    const isTestOrCi =
      process.env.CI === "true" ||
      process.env.CI === "1" ||
      process.env.NODE_ENV === "test" ||
      Boolean(process.env.VITEST) ||
      Boolean(process.env.BUN_TEST);

    this.disabled =
      isTestOrCi ||
      process.env.DO_NOT_TRACK === "1" ||
      process.env["80DEGREES_NO_TELEMETRY"] === "1" ||
      process.env.NO_TELEMETRY === "1";

    this.endpoint = process.env.TELEMETRY_ENDPOINT || "https://get.80degreeslabs.com/api/v1/telemetry";
    this.queueFile = path.join(this.configDir, "telemetry_queue.jsonl");
    this.deviceId = this.resolveDeviceId();
    this.appVersion = this.resolveAppVersion();

    if (!this.disabled) {
      // Periodic flush every 60 seconds
      this.flushTimer = setInterval(() => {
        this.flush().catch(() => {});
      }, 60_000);

      if (this.flushTimer && typeof this.flushTimer.unref === "function") {
        this.flushTimer.unref();
      }

      const onExit = () => {
        this.flush().catch(() => {});
      };
      process.once("beforeExit", onExit);
      process.once("SIGTERM", onExit);
      process.once("SIGINT", onExit);
    }
  }

  private resolveAppVersion(): string {
    if (process.env.APP_VERSION) {
      return process.env.APP_VERSION.replace(/^v/, "");
    }
    try {
      const candidates = [
        path.resolve(__dirname, "../../frontend/package.json"),
        path.resolve(process.cwd(), "package.json"),
        path.resolve(process.cwd(), "../frontend/package.json"),
        path.resolve(process.cwd(), "frontend/package.json"),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          const pkg = JSON.parse(fs.readFileSync(p, "utf-8"));
          if (pkg.version) return pkg.version;
        }
      }
    } catch {}
    return "0.1.11";
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

  public identifyUser(distinctId: string, traits: Record<string, unknown> = {}): void {
    if (this.disabled) return;
    this.track("$identify", {
      $set: traits,
      $anon_distinct_id: this.deviceId,
      distinct_id: distinctId,
    });
    this.flush().catch(() => {});
  }
  public track(event: string, properties: Record<string, unknown> = {}): void {
    if (this.disabled) return;

    // Sanitize properties to prevent accidental PII or user code leaks
    const scrubbedProps: Record<string, unknown> = {
      app_version: this.appVersion,
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
    const flushingFile = `${this.queueFile}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;

    try {
      try {
        fs.renameSync(this.queueFile, flushingFile);
      } catch {
        this.isFlushing = false;
        return;
      }

      const content = fs.readFileSync(flushingFile, "utf8").trim();
      if (!content) {
        try { fs.unlinkSync(flushingFile); } catch {}
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
        try { fs.unlinkSync(flushingFile); } catch {}
        this.isFlushing = false;
        return;
      }

      // Chunk events into batches of 250
      const CHUNK_SIZE = 250;
      let allOk = true;

      for (let i = 0; i < events.length; i += CHUNK_SIZE) {
        const chunk = events.slice(i, i + CHUNK_SIZE);
        const res = await fetch(this.endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": `80degrees-desktop/${this.appVersion} (${os.platform()}; ${os.arch()})`,
          },
          body: JSON.stringify({
            device_id: this.deviceId,
            events: chunk,
          }),
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) {
          allOk = false;
          break;
        }
      }

      if (allOk) {
        try { fs.unlinkSync(flushingFile); } catch {}
      } else {
        // Re-append failed events back to main queue
        const leftover = fs.readFileSync(flushingFile, "utf8");
        fs.appendFileSync(this.queueFile, leftover);
        try { fs.unlinkSync(flushingFile); } catch {}
      }
    } catch {
      try {
        if (fs.existsSync(flushingFile)) {
          const leftover = fs.readFileSync(flushingFile, "utf8");
          fs.appendFileSync(this.queueFile, leftover);
          fs.unlinkSync(flushingFile);
        }
      } catch {}
    } finally {
      this.isFlushing = false;
    }
  }

  public flushSync(): void {
    if (this.disabled || !fs.existsSync(this.queueFile)) return;
    this.flush().catch(() => {});
  }
}

export const telemetry = new TelemetryService();
