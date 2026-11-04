# 80degrees: Vibe-Building Companies — Master Plan & Execution Task Ledger

This document defines the complete architectural blueprint and itemized task breakdown for transforming **`crbn`** (the local desktop engineering IDE) and **`agenta`** (the headless multi-agent engine in Docker/Cloud) into an autonomous company-building platform for solo founders.

---

## Architecture Overview

```
┌────────────────────────────────────────────────────────────────────────┐
│                        SCREEN 1: COMPANIES HUB                         │
│             (Catalog, Operating Status, One-Click Provisioning)        │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Open Company
┌───────────────────────────────────▼────────────────────────────────────┐
│                  SCREEN 2: 3-COLUMN COMPANY WORKSPACE                  │
├─────────────────────┬───────────────────────────┬──────────────────────┤
│ COLUMN 1: TEAM RAIL │ COLUMN 2: CENTER CHAT     │ COLUMN 3: ADAPTIVE   │
│ • Company Switcher  │ • Active Agent Stream     │ • CoS: Kanban & Inbox│
│ • Team Roster       │ • Sub-second Specialist   │ • Eng: Dev Preview   │
│ • Hire / Settings   │   Switching               │ • GTM: Launch Kits   │
│                     │                           │ • Ops: Ticket Queue  │
└─────────────────────┴─────────────┬─────────────┴──────────────────────┘
                                    │ REST / WebSocket
┌───────────────────────────────────▼────────────────────────────────────┐
│                    HEADLESS ENGINE (Agenta in Docker)                  │
├────────────────────────────────────────────────────────────────────────┤
│ • PostgreSQL Blackboard (Task Ledger, Artifact Store, Action Inbox)    │
│ • Asynchronous Event Bus & Dependency Graph Resolver                   │
│ • Agent Roster: Chief of Staff, GTM, Customer Ops, Custom Agents       │
│ • External Ingress Gateways: Slack Socket Mode, WhatsApp, Automations  │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ Git Milestones Sync
┌───────────────────────────────────▼────────────────────────────────────┐
│                LOCAL ENGINEERING ENGINE (crbn Desktop / Bun)           │
├────────────────────────────────────────────────────────────────────────┤
│ • pi-harness Coding Agent (edit, bash, read, write)                    │
│ • Local Dev Server Supervision (Vite on localhost:5173)                │
│ • CheckpointManager (Git snapshots per turn -> Milestone emitter)      │
└────────────────────────────────────────────────────────────────────────┘
```

---

## Dual-Plane Storage Architecture & Invariants

A strict separation of concerns governs where data lives:

1. **Local Disk + Git Plane (`crbn` Desktop)**:
   - **What lives here:** Full project source code (`src/`, `package.json`, assets), `.git/` history, local dev server process (`localhost:5173`), and local cache files (`.80degrees_*.json`).
   - **Invariant:** Raw source code and `node_modules` are **NEVER** stored as rows or binary blobs in PostgreSQL. Local files provide zero-latency POSIX file access for Vite HMR and `pi-harness` tools without sandbox limits.

2. **PostgreSQL Plane (`agenta` Headless Backend)**:
   - **What lives here:** Companies (`projects`), Agent Roster (`agents`), Task Ledger (`blackboard_tasks`), Typed Artifacts (`blackboard_artifacts`), Founder Approvals (`action_inbox`), and Chat Streams (`sessions`/`turns`).
   - **Invariant:** Non-coding agents (Chief of Staff, Support, GTM) operate on relational records and JSON artifacts.

3. **The Synchronization Seam**:
   - When the Engineering Agent finishes a code change, `CheckpointManager` generates a local git commit and dispatches a milestone payload to Agenta's PostgreSQL (`commit_hash`, `step_id`, `files_modified`).
   - Downstream agents read the resulting artifacts from PostgreSQL without touching local filesystem paths.

---

## Complete Task Ledger

The implementation is broken down into **10 core tasks**, ordered logically from data foundation to complete closed-loop autonomy:

