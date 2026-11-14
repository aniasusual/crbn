import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { getAugmentedEnv } from "../runtime-env";
import {
  getCompanyRoster,
  LOCAL_ENGINEERING_UUID,
  ROLE_ALIASES,
  type AgentTemplatePackage,
  type ResolvedAgentMeta,
} from "./templates";

export interface SyncableMountFile {
  /** Mount-relative path inside agent-files/ (e.g. "COMPANY.md", "project/src/App.tsx", ".tools/bin/crbn-project") */
  path: string;
  content: string;
  sha256: string;
}

export interface ProjectContextBundle {
  companyName: string;
  projectName: string;
  tagline: string;
  description: string;
  htmlTitle?: string;
  htmlDescription?: string;
  initialPrompt?: string;
  recentPrompts: Array<{ step: number; prompt: string; commit: string; timestamp: string }>;
  techStack: string[];
  scripts: Record<string, string>;
  treeSummary: string;
  gitHistorySummary: string;
  companyMd: string;
  contextReadmeMd: string;
  codebaseMapMd: string;
  gitHistoryMd: string;
  mountFiles: SyncableMountFile[];
  roster?: ResolvedAgentMeta[];
}

const IGNORED_DIRS: Record<string, true> = {
  node_modules: true,
  ".git": true,
  dist: true,
  "dist-ssr": true,
  build: true,
  release: true,
  ".vite": true,
  ".vite-temp": true,
  ".next": true,
  ".turbo": true,
  ".vercel": true,
  ".80degrees": true,
  ".omp": true,
  ".crbn": true,
  company: true,
  coverage: true,
  __pycache__: true,
  ".venv": true,
  venv: true,
};

const IGNORED_FILES: Record<string, true> = {
  "bun.lock": true,
  "bun.lockb": true,
  "package-lock.json": true,
  "pnpm-lock.yaml": true,
  "yarn.lock": true,
  ".DS_Store": true,
  ".80degrees_chat.json": true,
  ".80degrees_checkpoints.json": true,
  ".80degrees_branches.json": true,
  ".80degrees_meta.json": true,
  ".80degrees_company.json": true,
};

const BINARY_EXTENSIONS: Record<string, true> = {
  ".png": true,
  ".jpg": true,
  ".jpeg": true,
  ".gif": true,
  ".webp": true,
  ".ico": true,
  ".icns": true,
  ".svg": true,
  ".mp3": true,
  ".wav": true,
  ".ogg": true,
  ".mp4": true,
  ".webm": true,
  ".mov": true,
  ".pdf": true,
  ".zip": true,
  ".tar": true,
  ".gz": true,
  ".woff": true,
  ".woff2": true,
  ".ttf": true,
  ".eot": true,
  ".otf": true,
  ".glb": true,
  ".gltf": true,
  ".fbx": true,
  ".obj": true,
  ".db": true,
  ".sqlite": true,
  ".sqlite3": true,
  ".wasm": true,
  ".node": true,
  ".dylib": true,
  ".so": true,
  ".dll": true,
  ".exe": true,
};

const GENERIC_TITLES: Record<string, true> = {
  "vite + react": true,
  "vite + react + ts": true,
  "react app": true,
  "80degrees-fullstack-app": true,
  "autonomous company application": true,
  document: true,
};

export const COMPANY_CONTEXT_START_MARKER = "<!-- 80DEGREES_COMPANY_CONTEXT_START -->";
export const COMPANY_CONTEXT_END_MARKER = "<!-- 80DEGREES_COMPANY_CONTEXT_END -->";

function makeMountFile(relPath: string, content: string): SyncableMountFile {
  const normalizedPath = relPath.replace(/^\/+/, "");
  return {
    path: normalizedPath,
    content,
    sha256: crypto.createHash("sha256").update(content, "utf8").digest("hex"),
  };
}

async function runGitCommand(projectPath: string, args: string[]): Promise<string> {
  if (!fsSync.existsSync(path.join(projectPath, ".git"))) {
    return "";
  }
  try {
    const proc = Bun.spawn(["git", ...args], {
      cwd: projectPath,
      stdout: "pipe",
      stderr: "pipe",
      env: getAugmentedEnv({ GIT_TERMINAL_PROMPT: "0" }),
    });
    const out = await new Response(proc.stdout).text().catch(() => "");
    await proc.exited;
    return out.trim();
  } catch {
    return "";
  }
}

interface WalkedFileEntry {
  relPath: string;
  size: number;
  priority: number;
}

