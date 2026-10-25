# Required Tech Stack — Windows Local AI Agents POC

This is the recommended technology stack for the Windows desktop AI agent application (POC).

## Core Stack

| Layer | Technology | Notes |
|-------|------------|-------|
| **Desktop Framework** | **Electron** | Fastest for POC; excellent Windows support, system tray, notifications |
| **Frontend** | React 19 + Vite + TypeScript + Tailwind CSS | Modern, fast, matches typical agent UIs |
| **Browser Automation** | **Playwright** (persistent context) | Controls local Chrome/Edge; preserves logins and cookies per agent |
| **AI Backend** | GitHub Copilot (CLI token or SDK) | As required — token obtained via Copilot CLI login |
| **Database** | better-sqlite3 (or sql.js) | Local, zero-config, no external server |
| **Token Storage** | keytar or Windows Credential Manager | Secure local storage for Copilot, Jira, GitHub PAT tokens |
| **Scheduling** | node-cron or custom interval + Electron notifications | Background routines |
| **Notifications** | Electron Notification API or node-notifier | Native Windows toast notifications |
| **Shell / Git Tools** | Node `child_process` | For Git PR Review agent (checkout, review) |
| **Build / Packaging** | electron-builder | Generate Windows installer later |

## Optional / Later Improvements

| Item | Technology | When to Add |
|------|------------|-------------|
| Lighter desktop framework | Tauri | After POC if Electron feels heavy |
| Client state | Zustand | When UI grows more complex |
| Validation | Zod | For agent configs and tool inputs |
| UI components | shadcn/ui or plain Tailwind | For faster polished UI |
| Agent loop helpers | Custom or lightweight patterns from browser-use | For more reliable tool calling |

## Key Principles

- **No Docker** — everything runs on the user's Windows machine.
- **Local browser control** — Playwright persistent contexts, one per agent.
- **Simple local storage** — SQLite + secure credential store.
- **TypeScript throughout** — main process, renderer, and tools.
- **POC-first** — implement agent CRUD, chat, basic Playwright tool, and one scheduled notification before adding more features.

## Suggested Initial Dependencies

```json
{
  "dependencies": {
    "better-sqlite3": "^11.x",
    "keytar": "^7.x",
    "node-cron": "^3.x",
    "playwright": "^1.x"
  },
  "devDependencies": {
    "electron": "^33.x",
    "electron-builder": "^25.x",
    "vite": "^6.x",
    "typescript": "^5.x",
    "react": "^19.x",
    "react-dom": "^19.x",
    "@types/react": "^19.x",
    "tailwindcss": "^4.x"
  }
}
```

> Exact versions can be adjusted by Grok Build during scaffolding. Prefer current stable versions.
