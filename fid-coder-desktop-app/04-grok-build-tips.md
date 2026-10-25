# Tips for Using Grok Build CLI Effectively

These practices help Grok Build produce better, more consistent results for this POC.

## 1. Create an AGENTS.md File Early

Place this file in the project root. Grok Build reads it and follows the conventions.

```markdown
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
```

## 2. Start in Plan Mode

For the initial scaffolding and major features, start Grok Build in plan mode so you can review and approve the approach before code is written.

## 3. Use Clear, Constrained Prompts

In every major request, restate key constraints:

- “Stay within the POC scope.”
- “Do not introduce Docker or remote browsers.”
- “Use Playwright persistent context for browser tools.”
- “Keep the code simple and readable.”

## 4. Recommended First Steps

1. Create an empty project folder.
2. Run `grok` in that folder.
3. Paste the full architecture prompt (see `01-architecture-prompt.md`).
4. Let it scaffold the Electron + React project.
5. Iterate in this order:
   - Agent list + create/edit/delete
   - Copilot token storage + basic chat
   - Playwright tool integration
   - One scheduled routine + notification

## 5. Reference Files Later

After the scaffold exists, you can paste short examples or point Grok at specific patterns from:

- Playwright persistent context usage
- browser-use style tool definitions
- Simple Electron IPC patterns

## 6. Optional: Skills and MCP

Grok Build supports skills, hooks, and MCP servers. For this POC, a custom Playwright tool inside the Electron main process is simpler and more reliable than an external MCP server. You can add MCP later if needed.

## 7. Useful Grok Build Commands / Habits

- Use plan mode for larger changes.
- Ask it to explain decisions when something is unclear.
- Review diffs before accepting.
- Keep the conversation focused on one feature at a time after the initial scaffold.

## 8. What to Provide in the Project

| File / Item | Purpose |
|-------------|---------|
| `AGENTS.md` | Project rules and constraints (shown above) |
| Architecture prompt | First message to Grok Build |
| This set of instruction files | Reference while building |
| (Later) Example tool definitions | Help the agent implement browser/shell tools cleanly |

---

**Summary:** Give Grok Build a strong `AGENTS.md`, start with the architecture prompt in plan mode, and keep reinforcing the “local Playwright, no Docker, Copilot-only, POC scope” constraints.