function computeFilePriority(relPath: string): number {
  const lower = relPath.toLowerCase();
  if (lower === "package.json") return 100;
  if (lower === "readme.md") return 98;
  if (lower === "index.html") return 95;
  if (
    lower === "src/app.tsx" ||
    lower === "src/app.jsx" ||
    lower === "app/page.tsx" ||
    lower === "app/index.tsx"
  ) {
    return 92;
  }
  if (
    lower === "server/index.js" ||
    lower === "server/index.ts" ||
    lower === "src/index.ts" ||
    lower === "src/main.tsx" ||
    lower === "src/main.jsx"
  ) {
    return 88;
  }
  if (lower.startsWith("src/types") || lower.startsWith("types/")) return 84;
  if (lower.startsWith("src/data/") || lower.startsWith("data/")) return 80;
  if (lower.startsWith("src/components/") && !lower.includes("/ui/")) return 76;
  if (lower.startsWith("components/") && !lower.includes("/ui/")) return 74;
  if (lower.startsWith("server/")) return 72;
  if (lower.startsWith("src/lib/") || lower.startsWith("src/utils/") || lower.startsWith("utils/")) return 68;
  if (lower.startsWith("src/")) return 60;
  if (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".js") ||
    lower.endsWith(".jsx") ||
    lower.endsWith(".py") ||
    lower.endsWith(".md")
  ) {
    return 50;
  }
  return 20;
}

async function walkProjectFiles(
  rootDir: string,
  currentDir: string = rootDir,
  depth = 0,
  acc: WalkedFileEntry[] = []
): Promise<WalkedFileEntry[]> {
  if (depth > 5 || acc.length >= 250) return acc;
  let entries: fsSync.Dirent[] = [];
  try {
    entries = await fs.readdir(currentDir, { withFileTypes: true });
  } catch {
    return acc;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of entries) {
    if (acc.length >= 250) break;
    const name = entry.name;
    if (name.startsWith(".env")) continue;
    if (IGNORED_DIRS[name] || IGNORED_FILES[name]) continue;

    const fullPath = path.join(currentDir, name);
    const relPath = path.relative(rootDir, fullPath).split(path.sep).join("/");

    if (entry.isDirectory()) {
      await walkProjectFiles(rootDir, fullPath, depth + 1, acc);
    } else if (entry.isFile()) {
      const ext = path.extname(name).toLowerCase();
      if (BINARY_EXTENSIONS[ext]) continue;
      try {
        const st = await fs.stat(fullPath);
        acc.push({
          relPath,
          size: st.size,
          priority: computeFilePriority(relPath),
        });
      } catch {}
    }
  }
  return acc;
}

function buildCliBridgeScript(projectName: string, port: number): string {
  return `#!/bin/sh
# 80degrees Live Project Context Bridge
# Queries the running 80degrees desktop backend on the host, with automatic fallback to local agent-files/
OP="\${1:-summary}"
TARGET_PATH="\${2:-}"
PORT="\${CRBN_BACKEND_PORT:-${port}}"
PROJECT="${encodeURIComponent(projectName)}"
BASE_URL="http://host.docker.internal:\${PORT}/api/projects/\${PROJECT}/company/live-context"

if command -v node >/dev/null 2>&1; then
  node -e '
    const op = process.argv[1] || "summary";
    const rel = process.argv[2] || "";
    const baseUrl = process.argv[3];
    const url = baseUrl + "?op=" + encodeURIComponent(op) + (rel ? "&path=" + encodeURIComponent(rel) : "");
    fetch(url, { signal: AbortSignal.timeout(3000) })
      .then(async (res) => {
        if (!res.ok) throw new Error("HTTP " + res.status);
        process.stdout.write(await res.text());
      })
      .catch(() => {
        const fs = require("fs");
        const fallbackMap = {
          summary: "agent-files/COMPANY.md",
          tree: "agent-files/project/CODEBASE_MAP.md",
          log: "agent-files/project/GIT_HISTORY.md",
          diff: "agent-files/project/GIT_HISTORY.md",
          read: rel ? "agent-files/project/" + rel.replace(/^\\/+/, "") : "agent-files/COMPANY.md"
        };
        const target = fallbackMap[op] || "agent-files/COMPANY.md";
        if (fs.existsSync(target)) {
          process.stdout.write(fs.readFileSync(target, "utf8"));
        } else {
          process.stderr.write("File not found in live host or agent-files/: " + target + "\\n");
          process.exit(1);
        }
      });
  ' "$OP" "$TARGET_PATH" "$BASE_URL"
else
  case "$OP" in
    tree) cat agent-files/project/CODEBASE_MAP.md 2>/dev/null ;;
    log|diff) cat agent-files/project/GIT_HISTORY.md 2>/dev/null ;;
    read) cat "agent-files/project/\${TARGET_PATH}" 2>/dev/null ;;
    *) cat agent-files/COMPANY.md 2>/dev/null ;;
  esac
fi
`;
}

export interface BlackboardCliOptions {
  selfRole?: string;
  selfAgentId?: string;
  selfAgentName?: string;
  roleUuidMap?: Record<string, string>;
}