| Task # | Task Title | Primary Repository | Description |
| :--- | :--- | :--- | :--- |
| **TASK-01** | **Blackboard Database Schema & DAO** | `agenta` (Backend) | [COMPLETED] PostgreSQL models and Alembic migrations for `tasks`, `artifacts`, and `action_inbox`. |
| **TASK-02** | **Blackboard REST & WebSocket APIs** | `agenta` (Backend) | CRUD and event-streaming endpoints for the Kanban ledger, artifacts, and founder approvals. |
| **TASK-03** | **Agenta Client Bridge & Local Proxy** | `crbn` (Backend) | Bun service connecting desktop `crbn` to headless Agenta with authentication and offline fallbacks. |
| **TASK-04** | **Screen 1: The Companies Hub** | `crbn` (Frontend) | Multi-company manager UI replacing `WelcomeView.jsx`, with company status cards and creation flow. |
| **TASK-05** | **Screen 2: 3-Column Workspace Shell & Team Rail** | `crbn` (Frontend) | Refactoring `WorkspaceView.jsx` into Column 1 (Team Rail), Column 2 (Chat), Column 3 (Adaptive Surface). |
| **TASK-06** | **Chief of Staff Specialist & Kanban Engine** | `agenta` & `crbn` | Agent prompt/tools for task decomposition + Column 3 interactive Kanban board and Action Inbox. |
| **TASK-07** | **Adaptive Specialist Workspaces** | `crbn` (Frontend) | Context-adaptive Column 3 surfaces for Engineering (Preview), GTM (Launch Kits), and Support (Tickets). |
| **TASK-08** | **Ground-Truth Git Milestone Sync** | `crbn` & `agenta` | Hooking `CheckpointManager` commits to auto-reconcile open Kanban tickets to Done. |
| **TASK-09** | **Dynamic Agent Hiring & Marketplace** | `agenta` & `crbn` | Embedded template browser and chat-to-build agent generator with runtime roster discovery. |
| **TASK-10** | **Autonomous Closed-Loop Flywheels** | `agenta` & `crbn` | Bug-to-fix flywheel (Support $\to$ Engineering) and deploy-to-GTM flywheel (Eng $\to$ Marketing). |

---

## Detailed Task Breakdown & Sub-Phases

### TASK-01: Blackboard Database Schema & DAO (Agenta Backend)
*Goal: Provide a persistent shared memory layer where agents record tasks, artifacts, and approval requests.*

- [X] **Phase 1.1: SQLAlchemy DB Models**
  - Path: `agenta/api/oss/src/dbs/postgres/blackboard/dbes.py`
  - Defined `BlackboardTaskDBE`, `BlackboardArtifactDBE`, `ActionApprovalDBE`.
- [X] **Phase 1.2: Alembic Migration**
  - Generated and verified migration script `oss000000063_add_blackboard_tables.py` in `agenta/api/oss/databases/postgres/migrations/core_oss/versions/`.
- [X] **Phase 1.3: Data Access Object (DAO)**
  - Path: `agenta/api/oss/src/dbs/postgres/blackboard/dao.py` & `mappings.py`
  - Implemented `BlackboardDAO` implementing `BlackboardDAOInterface` (atomic queries: `create_task`, `update_task`, `list_tasks`, `create_artifact`, `list_artifacts`, `create_approval`, `resolve_approval`, `list_approvals`).
  - Verified via unit test suite: `oss/tests/pytest/unit/blackboard/test_blackboard_models_and_mappings.py` (3/3 passing).
---

### TASK-02: Blackboard REST & WebSocket APIs (Agenta Backend)
*Goal: Expose endpoints for desktop and background agents to query and stream blackboard updates.*

- [ ] **Phase 2.1: FastAPI Router & DTOs**
  - Path: `agenta/api/oss/src/routers/blackboard_router.py`
  - Routes:
    - `GET /api/v1/companies/{company_id}/blackboard/tasks`
    - `POST /api/v1/companies/{company_id}/blackboard/tasks`
    - `PATCH /api/v1/companies/{company_id}/blackboard/tasks/{task_id}`
    - `GET /api/v1/companies/{company_id}/blackboard/artifacts`
    - `POST /api/v1/companies/{company_id}/blackboard/artifacts`
    - `GET /api/v1/companies/{company_id}/blackboard/approvals`
    - `POST /api/v1/companies/{company_id}/blackboard/approvals/{approval_id}/resolve`
- [ ] **Phase 2.2: Event Bus Pub/Sub**
  - Path: `agenta/api/oss/src/core/blackboard/events.py`
  - Emit Redis pub/sub notifications on task state changes, new artifacts, and approval requests.
- [ ] **Phase 2.3: WebSocket Live Stream**
  - Endpoint: `WS /api/v1/companies/{company_id}/blackboard/ws`
  - Stream state diffs to connected desktop clients in real time.

---

### TASK-03: Agenta Client Bridge & Local Proxy (`crbn` Backend)
*Goal: Enable `crbn`'s Bun backend to communicate with the local/remote Agenta Docker instance.*

