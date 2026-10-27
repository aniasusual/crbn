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

export interface UpdateApplyResult {
  success: boolean;
  message: string;
  version: string;
}

export class UpdateService {
  private repo = "aniasusual/crbn";
  private appName = "80degrees";
  private currentVersion: string;

  constructor() {
    this.currentVersion = this.resolveCurrentVersion();
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
   * Download and apply the update without terminal commands or Apple Developer ID verification
   */
  async applyUpdate(): Promise<UpdateApplyResult> {
    const check = await this.checkForUpdates();
    if (!check.hasUpdate && !process.env.FORCE_UPDATE) {
      return {
        success: false,
        message: `Already on the latest version (${this.currentVersion}).`,
        version: this.currentVersion,
      };
    }

    const { targetOs, arch, ext } = this.getPlatformArch();
    const assetName = `${this.appName}-${targetOs}-${arch}.${ext}`;
    const downloadUrl = check.downloadUrl || `https://github.com/${this.repo}/releases/latest/download/${assetName}`;

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "80degrees-inapp-update-"));
    const zipPath = path.join(tempDir, assetName);
    const extractDir = path.join(tempDir, "extracted");
    fs.mkdirSync(extractDir, { recursive: true });

    try {
      console.log(`[UpdateService] Downloading update package from ${downloadUrl}...`);
      const resp = await fetch(downloadUrl);
      if (!resp.ok) {
        throw new Error(`Failed to download update: HTTP ${resp.status} ${resp.statusText}`);
      }
      const buffer = await resp.arrayBuffer();
      fs.writeFileSync(zipPath, Buffer.from(buffer));

      console.log(`[UpdateService] Extracting update package...`);
      if (targetOs === "mac" || (targetOs === "win" && ext === "zip")) {
        execSync(`unzip -q "${zipPath}" -d "${extractDir}"`);
      } else {
        execSync(`tar -xzf "${zipPath}" -C "${extractDir}"`);
      }

      if (targetOs === "mac") {
        let extractedApp = path.join(extractDir, `${this.appName}.app`);
        if (!fs.existsSync(extractedApp)) {
          // Look for nested .app folder
          const entries = fs.readdirSync(extractDir, { withFileTypes: true });
          const appEntry = entries.find((e) => e.isDirectory() && e.name.endsWith(".app"));
          if (appEntry) {
            extractedApp = path.join(extractDir, appEntry.name);
          }
        }

        if (!fs.existsSync(extractedApp)) {
          throw new Error("Extracted package did not contain an .app bundle.");
        }

        // Recursively strip Gatekeeper quarantine BEFORE swapping
        console.log(`[UpdateService] Stripping Gatekeeper quarantine...`);
        execSync(`xattr -cr "${extractedApp}" 2>/dev/null || true`);

        // Find installed destination path dynamically from running process if available
        let destApp = "/Applications/80degrees.app";
        if (process.env.RESOURCES_PATH) {
          try {
            const candidateApp = path.resolve(process.env.RESOURCES_PATH, "../..");
            if (candidateApp.endsWith(".app") && fs.existsSync(candidateApp)) {
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

        // Clean up backup asynchronously
        try {
          fs.rmSync(backupApp, { recursive: true, force: true });
        } catch {}

      } else if (targetOs === "win") {
        let installDir = path.join(process.env.LOCALAPPDATA || os.homedir(), "Programs", this.appName);
        if (process.env.RESOURCES_PATH) {
          try {
            const candidateDir = path.resolve(process.env.RESOURCES_PATH, "..");
            if (fs.existsSync(path.join(candidateDir, `${this.appName}.exe`))) {
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

      return {
        success: true,
        message: `Successfully updated to v${check.latestVersion}. Restart required.`,
        version: check.latestVersion,
      };
    } finally {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  }
}
