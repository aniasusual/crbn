# 80degrees (`crbn`)

AI-powered autonomous software engineering environment and desktop IDE. 80degrees pairs a sleek, high-performance desktop interface with an autonomous coding agent harness to plan, build, run, and preview fullstack applications in real time.

---

## Architecture Overview

The repository is organized into three core subsystems:

```
crbn/
├── frontend/       # Electron desktop shell & React 19 web application
├── backend/        # Bun-powered WebSocket & REST bridge server
└── pi-harness/     # Submodule: Autonomous coding agent engine (oh-my-pi, branch 80degrees)
```

```mermaid
graph TD
    subgraph Desktop Shell ["Frontend (Electron + React 19)"]
        UI[React UI: Chat, File Tree, Git Graph, Settings]
        Preview[Live In-App App Preview WebView / IFrame]
        ElectronMain[Electron Main Process (main.js)]
    end

    subgraph BackendBridge ["Backend (Bun Bridge Server :8000)"]
        REST[REST API: Projects, Auth, Models, GitHub]
        WS[WebSocket Bridge: Real-time Agent Stream]
        DevServer[Dev Server Manager: Vite/Express Process Supervisor]
        Checkpoints[Checkpoint & Branch Manager]
    end

    subgraph AgentCore ["pi-harness Submodule (oh-my-pi)"]
        CodingAgent[@oh-my-pi/pi-coding-agent: Agent Session Loop]
        Catalog[@oh-my-pi/pi-catalog: Model Specs & Hardware Detector]
        Natives[@oh-my-pi/pi-natives: High-speed AST, Diff, FS & Bash Addons]
        AIProviders[@oh-my-pi/pi-ai: Multi-provider LLM & OAuth Engine]
    end

    UI <-->|HTTP / WebSocket| BackendBridge
    ElectronMain -.->|Spawns or Attaches| BackendBridge
    BackendBridge <-->|TypeScript APIs| AgentCore
    DevServer -.->|Spawns & Monitors| Preview
```

