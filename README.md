# 80degrees (`crbn`)

AI-powered autonomous software engineering environment and desktop IDE.

---

## Subsystems

- **`frontend/`**: Electron desktop shell + React 19 UI (Vite, Tailwind CSS, Framer Motion).
- **`backend/`**: Bun bridge server handling WebSocket agent streams, dev server supervision, and git checkpoints.
- **`pi-harness/`**: Coding agent engine submodule ([`oh-my-pi`](https://github.com/aniasusual/oh-my-pi.git), branch `80degrees`).

---

## Prerequisites

- **[Bun](https://bun.sh)** `v1.4.2+`
- **[Node.js](https://nodejs.org)** `v20+` & **npm** `v10+`
- **Git** `v2.30+`

---

## Quick Start

```bash
# 1. Clone repository with submodules
git clone --recurse-submodules https://github.com/aniasusual/crbn.git
cd crbn

# 2. Install submodule dependencies (generates tool views)
bun install --cwd pi-harness

# 3. Install backend & starter template dependencies
bun install --cwd backend
bun install --cwd backend/templates/node_react

# 4. Install frontend dependencies (automatically stages prebuilt native addons)
cd frontend
npm install
cp .env.example .env

# 5. Start the desktop application
npm run dev
```

> **Existing clone without submodules?** Run:  
> `git submodule update --init --recursive`

---

## Development

| Workflow | Command | Notes |
| :--- | :--- | :--- |
| **Desktop App (Recommended)** | `cd frontend && npm run dev` | Boots Vite HMR and launches Electron (auto-spawns or attaches to backend on `:8000`). |
| **Backend Only** | `cd backend && bun run dev` | Runs Bun bridge with live reload on `http://127.0.0.1:8000`. |
| **Web Browser Only** | `cd frontend && npm run dev:react` | Starts web UI at `http://localhost:5173` (requires backend running). |

---

## Production Packaging

Packaging builds standalone installers via `electron-builder`:

```bash
cd frontend

# Build backend bundle, Vite assets, and stage standalone binaries
npm run build:all

# Package installer for current OS
npm run dist:mac       # macOS DMG & Zip (universal: arm64 + x64)
npm run dist:win       # Windows NSIS .exe & Zip
npm run dist:linux     # Linux AppImage & .deb

# Fast unpacked directory test
npm run pack
```

Release artifacts are written to `frontend/release/`.

---

## Troubleshooting

### `Failed to load pi_natives native addon for <platform>`
Because `.node` files are gitignored binaries, download the prebuilt binary matching your system:
```bash
node frontend/scripts/ensure-natives.js
# or: cd backend && bun run setup:natives
```
*(Automatically handled during `npm install` in `frontend/` and `bun run dev` in `backend/`).*

### `Cannot find module ... pi-harness/...`
Initialize the git submodule:
```bash
git submodule update --init --recursive
bun install --cwd pi-harness
```

### Port `8000` or `5173` in use
- **Backend**: Set `BACKEND_PORT=8001 bun run dev` (Electron automatically discovers free ports).
- **Frontend**: Update `VITE_PORT=5174` in `frontend/.env`.
