# Windows Local AI Agents — POC Instructions

This folder contains everything you need to start building the POC with **Grok Build CLI**.

## Files

| File | Contents |
|------|----------|
| `01-architecture-prompt.md` | Complete architecture prompt to paste into Grok Build |
| `02-tech-stack.md` | Required technology stack and suggested dependencies |
| `03-open-source-references.md` | Open-source projects to study (do not clone as starting point) |
| `04-grok-build-tips.md` | How to get better results from Grok Build CLI (including AGENTS.md) |
| `README.md` | This index |

## Quick Start

1. Create an empty folder for your project.
2. Open a terminal in that folder and run `grok`.
3. Open `01-architecture-prompt.md` and paste the prompt into Grok Build.
4. Prefer **plan mode** for the initial scaffold.
5. Create an `AGENTS.md` in the project root using the content from `04-grok-build-tips.md`.
6. Build in this order:
   - Scaffold Electron + React + Vite + TypeScript
   - Agent CRUD
   - Copilot chat with secure token storage
   - Basic Playwright tools (persistent context per agent)
   - One scheduled routine + Windows notification

## Key Constraints (repeat these often)

- No Docker
- No remote sandboxes
- Browser control on the local Windows machine via Playwright persistent context
- GitHub Copilot as the only AI backend
- Keep the POC scope tight until the core features work

## Architecture Summary

```
Windows Desktop App (Electron)
├── React UI (agent list, chat, create/edit, settings)
├── Local Agent Engine
│   ├── Copilot client (token)
│   ├── SQLite (agents, memory, routines)
│   └── Tool registry
├── Tools
│   ├── Playwright (per-agent persistent profile)
│   ├── Shell / git tools
│   └── File tools
└── Background Service
    ├── Scheduler
    └── Windows notifications
```

Happy building!