- **`frontend/`**: Built with React 19, Vite, Tailwind CSS, GSAP, and Framer Motion, running inside an Electron wrapper. Features live chat, plan proposal cards, interactive terminal/file tree, git checkpoint rewind & branch tree graph, model selector, OmniRoute gateway, and provider authentication modals.
- **`backend/`**: A high-performance bridge built on [Bun](https://bun.sh). Manages active agent sessions, file operations, git checkpoints, live preview development servers, model catalog hydration, and 23+ OAuth/API key providers.
- **`pi-harness/`**: The core autonomous coding agent monorepo (submodule pointing to `https://github.com/aniasusual/oh-my-pi.git` on branch `80degrees`). Implements tool execution, plan mode, LSP code intelligence, and LLM communication.

---

## Prerequisites

Before setting up the project, make sure the following runtimes and tools are installed:

| Tool | Minimum Version | Used In | Purpose | Installation |
| :--- | :--- | :--- | :--- | :--- |
| **Bun** | `v1.4.2+` | `backend/`, `pi-harness/`, templates | Backend runtime, submodule monorepo, fast script runner | `curl -fsSL https://bun.sh/install \| bash` |
| **Node.js** | `v20.x+` (or `v22+`) | `frontend/` | Frontend packaging, Electron runtime, Vite dev server | [nodejs.org](https://nodejs.org/) or `nvm install 20` |
| **npm** | `v10.x+` (or `v11+`) | `frontend/` | Frontend package manager | Included with Node.js |
| **Git** | `v2.30+` | All | Submodule tracking, workspace checkpoints, commit rewind | Pre-installed or via package manager |

### Platform-Specific Tools (Optional / Packaging)

- **macOS**: Xcode Command Line Tools (`xcode-select --install`)
- **Linux**: `libarchive-tools` and `libfuse2` for AppImage builds:
  ```bash
  sudo apt-get update && sudo apt-get install -y libarchive-tools libfuse2 curl build-essential
  ```
- **Windows**: PowerShell 5.1+ or PowerShell 7, Git for Windows with symlink support enabled (`git config --global core.symlinks true`).
- **Optional**:
  - [GitHub CLI](https://cli.github.com/) (`gh`) for seamless CLI-based GitHub authentication.
  - [Ollama](https://ollama.com/) if using local offline models.

---

## Clean Setup Instructions

Follow these exact steps to clone, configure, and install all dependencies cleanly.

### Step 1: Clone the Repository with Submodules

The project requires the `pi-harness` submodule. Clone recursively:

```bash
git clone --recurse-submodules https://github.com/aniasusual/crbn.git
cd crbn
```

> **Note**: If you already cloned the repository without `--recurse-submodules`, initialize the submodule now:
> ```bash
> git submodule update --init --recursive
> ```

---

### Step 2: Install Submodule Dependencies (`pi-harness`)

The `pi-harness` submodule is a Bun workspace monorepo. Installing its dependencies automatically triggers the `prepare` lifecycle script, which builds generated tool views required by the agent:

```bash
bun install --cwd pi-harness
```

*What this does:*
- Resolves workspace packages (`@oh-my-pi/pi-coding-agent`, `@oh-my-pi/pi-ai`, `@oh-my-pi/pi-catalog`, etc.).
- Executes `bun run gen:tool-views`, creating `packages/coding-agent/src/export/html/tool-views.generated.js`.

---

### Step 3: Install Backend & Workspace Template Dependencies

Install the backend dependencies, and pre-install dependencies for the default workspace starter template (`node_react`):

```bash
# 1. Install backend dependencies
bun install --cwd backend

# 2. Pre-install template packages for project generation cache
bun install --cwd backend/templates/node_react
```

*What this does:*
- Installs `yaml` and backend TypeScript definitions.
- Prepares the `backend/templates/node_react` template dependencies so new projects created inside 80degrees boot instantly.

---

### Step 4: Install Frontend Dependencies & Configure Environment

```bash
cd frontend

# 1. Install frontend and Electron dependencies
npm install

# 2. Create local environment configuration
cp .env.example .env
```

---

## Configuration & Environment Variables

### Frontend (`frontend/.env`)

The default configuration created from `frontend/.env.example`:

```env
# Backend API Endpoints
VITE_BACKEND_HTTP_URL=http://127.0.0.1:8000
VITE_BACKEND_WS_URL=ws://127.0.0.1:8000/ws

# Frontend Dev Server Settings
VITE_PORT=5173
VITE_HOST=localhost

# Electron Dev URL
ELECTRON_DEV_URL=http://localhost:5173
```

### Backend Configuration (Optional Environment Overrides)

The backend runs without required configuration by default. You can customize runtime behaviors with the following environment variables:

| Variable | Default | Description |
| :--- | :--- | :--- |
| `BACKEND_PORT` or `PORT` | `8000` | Port for REST and WebSocket server. |
| `BACKEND_HOST` or `HOST` | `127.0.0.1` | Loopback bind address for backend. |
| `PROJECTS_ROOT` | `~/.80degrees/projects` | Directory where created user workspaces live. |
| `TEMPLATES_DIR` | `<backend>/templates` | Source directory for project templates. |
| `TEMPLATE_CACHE_DIR` | `~/.80degrees/template_cache` | Cached template `node_modules` for instant project boots. |

### Model Provider Credentials

You can supply API keys either via your shell environment or configure them interactively through the in-app **Settings & Providers** modal:

```bash
export OPENAI_API_KEY="sk-..."
export ANTHROPIC_API_KEY="sk-ant-..."
export GEMINI_API_KEY="AIza..."          # Or GOOGLE_API_KEY
export GROQ_API_KEY="gsk_..."
export DEEPSEEK_API_KEY="sk-..."
export MISTRAL_API_KEY="..."
export OPENROUTER_API_KEY="sk-or-..."
```

*In addition to API keys, 80degrees supports 23 native OAuth providers (Claude/Anthropic, Google Gemini CLI, GitHub, etc.) and custom OpenAI-compatible gateways such as OmniRoute.*

---

## Running in Development

You can run the application in two ways depending on your workflow:

### Mode 1: Full Desktop App with Electron (Recommended)

This mode runs the React UI with hot module reloading (HMR) and automatically spawns the Bun backend bridge server:

```bash
cd frontend
npm run dev
```

*What happens:*
1. Vite boots the frontend dev server at `http://localhost:5173`.
2. `wait-on` verifies the port and launches Electron via `electron/main.js`.
3. Electron automatically detects if a backend is already running on port `8000`. If not, it spawns `backend/src/index.ts` using the local `bun` binary.

#### Dual-Terminal Workflow (Recommended for Backend Development)

If you are modifying backend logic or wish to see separate, live backend logs with file watching:

```bash
# Terminal 1: Run backend with live file watch
cd backend
bun run dev
```

```bash
# Terminal 2: Run Electron frontend
cd frontend
npm run dev
```

Electron will detect the active backend on port `8000` and attach directly to it without spawning a duplicate process.

---

### Mode 2: Web Browser UI Only

If you prefer testing inside a standard web browser (Chrome, Safari, Firefox):

```bash
# Terminal 1: Start backend
cd backend
bun run dev
```

```bash
# Terminal 2: Start Vite web server
cd frontend
npm run dev:react
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Building and Packaging for Production

The application uses `electron-builder` and Bun bundling to produce self-contained standalone installers.

### 1. Build the Complete Stack

Run the unified build command from the `frontend/` directory:

```bash
cd frontend
npm run build:all
```

*This command sequentially runs:*
1. `npm run stage:bun`: Stages standalone Bun binaries into `frontend/resources/bin` and ensures platform-specific native addons (`pi_natives.*.node`) exist in `backend/native/`.
2. `npm run build:backend`: Bundles `backend/src/index.ts` into a single standalone bundle at `backend/dist/index.js`.
3. `npm run build`: Builds the Vite production bundle into `frontend/dist/`.

### 2. Package Desktop Installers

From the `frontend/` directory:

```bash
# Package for macOS (Universal DMG and ZIP)
npm run dist:mac

# Package specifically for Apple Silicon (macOS arm64)
npm run dist:mac:arm64

# Package specifically for Intel Mac (macOS x64)
npm run dist:mac:x64

# Package for Windows (NSIS installer .exe and ZIP)
npm run dist:win

# Package for Linux (AppImage and Debian package)
npm run dist:linux

# Fast unpacked directory build (testing packaging without creating installers)
npm run pack
```

Packaged installers are placed in `frontend/release/`.

---

## Directory & Submodule Structure

```
crbn/
├── .gitmodules                       # Git submodule declaration for pi-harness
├── tsconfig.json                     # Root TypeScript configuration
│
├── frontend/                         # Electron & React 19 Frontend
│   ├── electron/
│   │   ├── main.js                   # Electron main process (spawns backend, window lifecycle)
│   │   └── preload.cjs               # Preload bridge exposing desktop configuration
│   ├── src/
│   │   ├── components/               # ChatPanel, WorkspaceView, ModelSelector, PreviewPanel, etc.
│   │   ├── config.js                 # Runtime API and WebSocket URL resolution
│   │   ├── App.jsx                   # Main application entry and tab orchestrator
│   │   └── index.css                 # Tailwind and custom UI styles
│   ├── scripts/
│   │   └── stage-bun.js              # Stages platform Bun binaries and native addons for release
│   ├── package.json                  # Frontend scripts, dependencies, electron-builder config
│   └── vite.config.js                # Vite build and dev server config
│
├── backend/                          # Bun Backend Bridge Server
│   ├── src/
│   │   ├── index.ts                  # Bun HTTP + WebSocket server entry point
│   │   ├── session-bridge.ts         # Agent session stream bridge (translates events to UI)
│   │   ├── dev-server.ts             # Process supervisor for user preview apps
│   │   ├── project-manager.ts        # Project creation, file tree, file CRUD, template cache
│   │   ├── checkpoint-manager.ts     # Git commit snapshots, step rewind, branch tree graph
│   │   ├── models-service.ts         # Model catalog, hardware detection, key vault
│   │   ├── oauth-manager.ts          # 23 OAuth provider login flows & credential store
│   │   └── github-service.ts         # GitHub PAT/CLI integration, clone, push, pull
│   ├── native/                       # Pre-compiled native Node addons (pi_natives.*.node)
│   ├── templates/                    # Starter templates for generated projects
│   │   └── node_react/               # Fullstack Node Express + React + Vite template
│   └── package.json                  # Backend scripts & dependencies
│
└── pi-harness/                       # Submodule (oh-my-pi @ branch 80degrees)
    ├── packages/
    │   ├── coding-agent/             # SessionManager, agent loop, tools, MCP, plan-mode
    │   ├── ai/                       # LLM stream adapters, auth registry, OAuth handlers
    │   ├── catalog/                  # Model database and provider capability maps
    │   ├── natives/                  # Fast native Rust addons for AST, search, and diffing
    │   ├── tui/                      # Shared terminal and UI themes
    │   └── wire/                     # Protocol definitions and serializers
    └── package.json                  # Bun workspace monorepo manifest
```

---

## Git Submodule Management

If you need to sync or update the `pi-harness` submodule with upstream changes:

```bash
# Check current submodule commit status
git submodule status

# Pull the latest commit on branch 80degrees for pi-harness
git submodule update --remote --merge

# Re-run installation in the submodule after an update
bun install --cwd pi-harness
```

---

## Troubleshooting

### 1. Submodule folder `pi-harness` is empty
**Symptom**: Error like `Cannot find module ... pi-harness/packages/coding-agent/src/index`.  
**Fix**: You cloned without `--recurse-submodules`. Initialize the submodule:
```bash
git submodule update --init --recursive
bun install --cwd pi-harness
```

### 2. Missing `tool-views.generated.js`
**Symptom**: Bundler or runtime error mentioning `tool-views.generated.js` inside `coding-agent`.  
**Fix**: Run `bun install` inside `pi-harness` to trigger the `gen:tool-views` generator:
```bash
bun install --cwd pi-harness
```

### 3. Native Addon Load Error (`pi_natives.*.node`)
**Symptom**: `Failed to load pi_natives native addon...`.  
**Fix**: Staged native binaries are located in `backend/native/`. If they are missing or if you are preparing a fresh release:
```bash
cd frontend
npm run stage:bun
```
This script checks your operating system and architecture (macOS arm64/x64, Linux x64, Windows x64) and automatically extracts or downloads the matching native module.

### 4. Port 8000 or 5173 is already in use
- **Port 8000 (Backend)**: The Electron desktop app automatically probes and discovers an unoccupied port if `8000` is busy, passing the port to the renderer. For manual runs, specify `BACKEND_PORT`:
  ```bash
  BACKEND_PORT=8001 bun run dev
  ```
- **Port 5173 (Frontend)**: Specify a different port in `frontend/.env` via `VITE_PORT`:
  ```bash
  VITE_PORT=5174 npm run dev
  ```

### 5. `bun` command not found in Electron
**Symptom**: Electron reports `Could not start the backend process (bun)`.  
**Fix**: Ensure Bun is in your system `$PATH` (e.g. `~/.bun/bin`). You can verify by running:
```bash
which bun
bun --version
```
If using a custom installation path, set the `BUN_PATH` environment variable:
```bash
export BUN_PATH="/path/to/your/bun"
```

### 6. Resetting Workspace and Template Cache
All generated user projects and cached template node modules are kept in `~/.80degrees/`. If you ever want to clear cached template states:
```bash
rm -rf ~/.80degrees/template_cache
```
The backend will automatically re-prime the cache upon creating the next project.