export function buildBlackboardCliScript(
  projectName: string,
  port: number,
  projId: string,
  authHeader: string,
  options?: BlackboardCliOptions
): SyncableMountFile {
  const selfRole = options?.selfRole || "";
  const selfAgentId = options?.selfAgentId || "";
  const selfAgentName = options?.selfAgentName || "";
  const roleUuidMap = options?.roleUuidMap || {};

  const script = `#!/bin/sh
# 80degrees Multi-Agent Blackboard CLI
# Enables all company agents (baseline and custom) to share a Kanban task ledger,
# publish cross-team artifacts, and queue 1-click founder approvals in Agenta.
exec node -e '
  const [cmd = "briefing", ...args] = process.argv.slice(1);
  const projId = ${JSON.stringify(projId)};
  const authHeader = ${JSON.stringify(authHeader)};
  const projectName = ${JSON.stringify(projectName)};
  const hostPort = process.env.CRBN_BACKEND_PORT || ${JSON.stringify(String(port))};
  const selfRole = ${JSON.stringify(selfRole)};
  const selfAgentId = ${JSON.stringify(selfAgentId)};
  const selfAgentName = ${JSON.stringify(selfAgentName)};
  const fallbackRoleMap = ${JSON.stringify(roleUuidMap)};
  const roleAliases = ${JSON.stringify(ROLE_ALIASES)};
  const localEngUuid = ${JSON.stringify(LOCAL_ENGINEERING_UUID)};
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  const candidates = [
    "http://host.docker.internal:" + hostPort + "/api/projects/" + encodeURIComponent(projectName) + "/company/blackboard",
    "http://api:8000/api/blackboard",
    "http://localhost/api/blackboard"
  ];

  const apiBases = [
    "http://api:8000/api",
    "http://localhost/api"
  ];

  async function request(path, method = "GET", body = undefined) {
    const sep = path.includes("?") ? "&" : "?";
    const fullPath = path + sep + "project_id=" + encodeURIComponent(projId);
    let lastErr;
    for (const base of candidates) {
      try {
        const res = await fetch(base + fullPath, {
          method,
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json"
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(5000)
        });
        if (res.ok) {
          return await res.json();
        }
        lastErr = new Error("HTTP " + res.status + ": " + (await res.text()));
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("Blackboard unreachable");
  }

  function initialsOf(name) {
    const words = String(name || "")
      .replace(/[^a-zA-Z0-9\\s_-]/g, " ")
      .split(/[\\s_-]+/)
      .filter(w => w && !["and", "of", "the", "for", "to"].includes(w.toLowerCase()));
    if (words.length >= 2) return words.slice(0, 3).map(w => w[0].toUpperCase()).join("");
    return String(name || "").replace(/[^a-zA-Z0-9]/g, "").slice(0, 3).toUpperCase() || "AG";
  }

  async function fetchLiveWorkflows() {
    for (const base of apiBases) {
      try {
        const res = await fetch(base + "/workflows/query?project_id=" + encodeURIComponent(projId), {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            workflow: { flags: { is_application: true, is_evaluator: false, is_snippet: false } },
            flags: { is_application: true, is_evaluator: false }
          }),
          signal: AbortSignal.timeout(3000)
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.workflows)) {
            return data.workflows.filter(w => {
              if (!w || !w.id) return false;
              if (w.flags && (w.flags.is_evaluator === true || w.flags.is_snippet === true)) return false;
              const n = String(w.name || "").toLowerCase().trim();
              return n !== "exact match" && n !== "contains json" && n !== "quality rating";
            });
          }
        }
      } catch {}
    }
    return null;
  }

  async function fetchLatestSessionId() {
    const envSess = process.env.AGENTA_SESSION_ID || process.env.SESSION_ID;
    if (envSess && typeof envSess === "string" && envSess.trim()) {
      return envSess.trim();
    }
    if (!selfAgentId || !uuidRe.test(selfAgentId)) return undefined;
    for (const base of apiBases) {
      try {
        const res = await fetch(base + "/sessions/query?project_id=" + encodeURIComponent(projId), {
          method: "POST",
          headers: {
            Authorization: authHeader,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            turn_references: [{ key: "workflow", id: selfAgentId }],
            include_ended: true,
            windowing: { limit: 1, order: "descending" }
          }),
          signal: AbortSignal.timeout(2500)
        });
        if (res.ok) {
          const data = await res.json();
          const first = Array.isArray(data.sessions) ? data.sessions[0] : undefined;
          if (first && first.session_id) return String(first.session_id);
        }
      } catch {}
    }
    return undefined;
  }

  async function resolveAssignee(raw) {
    if (!raw || typeof raw !== "string") return undefined;
    const clean = raw.trim();
    if (!clean) return undefined;
    const lower = clean.toLowerCase();
    if (roleAliases[lower] === "engineering" || lower === localEngUuid) {
      return localEngUuid;
    }
    const liveWfs = await fetchLiveWorkflows();
    if (Array.isArray(liveWfs) && liveWfs.length > 0) {
      if (uuidRe.test(lower)) {
        const exactWf = liveWfs.find(w => String(w.id || "").toLowerCase() === lower);
        if (exactWf) return exactWf.id;
      }
      const aliasTarget = roleAliases[lower] || lower;
      for (const wf of liveWfs) {
        const wfId = String(wf.id || "");
        const wfName = String(wf.name || "").toLowerCase().trim();
        const wfSlug = String(wf.slug || "").toLowerCase().trim();
        const originKey = String((wf.meta && wf.meta._ag && wf.meta._ag.template_origin && wf.meta._ag.template_origin.key) || "").toLowerCase().trim();
        const init = initialsOf(wf.name || wf.slug).toLowerCase();
        const targetTpl = roleAliases[aliasTarget] ? aliasTarget : lower;
        if (
          wfName === lower ||
          wfSlug === lower ||
          wfSlug.startsWith(lower + "-") ||
          wfSlug.startsWith(targetTpl + "-") ||
          originKey === lower ||
          originKey === (
            targetTpl === "ops" ? "weekly-report" :
            targetTpl === "changelog" ? "changelog-writer" :
            targetTpl === "qa" ? "pr-reviewer" :
            targetTpl === "growth" ? "seo-content-agent" :
            targetTpl === "copywriter" ? "content-repurposer" :
            targetTpl === "sales" ? "outbound-prospecting" :
            targetTpl === "support" ? "support-reply-drafter" : ""
          ) ||
          init === lower ||
          wfName.includes(lower)
        ) {
          return wfId;
        }
      }
      return undefined;
    }
    if (fallbackRoleMap[lower]) return fallbackRoleMap[lower];
    const alias = roleAliases[lower];
    if (alias && fallbackRoleMap[alias]) return fallbackRoleMap[alias];
    if (uuidRe.test(lower)) return lower;
    return undefined;
  }

  function looksLikeDepsCsv(val) {
    if (!val || typeof val !== "string") return false;
    const parts = val.split(",").map(s => s.trim()).filter(Boolean);
    return parts.length > 0 && parts.every(p => uuidRe.test(p));
  }

  (async () => {
    let out;
    if (cmd === "briefing") {
      out = await request("/briefing");
    } else if (cmd === "agents" || cmd === "roster") {
      const liveWfs = await fetchLiveWorkflows();
      const list = Array.isArray(liveWfs)
        ? liveWfs.map(w => ({
            id: w.id,
            name: w.name || w.slug,
            slug: w.slug,
            initials: initialsOf(w.name || w.slug),
            description: w.description || ""
          }))
        : [];
      list.push({ id: localEngUuid, name: "Engineering Agent", slug: "engineering", initials: "ENG", description: "80degrees Coding Agent" });
      out = { count: list.length, agents: list };
    } else if (cmd === "tasks" || cmd === "task-list") {
      const status = args[0] ? "?status=" + encodeURIComponent(args[0]) : "";
      out = await request("/tasks" + status);
    } else if (cmd === "task-create") {
      const [title, description = "", priority = "medium", arg4 = "", arg5 = ""] = args;
      if (!title) throw new Error("Usage: blackboard task-create <title> [description] [priority] [deps_csv] [assignee]");
      let depsCsv = "";
      let assigneeRaw = "";
      if (arg5) {
        depsCsv = arg4;
        assigneeRaw = arg5;
      } else if (arg4) {
        if (looksLikeDepsCsv(arg4)) {
          depsCsv = arg4;
        } else {
          assigneeRaw = arg4;
        }
      }
      const dependencies = depsCsv ? depsCsv.split(",").map(s => s.trim()).filter(p => uuidRe.test(p)) : [];
      const assigneeUuid = assigneeRaw
        ? await resolveAssignee(assigneeRaw)
        : (selfAgentId && uuidRe.test(selfAgentId) ? selfAgentId : undefined);
      const autoInProgress =
        dependencies.length === 0 &&
        Boolean(assigneeUuid && assigneeUuid !== localEngUuid);
      out = await request("/tasks", "POST", {
        title,
        description,
        priority,
        dependencies,
        ...(autoInProgress ? { status: "in_progress" } : {}),
        ...(assigneeUuid ? { assignee_agent_id: assigneeUuid } : {}),
        ...(assigneeRaw ? { assignee_role: assigneeRaw } : (selfRole ? { assignee_role: selfRole } : {}))
      });
    } else if (cmd === "task-update") {
      const [taskId, status, commitHash, assigneeArg] = args;
      if (!taskId || !status) throw new Error("Usage: blackboard task-update <task_id> <status> [commit_hash] [assignee]");
      const assigneeUuid = assigneeArg ? await resolveAssignee(assigneeArg) : undefined;
      out = await request("/tasks/" + encodeURIComponent(taskId), "PATCH", {
        status,
        ...(commitHash ? { commit_hash: commitHash } : {}),
        ...(assigneeUuid ? { assignee_agent_id: assigneeUuid } : {})
      });
    } else if (cmd === "artifacts" || cmd === "artifact-list") {
      const type = args[0] ? "?type=" + encodeURIComponent(args[0]) : "";
      out = await request("/artifacts" + type);
    } else if (cmd === "artifact-create") {
      const [type = "generic", title = "Artifact", rawJson = "{}", taskId] = args;
      let data = {};
      try { data = JSON.parse(rawJson); } catch { data = { content: rawJson }; }
      if (data && typeof data === "object" && !Array.isArray(data)) {
        if (selfRole && !data.agent_role) data.agent_role = selfRole;
        if (selfAgentName && !data.agent_name) data.agent_name = selfAgentName;
        if (!data.session_id) {
          const sid = await fetchLatestSessionId();
          if (sid) data.session_id = sid;
        }
      }
      out = await request("/artifacts", "POST", {
        type,
        title,
        data,
        ...(selfAgentId && uuidRe.test(selfAgentId) ? { agent_id: selfAgentId } : {}),
        ...(taskId && uuidRe.test(taskId) ? { task_id: taskId } : {})
      });
    } else if (cmd === "approvals" || cmd === "approval-list") {
      const status = args[0] ? "?status=" + encodeURIComponent(args[0]) : "";
      out = await request("/approvals" + status);
    } else if (cmd === "approval-request") {
      const [actionType, rawPayload = "{}", taskId] = args;
      if (!actionType) throw new Error("Usage: blackboard approval-request <action_type> <json_payload> [task_id]");
      let payload = {};
      try { payload = JSON.parse(rawPayload); } catch { payload = { summary: rawPayload }; }
      if (payload && typeof payload === "object" && !Array.isArray(payload)) {
        if (selfRole && !payload.agent_role) payload.agent_role = selfRole;
        if (selfAgentName && !payload.agent_name) payload.agent_name = selfAgentName;
        if (!payload.session_id) {
          const sid = await fetchLatestSessionId();
          if (sid) payload.session_id = sid;
        }
      }
      out = await request("/approvals", "POST", {
        action_type: actionType,
        payload,
        ...(selfAgentId && uuidRe.test(selfAgentId) ? { agent_id: selfAgentId } : {}),
        ...(taskId && uuidRe.test(taskId) ? { task_id: taskId } : {})
      });
    } else {
      throw new Error("Unknown command: " + cmd + ". Valid commands: briefing, agents, tasks, task-create, task-update, artifacts, artifact-create, approvals, approval-request");
    }
    process.stdout.write(JSON.stringify(out, null, 2) + "\\n");
  })().catch((err) => {
    process.stderr.write("[blackboard] " + (err && err.message ? err.message : String(err)) + "\\n");
    process.exit(1);
  });
' "$@"
`;
  return makeMountFile(".tools/bin/blackboard", script);
}