- [ ] **Phase 3.1: AgentaClient Service**
  - Path: `crbn/backend/src/agenta-client.ts`
  - Implement HTTP client pointing to `process.env.AGENTA_API_URL || 'http://127.0.0.1:8080'`.
  - Handle health-checks, API keys, and connection retries.
- [ ] **Phase 3.2: Blackboard WebSocket Consumer**
  - Path: `crbn/backend/src/agenta-socket.ts`
  - Maintain a persistent WebSocket connection to Agenta’s blackboard event bus.
  - Forward events to `crbn`'s frontend client over the existing Electron bridge WebSocket.
- [ ] **Phase 3.3: Multi-Company Project Manager Link**
  - Path: `crbn/backend/src/project-manager.ts`
  - Link local directory paths (`~/.80degrees/projects/<company>`) to Agenta `company_id`s.

---

### TASK-04: Screen 1: The Companies Hub (`crbn` Frontend)
*Goal: Deliver the landing screen for managing and creating companies.*

- [ ] **Phase 4.1: Companies Hub Component**
  - Path: `crbn/frontend/src/components/CompaniesHub.jsx` & `.css`
  - Grid layout of Company Status Cards.
  - Displays: Company Name, Brand Avatar, Active Agents Count, Operating Status (e.g., "Active - 2 Support Tickets", "Ready to Launch"), Dev Server Port status.
- [ ] **Phase 4.2: One-Click Company Creator Modal**
  - Inputs: Company Name, Industry / Idea prompt, Starter Tech Stack.
  - Submits to Agenta to initialize company record and auto-provisions the 4 baseline agents.
  - Submits to `crbn` backend to initialize local Git repo and baseline files.
- [ ] **Phase 4.3: App Navigation Switcher**
  - Path: `crbn/frontend/src/App.jsx`
  - Toggle between `currentView === 'hub'` and `currentView === 'workspace'`.

---

### TASK-05: Screen 2: 3-Column Workspace Shell & Team Rail (`crbn` Frontend)
*Goal: Transform the current 2-column layout into the 3-column command center.*

- [ ] **Phase 5.1: 3-Column Grid Layout**
  - Path: `crbn/frontend/src/components/WorkspaceView.jsx` & `.css`
  - Column 1: Width 260px (Left Rail).
  - Column 2: Flexible width (Center Chat Panel).
  - Column 3: Width 480px–600px resizable (Adaptive Specialist Workspace).
- [ ] **Phase 5.2: Column 1: Team Rail Component**
  - Path: `crbn/frontend/src/components/TeamRail.jsx` & `.css`
  - Company Header: Company Name, fast switcher dropdown to return to Hub.
  - Agent Team Roster:
    - 🌐 Chief of Staff (selected by default)
    - 🛠️ Engineering Agent
    - 📢 GTM & Marketing Agent
    - 🎧 Customer Support Agent
    - Dynamic custom agents list
  - Action Menus: `[ + Hire Agent ]`, `[ 🏪 Marketplace ]`, `[ ⚙️ Settings ]`.
- [ ] **Phase 5.3: Sub-Second Agent Switching Engine**
  - Switch active conversational context on clicking an agent in Column 1.
  - Cache message histories per agent per company to prevent re-fetching latency.

---

### TASK-06: Chief of Staff Specialist & Kanban Engine
*Goal: Provide the orchestrator agent and interactive project board.*

- [ ] **Phase 6.1: Chief of Staff Persona & Tools**
  - Path: `agenta/api/oss/src/core/agents/chief_of_staff.py`
  - System Prompt: Strategic project management, daily briefings, and task decomposition.
  - Tools: `create_task`, `update_task`, `list_tasks`, `request_approval`.
- [ ] **Phase 6.2: Column 3 Kanban Board Component**
  - Path: `crbn/frontend/src/components/workspace/KanbanBoard.jsx` & `.css`
  - Columns: Backlog, In Progress, In Review, Done.
  - Cards show: Title, Assignee Agent avatar, Priority badge, Dependencies.
  - Drag-and-drop or status toggling synced to Agenta Blackboard API.
- [ ] **Phase 6.3: Column 3 Founder Action Inbox**
  - Path: `crbn/frontend/src/components/workspace/ActionInbox.jsx` & `.css`
  - Lists pending high-stakes approval cards (deploy code, publish social post, send refund).
  - 1-click `[ Approve ]` or `[ Reject ]` with optional feedback input.

---

### TASK-07: Adaptive Specialist Workspaces (`crbn` Frontend)
*Goal: Make Column 3 dynamically adapt to each agent's functional discipline.*

