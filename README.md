# Fid Coder

Fid Coder is a Windows desktop app for local AI agents. Each agent chats through GitHub Copilot, uses tools for files, shell, git, Jira, and a local browser, and can run on a schedule. Agents, transcripts, plans, file checkpoints, and settings stay on this machine.

## Requirements

- Windows 11
- Node.js 22 or newer (the current test run uses Node 24)
- npm
- GitHub Copilot signed in on this machine (Settings → Copilot in the app)

## Run the app

```powershell
npm install
npm run dev
```

`npm run dev` builds the main and preload processes, starts Vite on `127.0.0.1:5173`, and launches Electron. Set `FID_CODER_DEVTOOLS=1` to open DevTools, or `FID_CODER_USER_DATA=<folder>` to run against an isolated profile.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Build main/preload, start Vite, and launch Electron |
| `npm run build` | Build main, preload, and renderer |
| `npm start` | Launch Electron against the Vite dev server on port 5173 |
| `npm run typecheck` | Type-check all three programs |
| `npm test` | Unit and integration tests |
| `npm run test:unit` | Fast tests against source files |
| `npm run test:integration` | Tests against compiled `dist` output; builds first |
| `npm run test:features` | Live Electron harness for plans, changes/revert, rules, and the context inspector. Needs Copilot sign-in and runs against a temporary profile. |
| `npm run dist:win` | Build the portable Windows app into `release/` |

## Project layout

```text
src/
  main/       Electron lifecycle, IPC, SQLite, Copilot sessions, scheduler
  preload/    Sandboxed bridge exposed as window.fid
  renderer/   React UI
  shared/     Types, channels, API contract, and pure helpers
  tools/      Copilot tool implementations
```

`AGENTS.md` has the detailed folder map and the rules for adding a tool, IPC handler, screen, or database method.

## Data

The app stores its SQLite database at `%APPDATA%\fid-coder\fid-coder.sqlite`. Browser profiles, checkpoints, and generated files live under the same user data directory. Set `FID_CODER_USER_DATA` to use a different folder.

## Documentation

- `docs/guide/` — end-user guide
- `docs/memory.md` — how an agent's transcript and rolling summary work
- `docs/build-exe.md` — packaging notes
- `docs/archive/` — original POC planning notes, kept for history
- `AGENTS.md` — repository conventions and where new code belongs