export async function buildProjectContextBundle(
  projectPath: string,
  projectName: string,
  companyName?: string,
  taglineInput?: string,
  activeAgents?: Array<Partial<ResolvedAgentMeta>>
): Promise<ProjectContextBundle> {
  const rawInputName = (companyName || projectName).trim();
  let formattedCompanyName =
    rawInputName
      .split(/[-_]+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
      .trim() || projectName;
  let pkgDesc = "";
  let scripts: Record<string, string> = {};
  const techStackSet = new Set<string>();

  // 1. Parse package.json
  try {
    const pkgPath = path.join(projectPath, "package.json");
    if (fsSync.existsSync(pkgPath)) {
      const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8"));
      if (typeof pkg.description === "string") pkgDesc = pkg.description.trim();
      if (pkg.scripts && typeof pkg.scripts === "object") {
        scripts = pkg.scripts as Record<string, string>;
      }
      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };
      for (const dep of Object.keys(allDeps)) {
        if (dep === "react") techStackSet.add("React");
        else if (dep === "next") techStackSet.add("Next.js");
        else if (dep === "vite") techStackSet.add("Vite");
        else if (dep.includes("tailwind")) techStackSet.add("Tailwind CSS");
        else if (dep === "three" || dep.startsWith("@react-three")) techStackSet.add("Three.js / 3D WebGL");
        else if (dep === "express") techStackSet.add("Express API");
        else if (dep === "framer-motion" || dep === "gsap") techStackSet.add(dep);
        else if (dep === "recharts") techStackSet.add("Recharts");
        else if (dep === "lucide-react") techStackSet.add("Lucide Icons");
        else if (dep === "expo" || dep === "react-native") techStackSet.add("React Native / Expo");
      }
    }
  } catch {}

  // 2. Parse index.html (<title> and <meta name="description">)
  let htmlTitle: string | undefined;
  let htmlDescription: string | undefined;
  try {
    const indexPath = path.join(projectPath, "index.html");
    if (fsSync.existsSync(indexPath)) {
      const html = await fs.readFile(indexPath, "utf-8");
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (titleMatch?.[1]) {
        const cleaned = titleMatch[1].replace(/\s+/g, " ").trim();
        if (cleaned && !GENERIC_TITLES[cleaned.toLowerCase()]) {
          htmlTitle = cleaned;
        }
      }
      const descMatch =
        html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i) ||
        html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
      if (descMatch?.[1]) {
        const cleaned = descMatch[1].replace(/\s+/g, " ").trim();
        if (cleaned) {
          htmlDescription = cleaned;
        }
      }
    }
  } catch {}

  // 3. Parse README.md
  let readmeSummary = "";
  try {
    const readmePath = path.join(projectPath, "README.md");
    if (fsSync.existsSync(readmePath)) {
      const readmeContent = await fs.readFile(readmePath, "utf-8");
      const lines = readmeContent
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      for (const line of lines) {
        if (!line.startsWith("#") && line.length > 20) {
          readmeSummary = line.slice(0, 240);
          break;
        }
      }
    }
  } catch {}

  // 4. Parse .80degrees_checkpoints.json for founder prompts & milestones
  let initialPrompt: string | undefined;
  const recentPrompts: Array<{ step: number; prompt: string; commit: string; timestamp: string }> = [];
  try {
    const cpPath = path.join(projectPath, ".80degrees_checkpoints.json");
    if (fsSync.existsSync(cpPath)) {
      const cpData = JSON.parse(await fs.readFile(cpPath, "utf-8")) as {
        steps?: Array<{
          step_number?: number;
          commit_hash?: string;
          prompt?: string;
          timestamp?: string;
        }>;
      };
      const steps = Array.isArray(cpData.steps) ? cpData.steps : [];
      const userSteps = steps.filter(
        (s) =>
          s.prompt &&
          s.prompt !== "Initial Project State" &&
          s.prompt.toLowerCase() !== "continue"
      );
      if (userSteps[0]?.prompt) {
        initialPrompt = userSteps[0].prompt.trim();
      }
      for (const s of steps.slice(-15)) {
        if (!s.prompt) continue;
        recentPrompts.push({
          step: s.step_number ?? 0,
          prompt: s.prompt,
          commit: (s.commit_hash || "").slice(0, 8),
          timestamp: s.timestamp || "",
        });
      }
    }
  } catch {}

  // If the folder/input name looks like a raw prompt or URL slug (e.g. "httpslearnarduinoredvercelappiwantyou" or "buildmeanotesapp"),
  // prefer the clean product name from <title> in index.html when available.
  const compactSlug = projectName.toLowerCase().replace(/[-_\s]+/g, "");
  const looksLikePromptOrUrlSlug =
    /^https?/i.test(compactSlug) ||
    /^(build|buidl|create|make|clone|design)me/i.test(compactSlug) ||
    compactSlug.includes("vercelapp") ||
    compactSlug.includes("iwantyou") ||
    (!projectName.includes("-") && !projectName.includes("_") && projectName.length > 18);
  const normalizedInput = rawInputName.toLowerCase().replace(/[-_\s]+/g, "");
  if (htmlTitle && looksLikePromptOrUrlSlug && normalizedInput === compactSlug) {
    const brandPart = htmlTitle.split(/\s+[—–|-]\s+/)[0]?.trim() || htmlTitle;
    if (brandPart.length >= 2 && brandPart.length <= 48) {
      formattedCompanyName = brandPart;
    }
  }

  // Resolve best human-readable product description
  const resolvedDescription =
    (pkgDesc && !GENERIC_TITLES[pkgDesc.toLowerCase()] ? pkgDesc : "") ||
    htmlDescription ||
    readmeSummary ||
    htmlTitle ||
    (initialPrompt ? `Built from founder vision: "${initialPrompt}"` : "") ||
    `Full-stack application for ${formattedCompanyName}`;

  const tagline =
    taglineInput && !taglineInput.startsWith("Autonomous business ")
      ? taglineInput
      : htmlTitle || resolvedDescription.slice(0, 120);
  // 5. Walk project source files & build CODEBASE_MAP.md
  const walkedFiles = await walkProjectFiles(projectPath);
  const treeLines = walkedFiles.map(
    (f) => `- \`${f.relPath}\` (${f.size >= 1024 ? `${(f.size / 1024).toFixed(1)} KB` : `${f.size} B`})`
  );
  const treeSummary = treeLines.length > 0 ? treeLines.join("\n") : "- (No source files detected yet)";

  // Select top priority source files to sync directly into agent-files/project/<relPath>
  const topSourceFiles = [...walkedFiles]
    .filter((f) => f.size > 0 && f.size <= 36_000)
    .sort((a, b) => b.priority - a.priority || a.relPath.localeCompare(b.relPath))
    .slice(0, 18);

  const syncedSourceFiles: SyncableMountFile[] = [];
  const keyFilePreviews: string[] = [];

  for (const fileEntry of topSourceFiles) {
    try {
      const abs = path.join(projectPath, fileEntry.relPath);
      const raw = await fs.readFile(abs, "utf-8");
      syncedSourceFiles.push(makeMountFile(`project/${fileEntry.relPath}`, raw));

      if (
        fileEntry.relPath === "package.json" ||
        fileEntry.relPath === "index.html" ||
        fileEntry.relPath === "src/App.tsx" ||
        fileEntry.relPath === "src/App.jsx" ||
        fileEntry.relPath === "server/index.js" ||
        fileEntry.relPath === "server/index.ts"
      ) {
        const snippet = raw.split("\n").slice(0, 45).join("\n");
        keyFilePreviews.push(`### \`${fileEntry.relPath}\` (Preview)\n\`\`\`\n${snippet}\n\`\`\``);
      }
    } catch {}
  }

  // 6. Gather Git log, working tree status, and latest commit diff
  const [gitStatus, gitLog, gitLatestDiff, gitWorkingDiff] = await Promise.all([
    runGitCommand(projectPath, ["status", "--short"]),
    runGitCommand(projectPath, ["log", "-n", "25", "--stat", "--date=short", "--pretty=format:%h | %ad | %s"]),
    runGitCommand(projectPath, ["show", "--stat", "-p", "-n", "1", "HEAD"]),
    runGitCommand(projectPath, ["diff", "HEAD"]),
  ]);

  const techStack = Array.from(techStackSet);
  const milestoneLines =
    recentPrompts.length > 0
      ? recentPrompts
          .map((m) => `- **Step ${m.step}** (\`${m.commit || "work"}\`): ${m.prompt}`)
          .join("\n")
      : "- Initial project scaffolding";
  const roster = getCompanyRoster(activeAgents);
  const departmentLines = roster
    .map((ag) => `- **${ag.name} (\`${ag.id}\` / \`${ag.initials}\`)**: ${ag.role}`)
    .join("\n");

  const companyMd = `# ${formattedCompanyName}

> ${tagline}

## Product Overview
${resolvedDescription}
${htmlTitle && htmlTitle !== tagline ? `\n- **Application Title**: ${htmlTitle}` : ""}
${htmlDescription && htmlDescription !== resolvedDescription ? `\n- **Meta Description**: ${htmlDescription}` : ""}
${initialPrompt ? `\n- **Founder's Initial Build Prompt**: "${initialPrompt}"` : ""}
- **Local Project Name**: \`${projectName}\`
- **Tech Stack**: ${techStack.length > 0 ? techStack.join(", ") : "TypeScript / JavaScript, Vite, React, Bun"}

## Recent Engineering Milestones & Prompts (in 80degrees)
${milestoneLines}

## Project File Structure (${walkedFiles.length} source files)
All key project files are synced into your durable workspace under \`agent-files/project/\`:
${treeLines.slice(0, 40).join("\n")}${treeLines.length > 40 ? `\n- ... (${treeLines.length - 40} more files in \`agent-files/project/CODEBASE_MAP.md\`)` : ""}