- [ ] **Phase 7.1: Adaptive Container Switcher**
  - Path: `crbn/frontend/src/components/workspace/AdaptiveWorkspace.jsx`
  - Dynamically renders child surface based on `activeAgent.role`.
- [ ] **Phase 7.2: Engineering Surface**
  - Embed existing `PreviewPanel.jsx` (live `localhost:5173` iframe, refresh/reload, device toggles).
  - Add Code Diff Tree & Plan vs Build mode toggle.
- [ ] **Phase 7.3: GTM & Marketing Surface**
  - Path: `crbn/frontend/src/components/workspace/GtmWorkspace.jsx`
  - Interactive Launch Post Previews (X/Twitter thread cards, Reddit post preview).
  - Product Hunt Launch checklist.
- [ ] **Phase 7.4: Customer Support Surface**
  - Path: `crbn/frontend/src/components/workspace/SupportWorkspace.jsx`
  - Inbound ticket queue cards with customer source badge (Slack/WhatsApp).
  - Trace telemetry, error reproduction logs, and gateway connection status.

---

### TASK-08: Ground-Truth Git Milestone Sync
*Goal: Automatically reconcile Kanban tickets when the founder or Engineering Agent builds features.*

- [ ] **Phase 8.1: Checkpoint Milestone Emitter (`crbn` Backend)**
  - Path: `crbn/backend/src/session-bridge.ts`
  - In `CheckpointManager.createCheckpoint()`, extract commit SHA, message, and list of changed files.
  - Dispatch milestone payload to Agenta API: `POST /api/v1/companies/{id}/milestones`.
- [ ] **Phase 8.2: Milestone Reconciler (`agenta` Backend)**
  - Path: `agenta/api/oss/src/core/blackboard/reconciler.py`
  - Parse commit message and diff against active `in_progress` engineering tasks.
  - Mark matched tasks as `done`.
  - Check dependency graph: if dependent tasks (e.g. GTM post draft) are unblocked, transition them from `blocked` to `in_progress`.
- [ ] **Phase 8.3: Chief of Staff Situational Briefing**
  - When founder switches back to Chief of Staff, it greets them with a summary of the newly committed milestone and unblocked items.

---

### TASK-09: Dynamic Agent Hiring & Marketplace
*Goal: Allow founders to hire pre-configured agents or build custom roles on demand.*

- [ ] **Phase 9.1: Agent Marketplace Modal**
  - Path: `crbn/frontend/src/components/marketplace/MarketplaceModal.jsx`
  - Browse templates: Cold Email SDR, Competitor Price Tracker, SEO Content Writer, Sentry Error Monitor.
  - One-click `[ Add to Company ]` provisions agent into Agenta database.
- [ ] **Phase 9.2: Chat-to-Build Custom Agent Studio**
  - Conversational interface where founder describes a role.
  - System generates: agent name, avatar icon, system prompt, tool bindings, and schedule.
- [ ] **Phase 9.3: Runtime Roster Re-hydration**
  - Chief of Staff dynamically queries `GET /api/v1/companies/{id}/agents` before each planning cycle.
  - New agents are recognized and delegated tasks without modifying hardcoded prompts.

---

### TASK-10: Autonomous Closed-Loop Workflows
*Goal: Wire end-to-end automated flywheels between specialists.*

- [ ] **Phase 10.1: Flywheel A — Customer Bug to Code Fix**
  - Customer reports bug on Slack/WhatsApp $\to$ Support Agent captures logs and creates `bug_reproduction` artifact.
  - Desktop displays notification pill in header: *"1 Support Escalation"*.
  - Founder clicks `[ Fix with Engineering Agent ]` $\to$ Workspace switches to Engineering Agent in Build Mode with reproduction context loaded.
  - Fix verified on `localhost:5173` $\to$ Founder clicks `[ Deploy Fix ]`.
  - Milestone marks task `done` $\to$ Support Agent automatically posts resolution back to customer.
- [ ] **Phase 10.2: Flywheel B — Feature Deployed to GTM Launch**
  - Feature deploy event emits `live_url` artifact.
  - Growth Agent automatically unblocks, scans live URL, and generates launch kit (PH, X, Reddit).
  - Drafts appear in Founder Action Inbox.
  - Founder reviews, makes inline edits, and clicks `[ Approve & Publish ]`.

---

## Execution Methodology

For each task in the ledger:
1. **Scope & Phase Definition**: We select the single active task and review its detailed phases.
2. **Implementation**: We write/edit the exact code files in `agenta` and `crbn`.
3. **Verification**: We smoke test the specific flow, endpoints, and UI surface.
4. **Sign-off**: We mark the phase completed in this document and proceed to the next task.
