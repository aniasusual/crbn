import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { CheckpointManager } from "./checkpoint-manager";
import type { ProjectInfo, ProjectManager } from "./project-manager";
import { getAugmentedEnv } from "./runtime-env";


export interface GitHubUser {
  id: number;
  login: string;
  name: string | null;
  avatar_url: string;
  html_url: string;
  email: string | null;
  public_repos?: number;
  total_private_repos?: number;
}

export interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  owner: string;
  private: boolean;
  html_url: string;
  clone_url: string;
  default_branch: string;
  description: string | null;
  updated_at: string;
  stargazers_count: number;
  language: string | null;
  fork: boolean;
  is_local?: boolean;
  local_project_name?: string;
}
export function parseGithubFullName(input: string): string {
  if (!input) return "";
  let cleaned = input.trim();
  cleaned = cleaned.replace(/^git@github\.com:/, "");
  cleaned = cleaned.replace(/^https?:\/\/github\.com\//, "");
  cleaned = cleaned.replace(/^ssh:\/\/git@github\.com\//, "");
  cleaned = cleaned.replace(/\.git$/, "");
  cleaned = cleaned.replace(/^\/+|\/+$/g, "");
  const parts = cleaned.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  return cleaned;
}

export interface ProjectGitStatus {
  is_git_repo: boolean;
  active_branch: string;
  git_branch: string;
  has_remote: boolean;
  remote_url: string | null;
  github_repo: string | null;
  github_url: string | null;
  upstream_repo?: string | null;
  upstream_url?: string | null;
  is_fork?: boolean;
  can_push?: boolean;
  is_third_party?: boolean;
  uncommitted_count: number;
  uncommitted_files: string[];
  ahead_count: number;
  behind_count: number;
  last_commit: {
    hash: string;
    author: string;
    relative_date: string;
    message: string;
  } | null;
  branches: string[];
  parent_branch?: string | null;
  branch_details?: Array<{
    name: string;
    git_branch: string;
    parent_branch: string | null;
    is_active: boolean;
    has_remote_tracking: boolean;
  }>;
}
function sleepMs(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, ms);
  return promise;
}

export interface GitHubRepoDetails {
  full_name: string;
  name: string;
  owner: string;
  default_branch: string;
  private: boolean;
  fork: boolean;
  description: string | null;
  stargazers_count: number;
  language: string | null;
  permissions?: {
    admin?: boolean;
    maintain?: boolean;
    push?: boolean;
    triage?: boolean;
    pull?: boolean;
  };
  can_push: boolean;
  is_owned_by_current_user: boolean;
}

export interface GitHubForkResult {
  full_name: string;
  name: string;
  owner: string;
  html_url: string;
  clone_url: string;
  default_branch: string;
}

interface StoredGitHubAuth {
  token: string;
  user: GitHubUser;
  connected_at: string;
}

export class GithubService {
  private readonly authFilePath: string;
  private cachedAuth: StoredGitHubAuth | null = null;

  constructor(private readonly projectManager: ProjectManager) {
    const root = path.join(os.homedir(), ".80degrees");
    fsSync.mkdirSync(root, { recursive: true });
    this.authFilePath = path.join(root, "github.json");
    this.loadAuthFromDisk();
  }

  private loadAuthFromDisk(): StoredGitHubAuth | null {
    if (!fsSync.existsSync(this.authFilePath)) {
      this.cachedAuth = null;
      return null;
    }
    try {
      const raw = fsSync.readFileSync(this.authFilePath, "utf-8");
      this.cachedAuth = JSON.parse(raw) as StoredGitHubAuth;
      return this.cachedAuth;
    } catch {
      this.cachedAuth = null;
      return null;
    }
  }

  private async saveAuthToDisk(auth: StoredGitHubAuth): Promise<void> {
    this.cachedAuth = auth;
    await fs.writeFile(this.authFilePath, JSON.stringify(auth, null, 2), "utf-8");
  }

  private async removeAuthFromDisk(): Promise<void> {
    this.cachedAuth = null;
    if (fsSync.existsSync(this.authFilePath)) {
      await fs.unlink(this.authFilePath).catch(() => {});
    }
  }

  /**
   * Run a git command with timeout and buffer.
   */
  async runGit(
    cwd: string,
    args: string[],
    timeoutMs = 30000
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    try {
      const proc = Bun.spawn(["git", ...args], {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
        env: getAugmentedEnv({
          GIT_TERMINAL_PROMPT: "0",
        }),
      });

      let timer: Timer | number | undefined;
      let timedOut = false;
      const timeoutPromise = new Promise<void>((resolve) => {
        timer = setTimeout(() => {
          timedOut = true;
          try {
            proc.kill();
          } catch {}
          resolve();
        }, timeoutMs);
      });

      const stdoutPromise = new Response(proc.stdout).text().catch(() => "");
      const stderrPromise = new Response(proc.stderr).text().catch(() => "");
      const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
      await Promise.race([proc.exited, timeoutPromise]);
      clearTimeout(timer);

      if (timedOut) {
        return {
          stdout: stdout.trim(),
          stderr: (stderr || "Git operation timed out").trim(),
          exitCode: 124,
        };
      }

      return {
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        exitCode: proc.exitCode ?? 0,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { stdout: "", stderr: msg, exitCode: 1 };
    }
  }

  /**
   * Detect if the local machine has an authenticated `gh` CLI session.
   */
  async detectCliToken(): Promise<{ token: string | null; user: string | null }> {
    const env = getAugmentedEnv();

    try {
      const proc = Bun.spawn(["gh", "auth", "token"], {
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const stdout = await new Response(proc.stdout).text().catch(() => "");
      await proc.exited;
      const token = stdout.trim() || null;
      if (!token || proc.exitCode !== 0) return { token: null, user: null };

      const statusProc = Bun.spawn(["gh", "auth", "status"], {
        stdout: "pipe",
        stderr: "pipe",
        env,
      });
      const statusOut = await new Response(statusProc.stdout).text().catch(() => "");
      const statusErr = await new Response(statusProc.stderr).text().catch(() => "");
      await statusProc.exited;
      const combined = `${statusOut}\n${statusErr}`;
      const match = /account\s+([A-Za-z0-9_-]+)/i.exec(combined);
      const user = match ? match[1] : null;

      return { token, user };
    } catch {
      return { token: null, user: null };
    }
  }
  /**
   * Get effective GitHub token (from stored config or fallback to gh CLI).
   */
  async getToken(): Promise<string | null> {
    if (this.cachedAuth?.token) {
      return this.cachedAuth.token;
    }
    const fromDisk = this.loadAuthFromDisk();
    if (fromDisk?.token) {
      return fromDisk.token;
    }
    // Fallback: detect token from system gh CLI
    const cli = await this.detectCliToken();
    return cli.token;
  }

  /**
   * Query GitHub user profile with a token to validate it.
   */
  async fetchUserProfile(token: string): Promise<GitHubUser> {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "crbn-app",
      },
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`GitHub authentication failed (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    return {
      id: Number(data.id),
      login: String(data.login),
      name: data.name ? String(data.name) : null,
      avatar_url: String(data.avatar_url || ""),
      html_url: String(data.html_url || `https://github.com/${data.login}`),
      email: data.email ? String(data.email) : null,
      public_repos: typeof data.public_repos === "number" ? data.public_repos : undefined,
      total_private_repos:
        typeof data.total_private_repos === "number" ? data.total_private_repos : undefined,
    };
  }

  /**
   * Get current connection status and detected CLI availability.
   */
  async getAuthStatus(): Promise<{
    connected: boolean;
    user: GitHubUser | null;
    detected_cli: boolean;
    detected_cli_user: string | null;
  }> {
    const cli = await this.detectCliToken();
    const token = await this.getToken();

    if (!token) {
      return {
        connected: false,
        user: null,
        detected_cli: Boolean(cli.token),
        detected_cli_user: cli.user,
      };
    }

    try {
      let user = this.cachedAuth?.user ?? null;
      if (!user) {
        user = await this.fetchUserProfile(token);
        // Persist if valid
        await this.saveAuthToDisk({
          token,
          user,
          connected_at: new Date().toISOString(),
        });
      }
      return {
        connected: true,
        user,
        detected_cli: Boolean(cli.token),
        detected_cli_user: cli.user,
      };
    } catch {
      // Stored token was revoked or invalid
      await this.removeAuthFromDisk();
      return {
        connected: false,
        user: null,
        detected_cli: Boolean(cli.token),
        detected_cli_user: cli.user,
      };
    }
  }

  /**
   * Connect with a Personal Access Token.
   */
  async connectWithToken(token: string): Promise<GitHubUser> {
    const cleaned = token.trim();
    if (!cleaned) throw new Error("GitHub token cannot be empty");
    const user = await this.fetchUserProfile(cleaned);
    await this.saveAuthToDisk({
      token: cleaned,
      user,
      connected_at: new Date().toISOString(),
    });
    return user;
  }

  /**
   * Connect using the detected system GitHub CLI (`gh`).
   */
  async connectWithCli(): Promise<GitHubUser> {
    const cli = await this.detectCliToken();
    if (!cli.token) {
      throw new Error("No active GitHub CLI login found. Run `gh auth login` in terminal first.");
    }
    const user = await this.fetchUserProfile(cli.token);
    await this.saveAuthToDisk({
      token: cli.token,
      user,
      connected_at: new Date().toISOString(),
    });
    return user;
  }

  /**
   * Disconnect GitHub account.
   */
  async disconnect(): Promise<void> {
    await this.removeAuthFromDisk();
  }

  /**
   * Fetch all repositories owned or accessible by the user.
   */
  async listUserRepos(options?: {
    search?: string;
    page?: number;
    perPage?: number;
    sort?: string;
  }): Promise<{ repos: GitHubRepo[]; total: number }> {
    const token = await this.getToken();
    if (!token) {
      throw new Error("GitHub is not connected. Please connect your GitHub account first.");
    }

    const perPage = options?.perPage || 100;
    const page = options?.page || 1;
    const sort = options?.sort || "updated";

    const url = new URL("https://api.github.com/user/repos");
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", sort);
    url.searchParams.set("affiliation", "owner,collaborator,organization_member");

    const res = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "crbn-app",
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Failed to fetch repositories (${res.status}): ${err}`);
    }

    const rawList = (await res.json()) as Array<Record<string, unknown>>;
    if (!Array.isArray(rawList)) {
      return { repos: [], total: 0 };
    }

    let repos: GitHubRepo[] = rawList.map((r) => {
      const fullName = String(r.full_name || "");
      return {
        id: Number(r.id),
        name: String(r.name || ""),
        full_name: fullName,
        owner: (r.owner as Record<string, unknown>)?.login
          ? String((r.owner as Record<string, unknown>).login)
          : fullName.split("/")[0],
        private: Boolean(r.private),
        html_url: String(r.html_url || `https://github.com/${fullName}`),
        clone_url: String(r.clone_url || `https://github.com/${fullName}.git`),
        default_branch: String(r.default_branch || "main"),
        description: r.description ? String(r.description) : null,
        updated_at: String(r.updated_at || ""),
        stargazers_count: typeof r.stargazers_count === "number" ? r.stargazers_count : 0,
        language: r.language ? String(r.language) : null,
        fork: Boolean(r.fork),
      };
    });

    if (options?.search?.trim()) {
      const q = options.search.trim().toLowerCase();
      repos = repos.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.full_name.toLowerCase().includes(q) ||
          (r.description && r.description.toLowerCase().includes(q))
      );
    }

    return { repos, total: repos.length };
  }

  /**
   * List all remote branch names for a GitHub repository.
   */
  async listRepoBranches(fullName: string): Promise<string[]> {
    const token = await this.getToken();
    if (!token) {
      throw new Error("GitHub is not connected. Please connect your GitHub account first.");
    }
    const cleanRepo = fullName.replace(/^https?:\/\/github\.com\//, "").replace(/\.git$/, "");
    try {
      const res = await fetch(`https://api.github.com/repos/${cleanRepo}/branches?per_page=100`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "crbn-app",
        },
      });
      if (!res.ok) {
        return ["main"];
      }
      const data = (await res.json()) as Array<{ name: string }>;
      if (Array.isArray(data) && data.length > 0) {
        return data.map((b) => b.name);
      }
    } catch (err) {
      console.warn(`[GithubService] Failed to fetch branches for ${cleanRepo}:`, err);
    }
    return ["main"];
  }

  /**
   * Fetch detailed repository metadata including push permissions and owner.
   */
  async getRepoDetails(fullName: string): Promise<GitHubRepoDetails> {
    const cleanRepo = parseGithubFullName(fullName);
    const token = await this.getToken();
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "crbn-app",
    };
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`https://api.github.com/repos/${cleanRepo}`, { headers });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Repository "${cleanRepo}" not found or inaccessible (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    const perms = (data.permissions as Record<string, boolean> | undefined) || {};
    const ownerObj = data.owner as Record<string, unknown> | undefined;
    const ownerLogin = String(ownerObj?.login || cleanRepo.split("/")[0] || "");
    const currentUser = this.cachedAuth?.user?.login;

    const isOwned = Boolean(currentUser && currentUser.toLowerCase() === ownerLogin.toLowerCase());
    const canPush = Boolean(perms.push || isOwned);

    return {
      full_name: String(data.full_name || cleanRepo),
      name: String(data.name || cleanRepo.split("/")[1] || cleanRepo),
      owner: ownerLogin,
      default_branch: String(data.default_branch || "main"),
      private: Boolean(data.private),
      fork: Boolean(data.fork),
      description: data.description ? String(data.description) : null,
      stargazers_count: typeof data.stargazers_count === "number" ? data.stargazers_count : 0,
      language: data.language ? String(data.language) : null,
      permissions: perms,
      can_push: canPush,
      is_owned_by_current_user: isOwned,
    };
  }

  /**
   * Fork a repository to the authenticated user's GitHub account.
   */
  async forkRepo(fullName: string): Promise<GitHubForkResult> {
    const token = await this.getToken();
    if (!token) {
      throw new Error("GitHub is not connected. Please connect your GitHub account first.");
    }
    const cleanRepo = parseGithubFullName(fullName);
    const repoBaseName = cleanRepo.split("/")[1] || cleanRepo;
    const user = await this.fetchUserProfile(token);

    // If the repo already belongs to current user, return existing repo info
    if (cleanRepo.split("/")[0]?.toLowerCase() === user.login.toLowerCase()) {
      const details = await this.getRepoDetails(cleanRepo);
      return {
        full_name: details.full_name,
        name: details.name,
        owner: details.owner,
        html_url: `https://github.com/${details.full_name}`,
        clone_url: `https://github.com/${details.full_name}.git`,
        default_branch: details.default_branch,
      };
    }

    // Check if the user already has an existing fork
    const userForkFullName = `${user.login}/${repoBaseName}`;
    try {
      const existing = await this.getRepoDetails(userForkFullName);
      if (existing) {
        console.log(`[GithubService] User already has a fork: ${userForkFullName}`);
        return {
          full_name: existing.full_name,
          name: existing.name,
          owner: existing.owner,
          html_url: `https://github.com/${existing.full_name}`,
          clone_url: `https://github.com/${existing.full_name}.git`,
          default_branch: existing.default_branch,
        };
      }
    } catch {}

    console.log(`[GithubService] Forking repository "${cleanRepo}" to user "${user.login}"...`);
    const res = await fetch(`https://api.github.com/repos/${cleanRepo}/forks`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "crbn-app",
      },
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Failed to fork ${cleanRepo}: ${errText}`);
    }

    const forkData = (await res.json()) as Record<string, unknown>;
    const forkedFullName = String(forkData.full_name || userForkFullName);

    // Poll briefly (up to 5 seconds) to ensure GitHub backend has initialized the fork
    for (let i = 0; i < 5; i++) {
      await sleepMs(1000);
      try {
        const checkRes = await fetch(`https://api.github.com/repos/${forkedFullName}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "crbn-app",
          },
        });
        if (checkRes.ok) break;
      } catch {}
    }

    return {
      full_name: forkedFullName,
      name: String(forkData.name || repoBaseName),
      owner: user.login,
      html_url: String(forkData.html_url || `https://github.com/${forkedFullName}`),
      clone_url: String(forkData.clone_url || `https://github.com/${forkedFullName}.git`),
      default_branch: String(forkData.default_branch || "main"),
    };
  }

  /**
   * Clone a GitHub repository into local projects or open if already exists.
   * Supports auto-forking and 3rd party repos.
   */
  async cloneOrOpenRepo(options: {
    full_name: string;
    project_name?: string;
    branch?: string;
    model?: string;
    fork?: boolean;
  }): Promise<ProjectInfo> {
    const token = await this.getToken();
    if (!token) {
      throw new Error("GitHub is not connected. Please connect your GitHub account first.");
    }

    const cleanSourceRepo = parseGithubFullName(options.full_name);
    const { branch, model } = options;
    const user = await this.fetchUserProfile(token);

    let effectiveFullName = cleanSourceRepo;
    let isFork = Boolean(options.fork);
    let upstreamRepo: string | null = null;
    let upstreamUrl: string | null = null;
    let canPush = true;

    // Check repository permissions
    let repoDetails: GitHubRepoDetails | null = null;
    try {
      repoDetails = await this.getRepoDetails(cleanSourceRepo);
      canPush = repoDetails.can_push;
    } catch (e) {
      console.warn(`[GithubService] Could not fetch repo details for ${cleanSourceRepo}:`, e);
    }

    // If fork was requested
    if (options.fork) {
      try {
        const forkRes = await this.forkRepo(cleanSourceRepo);
        effectiveFullName = forkRes.full_name;
        isFork = true;
        upstreamRepo = cleanSourceRepo;
        upstreamUrl = `https://github.com/${cleanSourceRepo}`;
        canPush = true;
      } catch (err) {
        console.warn(`[GithubService] Fork failed, falling back to direct clone:`, err);
      }
    } else if (repoDetails && !repoDetails.can_push) {
      canPush = false;
      upstreamRepo = cleanSourceRepo;
      upstreamUrl = `https://github.com/${cleanSourceRepo}`;
    }

    const repoBaseName = cleanSourceRepo.split("/")[1] || cleanSourceRepo;
    const candidateName = (options.project_name || repoBaseName)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")
      .replace(/-+/g, "-");

    // Determine target directory name (deduplicate so every prompt creates a fresh workspace)
    let finalProjectName = candidateName;
    let targetDir = path.join(this.projectManager.root, finalProjectName);
    let counter = 2;
    while (fsSync.existsSync(targetDir)) {
      finalProjectName = `${candidateName}-${counter}`;
      targetDir = path.join(this.projectManager.root, finalProjectName);
      counter++;
    }
    console.log(`[GithubService] Cloning ${effectiveFullName} into ${targetDir}...`);

    // Clone using authenticated token in URL
    const authCloneUrl = `https://x-access-token:${token}@github.com/${effectiveFullName}.git`;
    const cloneArgs = ["clone", "--depth", "50"];
    if (branch) {
      cloneArgs.push("-b", branch);
    }
    cloneArgs.push(authCloneUrl, targetDir);

    const cloneRes = await this.runGit(this.projectManager.root, cloneArgs, 120000);
    if (cloneRes.exitCode !== 0) {
      // Cleanup partially created directory if failed
      if (fsSync.existsSync(targetDir)) {
        await fs.rm(targetDir, { recursive: true, force: true }).catch(() => {});
      }
      throw new Error(`Failed to clone ${effectiveFullName}: ${cloneRes.stderr || cloneRes.stdout}`);
    }

    // Configure user identity & clean origin URL in cloned repo
    const userName = user?.name || user?.login || "crbn";
    const userEmail = user?.email || (user?.login ? `${user.login}@users.noreply.github.com` : "user@crbn.local");
    await this.runGit(targetDir, ["config", "user.name", userName]);
    await this.runGit(targetDir, ["config", "user.email", userEmail]);

    // Ensure origin remote uses authenticated URL for seamless push/pull
    await this.runGit(targetDir, ["remote", "set-url", "origin", authCloneUrl]);

    // If it's a fork, configure upstream remote
    if (isFork && upstreamRepo) {
      const authUpstreamUrl = `https://x-access-token:${token}@github.com/${upstreamRepo}.git`;
      await this.runGit(targetDir, ["remote", "add", "upstream", authUpstreamUrl]).catch(() => {});
    }

    // Initialize checkpoints & branches on cloned repo
    await CheckpointManager.ensureGitRepo(targetDir);
    // Ensure .80degrees_* metadata files are excluded from Git
    try {
      const excludeDir = path.join(targetDir, ".git", "info");
      if (!fsSync.existsSync(excludeDir)) {
        await fs.mkdir(excludeDir, { recursive: true });
      }
      const excludePath = path.join(excludeDir, "exclude");
      let currentExclude = "";
      if (fsSync.existsSync(excludePath)) {
        currentExclude = await fs.readFile(excludePath, "utf-8");
      }
      const linesToAdd = [
        ".80degrees_chat.json",
        ".80degrees_checkpoints.json",
        ".80degrees_branches.json",
        ".80degrees_meta.json",
      ].filter((line) => !currentExclude.includes(line));
      if (linesToAdd.length > 0) {
        await fs.appendFile(excludePath, "\n" + linesToAdd.join("\n") + "\n", "utf-8");
      }
    } catch (e) {
      console.warn("[GithubService] Non-fatal: could not update .git/info/exclude:", e);
    }

    // Initialize initial checkpoints and branch metadata on cloned repo
    await CheckpointManager.getCheckpoints(targetDir).catch(() => []);
    await CheckpointManager.getBranches(targetDir).catch(() => null);

    // If repo has package.json and node_modules is missing, link or install
    const pkgJsonPath = path.join(targetDir, "package.json");
    const nodeModulesPath = path.join(targetDir, "node_modules");
    if (fsSync.existsSync(pkgJsonPath) && !fsSync.existsSync(nodeModulesPath)) {
      try {
        const cachedModules = await this.projectManager.ensureTemplateCache("node_react");
        if (fsSync.existsSync(cachedModules)) {
          await fs.symlink(cachedModules, nodeModulesPath, "junction").catch(() => {});
        }
      } catch (e) {
        console.warn("[GithubService] Non-fatal: could not symlink node_modules:", e);
      }
    }

    const now = new Date().toISOString();
    const projectInfo: ProjectInfo = {
      name: finalProjectName,
      path: targetDir,
      template: "github_clone",
      model: model || undefined,
      status: "stopped",
      port: null,
      backend_port: null,
      pid: null,
      created_at: now,
      last_opened: now,
    };

    // Save metadata including GitHub linkage
    const metaPath = path.join(targetDir, ".80degrees_meta.json");
    const metaPayload: Record<string, unknown> = {
      ...projectInfo,
      github_repo: effectiveFullName,
      github_url: `https://github.com/${effectiveFullName}`,
      default_branch: branch || repoDetails?.default_branch || "main",
      is_fork: isFork,
      can_push: canPush,
      is_third_party: !canPush && !isFork,
    };
    if (upstreamRepo) {
      metaPayload.upstream_repo = upstreamRepo;
      metaPayload.upstream_url = upstreamUrl || `https://github.com/${upstreamRepo}`;
    }
    await fs.writeFile(metaPath, JSON.stringify(metaPayload, null, 2), "utf-8");

    console.log(`[GithubService] Successfully imported ${effectiveFullName} as project "${finalProjectName}" (is_fork: ${isFork}, can_push: ${canPush})`);
    return projectInfo;
  }

  /**
   * Helper to sanitize remote URLs by stripping sensitive tokens.
   */
  private sanitizeUrl(url: string | null): string | null {
    if (!url) return null;
    return url.replace(/https:\/\/[^@]+@github\.com\//, "https://github.com/");
  }

  /**
   * Helper to extract GitHub full_name (owner/repo) from a git remote URL.
   */
  private extractGithubRepo(url: string | null): string | null {
    if (!url) return null;
    const match = /github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/.exec(url);
    if (!match) return null;
    return `${match[1]}/${match[2]}`;
  }

  /**
   * Get comprehensive Git and GitHub remote status for a project.
   */
  async getProjectGitStatus(projectName: string): Promise<ProjectGitStatus> {
    const project = await this.projectManager.getProject(projectName);
    const projectPath = project.path;

    await CheckpointManager.ensureGitRepo(projectPath);

    // 1. Active branch & local branch list
    const activeBranchRes = await this.runGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const activeBranch = activeBranchRes.stdout || "main";

    const branchListRes = await this.runGit(projectPath, ["branch", "--list", "--format=%(refname:short)"]);
    const rawBranches = branchListRes.stdout
      ? branchListRes.stdout.split("\n").map((b) => b.trim()).filter(Boolean)
      : [activeBranch];
    const branches = Array.from(new Set([activeBranch, ...rawBranches]));

    // 2. Remote Origin check
    const remoteRes = await this.runGit(projectPath, ["remote", "get-url", "origin"]);
    const rawRemoteUrl = remoteRes.exitCode === 0 ? remoteRes.stdout : null;
    const hasRemote = Boolean(rawRemoteUrl);
    const remoteUrl = this.sanitizeUrl(rawRemoteUrl);
    let githubRepo = this.extractGithubRepo(rawRemoteUrl);

    const githubUrl = githubRepo ? `https://github.com/${githubRepo}` : null;

    // Check for upstream remote if this is a fork
    const upstreamRes = await this.runGit(projectPath, ["remote", "get-url", "upstream"]);
    const rawUpstreamUrl = upstreamRes.exitCode === 0 ? upstreamRes.stdout : null;
    let upstreamRepo = this.extractGithubRepo(rawUpstreamUrl);

    let isFork = Boolean(upstreamRepo);
    let canPush = true;
    let isThirdParty = false;

    try {
      const metaRaw = await fs.readFile(path.join(projectPath, ".80degrees_meta.json"), "utf-8");
      const meta = JSON.parse(metaRaw);
      if (!githubRepo && meta.github_repo) githubRepo = meta.github_repo;
      if (!upstreamRepo && meta.upstream_repo) upstreamRepo = meta.upstream_repo;
      if (meta.is_fork) isFork = true;
      if (typeof meta.can_push === "boolean") canPush = meta.can_push;
      if (meta.is_third_party) isThirdParty = true;
    } catch {}

    const currentUser = this.cachedAuth?.user?.login;
    if (githubRepo && currentUser) {
      const repoOwner = githubRepo.split("/")[0];
      if (repoOwner.toLowerCase() !== currentUser.toLowerCase() && !isFork) {
        canPush = false;
        isThirdParty = true;
      }
    }

    const upstreamUrl = upstreamRepo ? `https://github.com/${upstreamRepo}` : null;

    // 3. Uncommitted working tree changes
    const statusRes = await this.runGit(projectPath, ["status", "--porcelain"]);
    const uncommittedFiles = statusRes.stdout
      ? statusRes.stdout
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean)
      : [];
    const uncommittedCount = uncommittedFiles.length;

    // 4. Ahead & Behind remote tracking commits
    let aheadCount = 0;
    let behindCount = 0;

    if (hasRemote) {
      // Test if tracking branch exists
      const revListRes = await this.runGit(projectPath, [
        "rev-list",
        "--left-right",
        "--count",
        `origin/${activeBranch}...HEAD`,
      ], 5000);

      if (revListRes.exitCode === 0 && revListRes.stdout) {
        const parts = revListRes.stdout.split(/\s+/);
        if (parts.length >= 2) {
          behindCount = parseInt(parts[0], 10) || 0;
          aheadCount = parseInt(parts[1], 10) || 0;
        }
      } else {
        // If remote branch doesn't exist yet on remote, all local commits are ahead
        const countRes = await this.runGit(projectPath, ["rev-list", "--count", "HEAD"], 5000);
        aheadCount = parseInt(countRes.stdout, 10) || 0;
      }
    }

    // 5. Last commit details
    let lastCommit: ProjectGitStatus["last_commit"] = null;
    const logRes = await this.runGit(projectPath, ["log", "-1", "--format=%h|%an|%cr|%s"]);
    if (logRes.exitCode === 0 && logRes.stdout) {
      const [hash, author, relative_date, message] = logRes.stdout.split("|");
      lastCommit = {
        hash: hash || "",
        author: author || "",
        relative_date: relative_date || "",
        message: message || "",
      };
    }

    // 6. Branch details and hierarchy (parent/child relationships and remote presence)
    const branchState = await CheckpointManager.getBranches(projectPath).catch(() => null);
    const remoteBranchesRes = await this.runGit(projectPath, ["branch", "-r", "--list", "origin/*"]);
    const remoteBranchSet = new Set(
      remoteBranchesRes.stdout
        ? remoteBranchesRes.stdout
            .split("\n")
            .map((b) => b.trim().replace(/^origin\//, ""))
            .filter(Boolean)
        : []
    );

    const activeBranchMeta = branchState?.branches?.find(
      (b) => b.name === activeBranch || b.git_branch === activeBranch || b.name === branchState?.active_branch
    );
    const parentBranch =
      activeBranchMeta?.parent_branch || (activeBranch !== "main" && activeBranch !== "master" ? "main" : null);

    const branchDetails = (branchState?.branches || []).map((b) => {
      const hasRemoteTracking =
        remoteBranchSet.has(b.git_branch) || remoteBranchSet.has(b.name);
      const isActive =
        b.name === activeBranch ||
        b.git_branch === activeBranch ||
        (branchState && b.name === branchState.active_branch);
      return {
        name: b.name,
        git_branch: b.git_branch,
        parent_branch: b.parent_branch || (b.name !== "main" ? "main" : null),
        is_active: Boolean(isActive),
        has_remote_tracking: hasRemoteTracking,
      };
    });

    return {
      is_git_repo: true,
      active_branch: activeBranch,
      git_branch: activeBranch,
      has_remote: hasRemote,
      remote_url: remoteUrl,
      github_repo: githubRepo,
      github_url: githubUrl,
      upstream_repo: upstreamRepo,
      upstream_url: upstreamUrl,
      is_fork: isFork,
      can_push: canPush,
      is_third_party: isThirdParty,
      uncommitted_count: uncommittedCount,
      uncommitted_files: uncommittedFiles,
      ahead_count: aheadCount,
      behind_count: behindCount,
      last_commit: lastCommit,
      branches,
      parent_branch: parentBranch,
      branch_details: branchDetails,
    };
  }

  /**
   * Create a new GitHub repository under the user's account.
   */
  async createGitHubRepo(options: {
    name: string;
    description?: string;
    is_private?: boolean;
  }): Promise<{ full_name: string; html_url: string; clone_url: string }> {
    const token = await this.getToken();
    if (!token) {
      throw new Error("GitHub is not connected. Please connect your GitHub account first.");
    }

    const payload = {
      name: options.name.trim(),
      description: options.description?.trim() || "Created with crbn",
      private: options.is_private ?? true,
      auto_init: false,
    };

    const res = await fetch("https://api.github.com/user/repos", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "crbn-app",
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 422) {
      // Repository may already exist - fetch it
      const userRes = await this.fetchUserProfile(token);
      const existingRes = await fetch(`https://api.github.com/repos/${userRes.login}/${payload.name}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "crbn-app",
        },
      });
      if (existingRes.ok) {
        const existingData = (await existingRes.json()) as Record<string, unknown>;
        return {
          full_name: String(existingData.full_name),
          html_url: String(existingData.html_url),
          clone_url: String(existingData.clone_url),
        };
      }
    }

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to create GitHub repository (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as Record<string, unknown>;
    return {
      full_name: String(data.full_name),
      html_url: String(data.html_url),
      clone_url: String(data.clone_url),
    };
  }

  /**
   * Fork an upstream third-party repository and retarget local origin to the user's fork.
   */
  async forkAndRetargetProject(
    projectName: string,
    options?: { branch?: string; commit_message?: string }
  ): Promise<{
    success: boolean;
    fork_repo: string;
    fork_url: string;
    branch: string;
    pr_url: string;
  }> {
    const token = await this.getToken();
    if (!token) {
      throw new Error("GitHub is not connected. Please connect your GitHub account first.");
    }

    const project = await this.projectManager.getProject(projectName);
    const projectPath = project.path;

    // Read project metadata
    const metaPath = path.join(projectPath, ".80degrees_meta.json");
    let meta: Record<string, any> = {};
    if (fsSync.existsSync(metaPath)) {
      try {
        meta = JSON.parse(await fs.readFile(metaPath, "utf-8"));
      } catch {}
    }

    // Determine target upstream repo
    const remoteRes = await this.runGit(projectPath, ["remote", "get-url", "origin"]);
    const currentOrigin = remoteRes.exitCode === 0 ? this.extractGithubRepo(remoteRes.stdout) : null;
    const upstreamRepo = meta.upstream_repo || currentOrigin || meta.github_repo;

    if (!upstreamRepo) {
      throw new Error("No upstream GitHub repository found to fork.");
    }

    console.log(`[GithubService] Forking upstream ${upstreamRepo} for project ${projectName}...`);
    const forkInfo = await this.forkRepo(upstreamRepo);

    // Retarget origin to user's fork
    const authForkUrl = `https://x-access-token:${token}@github.com/${forkInfo.full_name}.git`;
    const checkOrigin = await this.runGit(projectPath, ["remote", "get-url", "origin"]);
    if (checkOrigin.exitCode === 0) {
      await this.runGit(projectPath, ["remote", "set-url", "origin", authForkUrl]);
    } else {
      await this.runGit(projectPath, ["remote", "add", "origin", authForkUrl]);
    }

    // Ensure upstream remote points to original repository
    const authUpstreamUrl = `https://x-access-token:${token}@github.com/${upstreamRepo}.git`;
    const checkUpstream = await this.runGit(projectPath, ["remote", "get-url", "upstream"]);
    if (checkUpstream.exitCode === 0) {
      await this.runGit(projectPath, ["remote", "set-url", "upstream", authUpstreamUrl]);
    } else {
      await this.runGit(projectPath, ["remote", "add", "upstream", authUpstreamUrl]);
    }

    // Update metadata
    meta.github_repo = forkInfo.full_name;
    meta.github_url = forkInfo.html_url;
    meta.upstream_repo = upstreamRepo;
    meta.upstream_url = `https://github.com/${upstreamRepo}`;
    meta.is_fork = true;
    meta.can_push = true;
    meta.is_third_party = false;
    await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");

    // Now push to origin (the user's fork)
    const pushResult = await this.pushProject(projectName, {
      branch: options?.branch,
      commit_message: options?.commit_message || `Fork and update from crbn`,
    });

    const prUrl = `https://github.com/${upstreamRepo}/compare/${meta.default_branch || "main"}...${forkInfo.owner}:${pushResult.branch}?expand=1`;

    return {
      success: true,
      fork_repo: forkInfo.full_name,
      fork_url: forkInfo.html_url,
      branch: pushResult.branch,
      pr_url: prUrl,
    };
  }

  /**
   * Push project commits to GitHub (with support for creating new remote repo if unpushed).
   */
  async pushProject(
    projectName: string,
    options: {
      create_repo?: boolean;
      repo_name?: string;
      target_repo?: string;
      is_private?: boolean;
      description?: string;
      commit_message?: string;
      branch?: string;
      push_all?: boolean;
      force?: boolean;
    }
  ): Promise<{
    success: boolean;
    branch: string;
    github_repo: string;
    github_url: string;
    commit_hash?: string;
    pushed_all?: boolean;
    pr_url?: string;
    is_fork?: boolean;
    upstream_repo?: string | null;
  }> {
    const token = await this.getToken();
    if (!token) {
      throw new Error("GitHub is not connected. Please connect your GitHub account first.");
    }

    const project = await this.projectManager.getProject(projectName);
    const projectPath = project.path;

    await CheckpointManager.ensureGitRepo(projectPath);

    // 1. Commit any uncommitted changes first so no work is lost
    const statusRes = await this.runGit(projectPath, ["status", "--porcelain"]);
    if (statusRes.stdout.trim().length > 0) {
      await this.runGit(projectPath, ["add", "-A"]);
      const msg = options.commit_message?.trim() || `Update from crbn: ${new Date().toLocaleString()}`;
      await this.runGit(projectPath, ["commit", "-m", msg]);
    }

    // 2. Identify local Git branch ref and remote target branch name
    const branchState = await CheckpointManager.getBranches(projectPath).catch(() => null);
    const activeBranchRes = await this.runGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const headGitBranch = activeBranchRes.stdout || "main";

    const requestedBranch = options.branch || branchState?.active_branch || headGitBranch;

    // Find matching branch in metadata
    const matchedBranch = branchState?.branches?.find(
      (b) => b.name === requestedBranch || b.git_branch === requestedBranch
    );

    // Determine actual local Git branch on disk
    let localGitBranch: string = headGitBranch;
    if (matchedBranch?.git_branch) {
      localGitBranch = matchedBranch.git_branch;
    } else {
      const checkDirect = await this.runGit(projectPath, ["rev-parse", "--verify", requestedBranch]);
      if (checkDirect.exitCode === 0) {
        localGitBranch = requestedBranch;
      } else {
        const prefixed = CheckpointManager.sanitizeGitBranchName(requestedBranch);
        const checkPrefixed = await this.runGit(projectPath, ["rev-parse", "--verify", prefixed]);
        if (checkPrefixed.exitCode === 0) {
          localGitBranch = prefixed;
        }
      }
    }

    // Determine clean remote branch name on GitHub
    let remoteBranchName = matchedBranch?.name || requestedBranch;
    if (remoteBranchName === "master" || localGitBranch === "master") {
      remoteBranchName = "main";
    }
    // 3. Remote configuration
    const remoteRes = await this.runGit(projectPath, ["remote", "get-url", "origin"]);
    let hasRemote = remoteRes.exitCode === 0 && Boolean(remoteRes.stdout);
    let fullRepoName: string | null = hasRemote ? this.extractGithubRepo(remoteRes.stdout) : null;

    // Check project metadata if remote url didn't yield repo name
    if (!fullRepoName) {
      try {
        const metaRaw = await fs.readFile(path.join(projectPath, ".80degrees_meta.json"), "utf-8");
        const meta = JSON.parse(metaRaw);
        if (meta.github_repo) fullRepoName = meta.github_repo;
      } catch {}
    }

    // If user specified an existing repo to push to
    if (options.target_repo && options.target_repo.trim()) {
      const trimmedTarget = options.target_repo
        .trim()
        .replace(/^https?:\/\/github\.com\//, "")
        .replace(/\.git$/, "");
      if (trimmedTarget.includes("/")) {
        fullRepoName = trimmedTarget;
      } else {
        const user = await this.fetchUserProfile(token);
        fullRepoName = `${user.login}/${trimmedTarget}`;
      }
      console.log(`[GithubService] Retargeting origin to existing repo "${fullRepoName}"...`);
      const authenticatedUrl = `https://x-access-token:${token}@github.com/${fullRepoName}.git`;
      if (hasRemote) {
        await this.runGit(projectPath, ["remote", "set-url", "origin", authenticatedUrl]);
      } else {
        await this.runGit(projectPath, ["remote", "add", "origin", authenticatedUrl]);
      }
      hasRemote = true;
    } else if (!hasRemote || !fullRepoName || options.create_repo) {
      const repoNameToCreate = options.repo_name?.trim() || projectName;
      console.log(`[GithubService] Creating new GitHub repo "${repoNameToCreate}" for project "${projectName}"...`);

      const created = await this.createGitHubRepo({
        name: repoNameToCreate,
        description: options.description || `crbn project: ${projectName}`,
        is_private: options.is_private ?? true,
      });

      fullRepoName = created.full_name;
      const authenticatedUrl = `https://x-access-token:${token}@github.com/${fullRepoName}.git`;

      if (hasRemote) {
        await this.runGit(projectPath, ["remote", "set-url", "origin", authenticatedUrl]);
      } else {
        await this.runGit(projectPath, ["remote", "add", "origin", authenticatedUrl]);
      }
      hasRemote = true;
    } else {
      // Ensure origin has the latest token embedded for seamless push
      const authenticatedUrl = `https://x-access-token:${token}@github.com/${fullRepoName}.git`;
      await this.runGit(projectPath, ["remote", "set-url", "origin", authenticatedUrl]);
    }
    // Read metadata and verify write access if pushing directly to existing origin
    const metaPath = path.join(projectPath, ".80degrees_meta.json");
    let meta: Record<string, any> = {};
    try {
      const raw = await fs.readFile(metaPath, "utf-8");
      meta = JSON.parse(raw);
    } catch {}

    const currentUser = this.cachedAuth?.user?.login;
    if (fullRepoName && currentUser && !options.create_repo && !options.target_repo) {
      const repoOwner = fullRepoName.split("/")[0];
      const isOwner = repoOwner.toLowerCase() === currentUser.toLowerCase();
      if (!isOwner && !meta.is_fork && meta.can_push === false) {
        throw new Error(
          `You do not have write access to "${fullRepoName}". Please choose "Fork & Push" to push to your own account, or "Publish as new repository".`
        );
      }
    }

    // 4. Push branch(es) to remote with upstream tracking
    if (options.push_all) {
      console.log(`[GithubService] Pushing ALL branches to origin (${fullRepoName})...`);
      const refspecs: string[] = [];
      if (branchState?.branches && branchState.branches.length > 0) {
        for (const b of branchState.branches) {
          const check = await this.runGit(projectPath, ["rev-parse", "--verify", b.git_branch]);
          if (check.exitCode === 0) {
            const rName = b.name === "master" || b.git_branch === "master" ? "main" : b.name;
            refspecs.push(`${b.git_branch}:${rName}`);
          }
        }
      }

      if (refspecs.length > 0) {
        const pushRes = await this.runGit(projectPath, ["push", "-u", "origin", ...refspecs], 120000);
        if (pushRes.exitCode !== 0) {
          const err = pushRes.stderr || pushRes.stdout;
          throw new Error(`Git push --all failed: ${err}`);
        }
      } else {
        const pushRes = await this.runGit(projectPath, ["push", "--all", "-u", "origin"], 120000);
        if (pushRes.exitCode !== 0) {
          const err = pushRes.stderr || pushRes.stdout;
          throw new Error(`Git push --all failed: ${err}`);
        }
      }
    } else {
      const refspec = `${localGitBranch}:${remoteBranchName}`;
      console.log(`[GithubService] Pushing refspec "${refspec}" to origin (${fullRepoName})...`);
      const pushArgs = ["push", "-u", "origin", refspec];
      if (options.force) {
        pushArgs.splice(1, 0, "--force-with-lease");
      }
      const pushRes = await this.runGit(projectPath, pushArgs, 60000);
      if (pushRes.exitCode !== 0) {
        // Fallback: try pushing local branch directly
        const fallbackArgs = ["push", "-u", "origin", localGitBranch];
        if (options.force) {
          fallbackArgs.splice(1, 0, "--force-with-lease");
        }
        const fallbackRes = await this.runGit(projectPath, fallbackArgs, 60000);
        if (fallbackRes.exitCode !== 0) {
          const err = pushRes.stderr || pushRes.stdout;
          throw new Error(`Git push failed: ${err}`);
        }
      }
    }
    // 5. Update .80degrees_meta.json with latest github info
    try {
      meta.github_repo = fullRepoName;
      meta.github_url = `https://github.com/${fullRepoName}`;
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    } catch {}

    const hashRes = await this.runGit(projectPath, ["rev-parse", "HEAD"]);

    console.log(`[GithubService] Successfully pushed ${projectName} (${remoteBranchName}) to ${fullRepoName}`);
    const prUrl = meta.upstream_repo
      ? `https://github.com/${meta.upstream_repo}/compare/${meta.default_branch || "main"}...${this.cachedAuth?.user?.login || ""}:${remoteBranchName}?expand=1`
      : undefined;

    return {
      success: true,
      branch: remoteBranchName,
      github_repo: fullRepoName,
      github_url: `https://github.com/${fullRepoName}`,
      commit_hash: hashRes.stdout || undefined,
      pushed_all: Boolean(options.push_all),
      pr_url: prUrl,
      is_fork: Boolean(meta.is_fork),
      upstream_repo: meta.upstream_repo || null,
    };
  }

  /**
   * Pull latest changes from remote tracking branch into local branch.
   */
  async pullProject(projectName: string, branch?: string): Promise<{ success: boolean; output: string }> {
    const token = await this.getToken();
    if (!token) {
      throw new Error("GitHub is not connected. Please connect your GitHub account first.");
    }

    const project = await this.projectManager.getProject(projectName);
    const projectPath = project.path;

    await CheckpointManager.ensureGitRepo(projectPath);

    // Commit local changes before pulling so nothing gets wiped
    const statusRes = await this.runGit(projectPath, ["status", "--porcelain"]);
    if (statusRes.stdout.trim().length > 0) {
      await this.runGit(projectPath, ["add", "-A"]);
      await this.runGit(projectPath, ["commit", "-m", "Auto-commit before pulling latest remote changes"]);
    }

    const activeBranchRes = await this.runGit(projectPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
    const currentBranch = branch || activeBranchRes.stdout || "main";

    // Ensure origin URL has token
    const remoteRes = await this.runGit(projectPath, ["remote", "get-url", "origin"]);
    const githubRepo = this.extractGithubRepo(remoteRes.stdout);
    if (githubRepo) {
      const authUrl = `https://x-access-token:${token}@github.com/${githubRepo}.git`;
      await this.runGit(projectPath, ["remote", "set-url", "origin", authUrl]);
    }

    const pullRes = await this.runGit(projectPath, ["pull", "origin", currentBranch], 60000);
    if (pullRes.exitCode !== 0) {
      throw new Error(`Git pull failed: ${pullRes.stderr || pullRes.stdout}`);
    }

    return {
      success: true,
      output: pullRes.stdout || "Already up to date.",
    };
  }
}