## Autonomous Operating Departments
${departmentLines}
`;

  const codebaseMapMd = `# Codebase Map — ${formattedCompanyName} (\`${projectName}\`)

## Overview
- **Product**: ${resolvedDescription}
- **Tech Stack**: ${techStack.length > 0 ? techStack.join(", ") : "Vite / React / Node"}
- **NPM Scripts**: ${Object.keys(scripts).length > 0 ? Object.entries(scripts).map(([k, v]) => `\`${k}\` (\`${v}\`)`).join(", ") : "standard"}

## Synced Source Files in \`agent-files/project/\`
The following files from the user's \`crbn\` workspace are available directly inside \`agent-files/project/\`:
${syncedSourceFiles.map((f) => `- \`agent-files/${f.path}\``).join("\n")}

## Complete Project File Tree
${treeSummary}

## Entrypoint Previews
${keyFilePreviews.join("\n\n")}
`;

  const boundedLatestDiff = gitLatestDiff ? gitLatestDiff.slice(0, 20_000) : "(No commit diff available)";
  const boundedWorkingDiff = gitWorkingDiff ? gitWorkingDiff.slice(0, 12_000) : "";

  const gitHistoryMd = `# Git & Engineering History — ${formattedCompanyName} (\`${projectName}\`)

## Founder Prompt & Checkpoint Timeline
${milestoneLines}

