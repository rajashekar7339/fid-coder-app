# Windows Local AI Agents — POC Architecture Prompt

Copy and paste the prompt below into **Grok Build CLI** (`grok`) as your first message in an empty project folder.

---

```text
Build a Windows desktop AI agent application (POC) from scratch. It is inspired by Grok Bots but runs entirely on the user's Windows machine with no Docker and no remote sandboxes.

## Core Requirements
- Native Windows desktop app (Electron preferred for POC).
- User can create, edit, delete, and list agents.
- Each agent has:
  - Name
  - Responsibility / system prompt
  - Persistent conversation memory
  - Optional scheduled routines
- Browser automation must control the browser on the **same Windows machine** (use Playwright with persistent context).
- AI backend: GitHub Copilot only. User logs in via Copilot CLI or provides a token. The app stores the token securely and uses it for agent interactions.
- Notifications when scheduled routines complete.
- Local storage for agents, memory, tokens, and settings.

## Example Agents to Support
1. General "TO DO List" agent — user can add tasks with optional times. Agent can manage and remind about them.
2. Default "Jira Agent" — opens browser, handles Jira login/token if needed, and runs queries based on user request (e.g. "show my assigned tickets").
3. Default "Git PR Review" agent — uses a GitHub PAT, checks out code locally if needed, and reviews a PR with given instructions.

## Architecture (must follow)
- Electron main process + React renderer (Vite).
- Local SQLite (better-sqlite3) for agents, conversations, routines, and settings.
- Playwright for browser control with one persistent context/profile per agent.
- Secure token storage using Windows Credential Manager or keytar (or DPAPI equivalent).
- Simple cron-style scheduler in the main process + Windows toast notifications.
- Clean tool interface so the AI can call browser tools, shell/git tools, and file tools.

## Folder Structure (suggested)
src/
  main/          → Electron main, scheduler, Playwright manager, Copilot client, SQLite
  renderer/      → React UI (agent list, chat, create/edit agent, settings)
  shared/        → types, constants
  tools/         → browser tool, shell tool, file tool definitions

## POC Scope (build this first)
1. Electron + React shell that starts and shows an agent list.
2. Create / edit / delete agents (name + system prompt).
3. Chat with an agent using Copilot (token stored securely).
4. Basic Playwright tool: agent can navigate, click, type, and take a snapshot.
5. One scheduled routine example that triggers a Windows notification.
6. Per-agent Playwright persistent browser profile.

## Constraints
- No Docker.
- No remote sandboxes.
- Browser runs on the local Windows machine.
- Prefer simple, readable code over heavy frameworks.
- Use TypeScript throughout.

Start by scaffolding the Electron + React + Vite + TypeScript project, then implement the agent CRUD and basic chat loop. Ask clarifying questions if anything is ambiguous.
```

---

## How to Use

1. Create an empty folder for the project.
2. Open a terminal in that folder and run `grok`.
3. Paste the prompt above as your first message.
4. Prefer starting in **plan mode** so you can review the scaffold before code is written.
