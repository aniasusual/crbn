import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { execSync } from "node:child_process";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseName?: string;
  releaseNotes?: string;
  downloadUrl?: string;
  publishedAt?: string;
}

export type UpdateState = "idle" | "checking" | "downloading" | "extracting" | "installing" | "ready" | "error";

export interface UpdateStatus {
  state: UpdateState;
  progress: number;
  bytesDownloaded: number;
  totalBytes: number;
  currentVersion: string;
  latestVersion: string;
  error?: string;
  message?: string;
}

export interface UpdateApplyResult {
  success: boolean;
  message: string;
  version: string;
}

export class UpdateService {
  private repo = "aniasusual/crbn";
  private appName = "80degrees";
  private currentVersion: string;
  private status: UpdateStatus = {
    state: "idle",
    progress: 0,
    bytesDownloaded: 0,
    totalBytes: 0,
    currentVersion: "0.1.4",
    latestVersion: "0.1.4",
  };
  private statusListeners: Array<(status: UpdateStatus) => void> = [];

  constructor() {
    this.currentVersion = this.resolveCurrentVersion();
    this.status.currentVersion = this.currentVersion;
    this.status.latestVersion = this.currentVersion;
  }

  onStatusUpdate(cb: (status: UpdateStatus) => void): () => void {
    this.statusListeners.push(cb);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== cb);
    };
  }

  private notifyListeners(): void {
    for (const listener of this.statusListeners) {
      try {
        listener(this.status);
      } catch {}
    }
  }

  getStatus(): UpdateStatus {
    return { ...this.status };
  }

  private resolveCurrentVersion(): string {
    if (process.env.APP_VERSION) {
      return process.env.APP_VERSION.replace(/^v/, "");
    }
    try {
      const pkgPath = path.resolve(__dirname, "../../frontend/package.json");
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
        if (pkg.version) return pkg.version;
      }
    } catch {}
    return "0.1.4";
  }

  /**
   * Compares two semver strings: a > b -> 1, a < b -> -1, a == b -> 0
   */
  private compareVersions(v1: string, v2: string): number {
    const clean1 = v1.replace(/^v/, "").split("-")[0];
    const clean2 = v2.replace(/^v/, "").split("-")[0];
    const parts1 = clean1.split(".").map((x) => parseInt(x, 10) || 0);
    const parts2 = clean2.split(".").map((x) => parseInt(x, 10) || 0);

    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] ?? 0;
      const p2 = parts2[i] ?? 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  private getPlatformArch(): { targetOs: string; arch: string; ext: string } {
    const platform = process.platform;
    let arch = process.arch;
    let targetOs = "mac";
    let ext = "zip";

    if (platform === "darwin") {
      targetOs = "mac";
      ext = "zip";
      // Physical architecture detection (Rosetta safe)
      try {
        const isArm = execSync("/usr/sbin/sysctl -in hw.optional.arm64 2>/dev/null", { encoding: "utf-8" }).trim();
        if (isArm === "1") {
          arch = "arm64";
        }
      } catch {}
      if (arch !== "arm64") arch = "x64";
    } else if (platform === "win32") {
      targetOs = "win";
      arch = "x64";
      ext = "zip";
    } else {
      targetOs = "linux";
      ext = "tar.gz";
      arch = arch === "arm64" ? "arm64" : "x64";
    }

    return { targetOs, arch, ext };
  }

  /**
   * Check GitHub Releases for available updates
   */
  async checkForUpdates(): Promise<UpdateCheckResult> {
    const fallbackResult: UpdateCheckResult = {
      hasUpdate: false,
      currentVersion: this.currentVersion,
      latestVersion: this.currentVersion,
    };

    try {
      const response = await fetch(`https://api.github.com/repos/${this.repo}/releases/latest`, {
        headers: {
          "User-Agent": "80degrees-desktop-client",
          Accept: "application/vnd.github.v3+json",
        },
      });

      if (!response.ok) {
        return fallbackResult;
      }

      const release = (await response.json()) as {
        tag_name?: string;
        name?: string;
        body?: string;
        published_at?: string;
        assets?: Array<{ name: string; browser_download_url: string }>;
      };

      const latestTag = release.tag_name || "";
      const latestVer = latestTag.replace(/^v/, "");
      if (!latestVer) return fallbackResult;

      const hasUpdate = this.compareVersions(latestVer, this.currentVersion) > 0;
      const { targetOs, arch, ext } = this.getPlatformArch();
      const expectedAssetName = `${this.appName}-${targetOs}-${arch}.${ext}`;

      let downloadUrl = `https://github.com/${this.repo}/releases/latest/download/${expectedAssetName}`;
      if (release.assets && Array.isArray(release.assets)) {
        const matchingAsset = release.assets.find((a) => a.name === expectedAssetName);
        if (matchingAsset) {
          downloadUrl = matchingAsset.browser_download_url;
        }
      }

      return {
        hasUpdate,
        currentVersion: this.currentVersion,
        latestVersion: latestVer,
        releaseName: release.name || latestTag,
        releaseNotes: release.body || "",
        downloadUrl,
        publishedAt: release.published_at,
      };
    } catch {
      return fallbackResult;
    }
  }

  /**
   * Start async background update job without blocking the HTTP connection
   */
  async startUpdate(): Promise<UpdateApplyResult> {
    if (this.status.state === "downloading" || this.status.state === "extracting" || this.status.state === "installing") {
      return {
        success: true,
        message: "Update already in progress.",
        version: this.status.latestVersion,
      };
    }

    const check = await this.checkForUpdates();
    if (!check.hasUpdate && !process.env.FORCE_UPDATE) {
      return {
        success: false,
        message: `Already on the latest version (${this.currentVersion}).`,
        version: this.currentVersion,
      };
    }

    this.status = {
      state: "downloading",
      progress: 0,
      bytesDownloaded: 0,
      totalBytes: 0,
      currentVersion: this.currentVersion,
      latestVersion: check.latestVersion,
      message: `Downloading update to v${check.latestVersion}...`,
    };
    this.notifyListeners();

    // Run the download and extraction asynchronously in background
    this.runUpdateJob(check).catch((err) => {
      console.error("[UpdateService] Background update failed:", err);
      this.status = {
        state: "error",
        progress: 0,
        bytesDownloaded: 0,
        totalBytes: 0,
        currentVersion: this.currentVersion,
        latestVersion: check.latestVersion,
        error: err instanceof Error ? err.message : String(err),
      };
      this.notifyListeners();
    });

    return {
      success: true,
      message: `Update to v${check.latestVersion} started in background.`,
      version: check.latestVersion,
    };
  }

  async applyUpdate(): Promise<UpdateApplyResult> {
    return await this.startUpdate();
  }

  private async runUpdateJob(check: UpdateCheckResult): Promise<void> {
    const { targetOs, arch, ext } = this.getPlatformArch();
    const assetName = `${this.appName}-${targetOs}-${arch}.${ext}`;
    const downloadUrl = check.downloadUrl || `https://github.com/${this.repo}/releases/latest/download/${assetName}`;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "80degrees-inapp-update-"));
    const zipPath = path.join(tempDir, assetName);
    const extractDir = path.join(tempDir, "extracted");
    fs.mkdirSync(extractDir, { recursive: true });

    try {
      console.log(`[UpdateService] Streaming update package from ${downloadUrl}...`);
      const resp = await fetch(downloadUrl);
      if (!resp.ok || !resp.body) {
        throw new Error(`Failed to download update: HTTP ${resp.status} ${resp.statusText}`);
      }
      const totalBytes = Number(resp.headers.get("content-length") || 0);
      this.status.totalBytes = totalBytes;

      const fileStream = fs.createWriteStream(zipPath);
      let downloaded = 0;
      const reader = resp.body.getReader();
      let lastEmitTime = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        fileStream.write(value);
        downloaded += value.length;

        const now = Date.now();
        if (now - lastEmitTime > 300) {
          lastEmitTime = now;
          const pct = totalBytes > 0 ? Math.round((downloaded / totalBytes) * 100) : 0;
          this.status = {
            ...this.status,
            state: "downloading",
            progress: pct,
            bytesDownloaded: downloaded,
          };
          this.notifyListeners();
        }
      }
      fileStream.end();

      console.log(`[UpdateService] Extracting update package...`);
      this.status = {
        ...this.status,
        state: "extracting",
        progress: 100,
        bytesDownloaded: downloaded,
      };
      this.notifyListeners();

      if (targetOs === "mac" || (targetOs === "win" && ext === "zip")) {
        execSync(`unzip -q "${zipPath}" -d "${extractDir}"`);
      } else {
        execSync(`tar -xzf "${zipPath}" -C "${extractDir}"`);
      }

      this.status = {
        ...this.status,
        state: "installing",
      };
      this.notifyListeners();

      if (targetOs === "mac") {
        let extractedApp = path.join(extractDir, `${this.appName}.app`);
        if (!fs.existsSync(extractedApp)) {
          const entries = fs.readdirSync(extractDir, { withFileTypes: true });
          const appEntry = entries.find((e) => e.isDirectory() && e.name.endsWith(".app"));
          if (appEntry) {
            extractedApp = path.join(extractDir, appEntry.name);
          }
        }

        if (!fs.existsSync(extractedApp)) {
          throw new Error("Extracted package did not contain an .app bundle.");
        }

        console.log(`[UpdateService] Stripping Gatekeeper quarantine...`);
        execSync(`xattr -cr "${extractedApp}" 2>/dev/null || true`);

        let destApp = "/Applications/80degrees.app";
        if (process.env.RESOURCES_PATH) {
          try {
            const candidateApp = path.resolve(process.env.RESOURCES_PATH, "../..");
            if (candidateApp.endsWith(".app") && fs.existsSync(candidateApp) && !candidateApp.includes("node_modules")) {
              destApp = candidateApp;
            }
          } catch {}
        }
        if (!fs.existsSync(destApp)) {
          const userApp = path.join(os.homedir(), "Applications", `${this.appName}.app`);
          if (fs.existsSync(userApp)) {
            destApp = userApp;
          }
        }

        console.log(`[UpdateService] Swapping application at ${destApp}...`);
        const backupApp = `${destApp}.bak.${Date.now()}`;
        if (fs.existsSync(destApp)) {
          fs.renameSync(destApp, backupApp);
        }

        fs.renameSync(extractedApp, destApp);
        execSync(`xattr -cr "${destApp}" 2>/dev/null || true`);
        execSync(`chmod -R u+rwX "${destApp}" 2>/dev/null || true`);

        try {
          fs.rmSync(backupApp, { recursive: true, force: true });
        } catch {}

      } else if (targetOs === "win") {
        let installDir = path.join(process.env.LOCALAPPDATA || os.homedir(), "Programs", this.appName);
        if (process.env.RESOURCES_PATH) {
          try {
            const candidateDir = path.resolve(process.env.RESOURCES_PATH, "..");
            if (fs.existsSync(path.join(candidateDir, `${this.appName}.exe`)) && !candidateDir.includes("node_modules")) {
              installDir = candidateDir;
            }
          } catch {}
        }
        execSync(`powershell -NoProfile -Command "Get-ChildItem -Path '${extractDir}' -Recurse | Unblock-File" 2>nul || true`);

        if (fs.existsSync(installDir)) {
          const backupDir = `${installDir}.bak.${Date.now()}`;
          try {
            fs.renameSync(installDir, backupDir);
          } catch {}
        }
        fs.mkdirSync(installDir, { recursive: true });
        fs.cpSync(extractDir, installDir, { recursive: true });
      }

      this.status = {
        state: "ready",
        progress: 100,
        bytesDownloaded: downloaded,
        totalBytes: downloaded,
        currentVersion: this.currentVersion,
        latestVersion: check.latestVersion,
        message: `Successfully updated to v${check.latestVersion}. Restart required.`,
      };
      this.notifyListeners();
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