## Working Tree Status (\`git status --short\`)
\`\`\`text
${gitStatus || "Clean working tree"}
\`\`\`
${boundedWorkingDiff ? `\n## Uncommitted Working Tree Changes (\`git diff HEAD\`)\n\`\`\`diff\n${boundedWorkingDiff}\n\`\`\`\n` : ""}
## Recent Git Commits (\`git log -n 25 --stat\`)
\`\`\`text
${gitLog || "No git commits recorded yet."}
\`\`\`

## Latest Commit Diff (\`git show HEAD\`)
\`\`\`diff
${boundedLatestDiff}
\`\`\`
`;

  const activePort = Number(process.env.BACKEND_PORT || process.env.PORT || 8000);
  const cliBridgeContent = buildCliBridgeScript(projectName, activePort);

  const mountFiles: SyncableMountFile[] = [
    makeMountFile("COMPANY.md", companyMd),
    makeMountFile("00-context/README.md", companyMd),
    makeMountFile("agent-files/00-context/README.md", companyMd),
    makeMountFile("project/COMPANY.md", companyMd),
    makeMountFile("project/CODEBASE_MAP.md", codebaseMapMd),
    makeMountFile("project/GIT_HISTORY.md", gitHistoryMd),
    makeMountFile(".tools/bin/crbn-project", cliBridgeContent),
    ...syncedSourceFiles,
  ];

  return {
    companyName: formattedCompanyName,
    projectName,
    tagline,
    description: resolvedDescription,
    htmlTitle,
    htmlDescription,
    initialPrompt,
    recentPrompts,
    techStack,
    scripts,
    treeSummary,
    gitHistorySummary: gitLog.slice(0, 2000),
    companyMd,
    contextReadmeMd: companyMd,
    codebaseMapMd,
    gitHistoryMd,
    mountFiles,
    roster,
  };
}

