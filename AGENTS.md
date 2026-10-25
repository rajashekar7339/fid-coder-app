# Project: Windows Local AI Agents (POC)

## Goals
Build a Windows desktop app for managing persistent AI agents that can control the local browser and run scheduled routines.

## Hard Constraints
- No Docker.
- No remote sandboxes.
- Browser control must use local Playwright with persistent context (one profile per agent).
- AI backend is GitHub Copilot only (token-based).
- Prefer simple, readable TypeScript. Avoid unnecessary dependencies.
- Store tokens securely (keytar or Windows Credential Manager).

## Architecture Notes
- Electron main process + React renderer (Vite).
- Local SQLite for agents, conversations, and routines.
- Clean tool interface for browser, shell, and file tools.

## POC Scope (do not expand until these work)
1. Agent CRUD (create, edit, delete, list)
2. Chat with an agent via Copilot
3. Basic Playwright tools (navigate, click, type, snapshot)
4. One scheduled routine that shows a Windows notification
5. Per-agent Playwright persistent browser profile