/**
 * Merges the live 80degrees company & codebase context block into an agent's AGENTS.md
 * while preserving the underlying Agenta template's native skill/workflow playbook.
 */
export function mergeCompanyContextIntoAgentsMd(
  agent: {
    id: string;
    name: string;
    role?: string;
    description?: string;
    instructionsPrompt?: (projectName: string, projectDesc?: string) => string;
  },
  bundle: ProjectContextBundle,
  existingAgentsMd?: string
): string {
  const rolePrompt =
    typeof agent.instructionsPrompt === "function"
      ? agent.instructionsPrompt(bundle.companyName, bundle.description).trim()
      : `# ${agent.name}\n\nYou are **${agent.name}** (${agent.role || agent.description || "Specialist Agent"}) for **${bundle.companyName}** (${bundle.description}).`;
  const recentMilestonesPreview =
    bundle.recentPrompts.length > 0
      ? bundle.recentPrompts
          .slice(-6)
          .map((m) => `  - Step ${m.step} (\`${m.commit || "latest"}\`): ${m.prompt}`)
          .join("\n")
      : "  - Initial application scaffold";

  const subagentRosterLines =
    agent.id === "ops"
      ? (bundle.roster || getCompanyRoster())
          .filter((r) => r.id !== "ops" && !r.isEngineering)
          .map(
            (r) =>
              `- **${r.name}** (\`${r.slug || r.id}\` / \`${r.initials}\`${r.isCustom ? ", Custom Agent" : ""}): ${r.role}`
          )
          .join("\n")
      : "";
  const subagentSection =
    agent.id === "ops" && subagentRosterLines
      ? `\n## Attached Subagents (1-Hop Direct Delegation)\nThe following specialist agents are wired into your **Subagents** tool list and can be called directly (and in parallel when independent) during your turn:\n${subagentRosterLines}\n- If a Subagent returns a clarifying question, answer it from \`agent-files/COMPANY.md\` / \`agent-files/project/\` and invoke the Subagent again; only ask the founder if human business input is required.\n`
      : "";

  const contextBlock = `${COMPANY_CONTEXT_START_MARKER}
${rolePrompt}
${subagentSection}
## Live Company & Codebase Context (${bundle.companyName})
- **Product**: ${bundle.description}
${bundle.htmlTitle ? `- **App Title**: ${bundle.htmlTitle}\n` : ""}${bundle.initialPrompt ? `- **Founder's Build Prompt**: "${bundle.initialPrompt}"\n` : ""}- **Tech Stack**: ${bundle.techStack.length > 0 ? bundle.techStack.join(", ") : "React, Vite, TypeScript/JavaScript"}
- **Recent Engineering Commits**:
${recentMilestonesPreview}

## Workspace Files & Live Host Bridge
Your workspace is pre-populated with the live project from 80degrees (\`crbn\`):
- \`agent-files/COMPANY.md\` & \`agent-files/00-context/README.md\`: Product overview, milestones, and department roster.
- \`agent-files/project/CODEBASE_MAP.md\`: Full file tree, scripts, and entrypoint previews.
- \`agent-files/project/GIT_HISTORY.md\`: Commit log (\`git log --stat\`) and latest diff.
- \`agent-files/project/...\`: Synced source files (\`package.json\`, \`index.html\`, \`src/...\`, \`server/...\`).
- \`.tools/bin/crbn-project <summary|tree|log|diff|read> [path]\`: Live query bridge to the host IDE.

## Shared Blackboard CLI (\`.tools/bin/blackboard\`)
Coordinate across departments and the Founder UI using \`.tools/bin/blackboard\`:
- \`.tools/bin/blackboard briefing\` — Situational summary & counts
- \`.tools/bin/blackboard agents\` — List all currently active company agents (baseline & custom) and their IDs
- \`.tools/bin/blackboard tasks [status]\` — List Kanban tasks
- \`.tools/bin/blackboard task-create "<title>" "<desc>" [low|medium|high|urgent] [dep_uuid_csv] [assignee_slug_or_initials]\` — Create task and assign to an active specialist (e.g. \`ops\`, \`qa\`, \`growth\`, \`copywriter\`, \`engineering\`, or any custom agent slug/initials)
- \`.tools/bin/blackboard task-update <task_id> <backlog|in_progress|review|done|blocked> [commit_hash] [assignee]\`
- \`.tools/bin/blackboard artifacts [type]\` / \`artifact-create <type> "<title>" '<json>' [task_id]\`
- \`.tools/bin/blackboard approval-request <deploy_prod|publish_post|send_campaign|refund> '<json>' [task_id]\`
**CRITICAL**: Never ask the founder to fill out setup templates or describe ${bundle.companyName} from scratch—read \`agent-files/COMPANY.md\` and \`agent-files/project/\` directly.
${COMPANY_CONTEXT_END_MARKER}`;

  let strippedExisting = (existingAgentsMd || "").trim();
  if (strippedExisting.includes(COMPANY_CONTEXT_START_MARKER) && strippedExisting.includes(COMPANY_CONTEXT_END_MARKER)) {
    const startIdx = strippedExisting.indexOf(COMPANY_CONTEXT_START_MARKER);
    const endIdx = strippedExisting.indexOf(COMPANY_CONTEXT_END_MARKER) + COMPANY_CONTEXT_END_MARKER.length;
    strippedExisting = (strippedExisting.slice(0, startIdx) + strippedExisting.slice(endIdx))
      .replace(/^(?:\s*---\s*)+/, "")
      .trim();
  }
  // Avoid duplicating if strippedExisting is identical to the bare rolePrompt
  if (!strippedExisting || strippedExisting === rolePrompt) {
    return contextBlock;
  }

  return `${contextBlock}\n\n---\n\n${strippedExisting}`;
}
