# Feature enhancements

Planned feature work for Fid Coder after the current cockpit, workspace tools, checkpoints, routines, and integrations.

Last updated: 30 October 2026.

## Product constraints

- GitHub Copilot is the only model backend.
- No Docker and no remote browser.
- Tools stay rooted in the agent workspace.
- The browser is local and headed, with one profile per agent.
- Agents, transcripts, checkpoints, and settings stay on the PC.
- Keep changes small and match the existing architecture in `AGENTS.md`.

## Current baseline

Already shipped:

- The cockpit: sidebar, conversation, and Agent Desk.
- Agent CRUD with model, tool profile, workspace, and long-term memory.
- Per-agent headed browser and Jira tools.
- GitHub pull request tools and the GitHub token.
- Native workspace tools: list, glob, search, read, write, patch, git, and shell.
- `explore_code`, the workspace brief, and project rules.
- Turn checkpoints, file diffs, and revert.
- Routines with cron schedules, manual runs, and Windows toasts.
- Copilot usage, the help center, and the portable Windows build.

Gaps this plan addresses:

- One agent has exactly one transcript and one running turn.
- A risky shell command is gated by a prompt convention, not a host-enforced decision.
- Routines expose only `last_status` and stop when the app quits.
- The composer only accepts text.
- The tool surface is fixed in code.

## Planned features

| # | Feature | Status | Size | Depends on |
|---|---|---|---|---|
| 1 | Chats (threads) per agent | Planned | L, 4–6 dev days | — |
| 2 | Approval center | Shipped | M, 3–5 dev days | — (turn-scoped until #1) |
| 3 | Routines 2.0: tray, history, inbox | Planned | M, 4–5 dev days | #1 |
| 4 | Composer attachments | Planned | M, 2–4 dev days | #1 |
| 5 | MCP tool servers | Planned | L, 4–6 dev days | #2 |

Sizes are focused development estimates, not commitments.


---

### 1. Chats (threads) per agent

**Status:** Planned
**Size:** L, 4–6 focused dev days
**Depends on:** nothing

#### Problem

An agent is both identity and conversation. `messages` and `turns` are keyed by `agent_id`, and `Runner` keeps one session and one running turn per agent. A routine writes into the same transcript as interactive work. Starting a new task means carrying a large old context or creating another agent.

#### What ships

- **New chat** in the conversation header and with `Ctrl+N`.
- A thread history popover with title search, rename, delete, and archive.
- Auto-title from the first user message, editable.
- Every thread has its own transcript, turn changes, and live turn.
- Routines write to their own thread instead of the interactive transcript.
- Switching threads during a run preserves both live views.

#### Implementation notes

- Add a `conversations` table: `id`, `agent_id`, `title`, `created_at`, `updated_at`, `archived_at`.
- Add `conversation_id` to `messages` and `turns`.
- Change the Runner session cache key from `agentId` to `agentId:conversationId`, and keep the active turn per conversation.
- Add `conversationId` to every `ChatEvent` so the renderer filters by thread, not agent.
- Keep agent memory long-term and agent-wide. The thread transcript is the working context; a thread carries its own change set.
- Migrate existing data by creating one `Main` thread per agent and assigning all existing messages and turns. No data is deleted.
- Add `conversations.list/create/rename/delete`, change `messages.list` to take a conversation id, and change `chat.send` to take a conversation id.
- Update `ChatView`, `App`, and the sidebar; add a `ChatHistory` component.

#### Done when

Two threads on one agent have separate transcripts and change sets, a running turn in one does not leak into the other, and existing data survives the migration.

#### Risks

- The migration touches every stored message and turn. Cover it with an integration test against a seeded pre-thread database.
- Memory semantics need to stay clear: long-term facts live on the agent, task context lives in the thread.

---

### 2. Approval center

**Status:** Shipped (turn-scoped; thread-scoped audit lands with #1)
**Size:** M, 3–5 focused dev days
**Depends on:** — (turn-scoped until #1)

#### Problem

`shell_run` returns `DELETE_CONFIRM_REQUIRED` unless the model passes `confirmed: true`. The host cannot prove the user approved; the model can set the flag itself. The approval bar is a chat round-trip and only appears after the turn stops. There is no deny path, no saved policy, and no audit.

#### What ships

- A compact inline approval card in the conversation that names the command, working directory, and risk reason.
- **Allow once**, **Always allow**, **Reject**, and **Always deny**.
- Per-agent policy: ask by default, with saved allow and deny rules; deny wins.
- A timeout that denies automatically, and Stop that denies a pending request.
- An audit history of every request and decision.
- The same mechanism will cover MCP tools added in #5.

#### Implementation notes

- Add `ToolContext.requestApproval(request)` returning a decision.
- Add a pending-approval map in `Runner`, keyed by approval id.
- Emit `approval-request` and `approval-resolved` `ChatEvent`s; add a `chat:approval` IPC channel.
- Add `approvals` and `approval_rules` tables. The audit row records command, cwd, reason, decision, agent, conversation, turn, and time.
- Update `shell_run` to await the decision for deletes, git pushes, and downloads. Remove `DELETE_CONFIRM_MARKER`, the `confirmed` argument, and the chat confirmation bar.
- Add a **Safety** section to Settings for saved rules, plus a history view in the Agent Desk.
- Keep the SDK permission handler for unknown tools; use the new bridge for Fid Coder tools.

#### Done when

A `git push` cannot run without an out-of-band decision, rejecting returns a denial to the model, and every decision is recorded.

#### Risks

- A tool handler waits on the UI. Timeout, Stop, and window close must all resolve the promise as a denial.
- Saved rules must be easy to review and remove; an accidental "always allow" should not be permanent without a visible list.

---

### 3. Routines 2.0: tray, history, inbox

**Status:** Planned
**Size:** M, 4–5 focused dev days
**Depends on:** #1

#### Problem

Routines keep only `last_status`. A run's output is buried in the agent transcript. Closing the window quits the app, so scheduled work stops. Toast notifications do not open anything, and skipped runs are easy to miss.

#### What ships

- A tray icon with Open, Pause all routines, and Quit.
- An option to keep running when the window closes, and start at login.
- Per-routine run history: trigger, start, duration, status, output excerpt, and **Open chat**.
- A global inbox with unread count, filters, and mark-read.
- Toast click opens the run's thread.
- A missed-run policy for schedules that fire while the app is off.

#### Implementation notes

- Add a `routine_runs` table: routine, agent, conversation, trigger, status, started/ended, turn, output, error, read time.
- Make `Runner.runTurn` return the turn id and conversation id so the scheduler can record a run.
- Record running, ok, error, and skipped states in `Scheduler`.
- Add a `Tray`; intercept window close when the keep-running setting is on, and quit explicitly from the tray.
- Use `app.setLoginItemSettings` for start at login, with a hidden-start argument.
- Add a notification click handler that focuses the window and navigates to the run.
- Add a History tab to `RoutinesDialog`, a last-run row in `AgentDesk`, and an `InboxDialog` opened from a sidebar bell.
- Prune old runs on launch (for example, 90 days).

#### Done when

A weekday morning Jira digest runs with the window hidden, raises a toast, and lands in the inbox with a working deep link.

#### Risks

- Tray lifecycle and quit behavior can confuse users; make the setting explicit and show it on first close.
- A crash during a run must not duplicate the run on next launch. Record the run before work starts and reconcile on startup.
- Background browser runs still open a headed browser; document that behavior.

---

### 4. Composer attachments

**Status:** Planned
**Size:** M, 2–4 focused dev days
**Depends on:** #1

#### Problem

The composer is text-only. Coding and browser work often needs a screenshot, a log, a CSV, or a specification. The Copilot SDK already supports file and blob attachments.

#### What ships

- A paperclip button, drag/drop, and paste-image.
- Multiple attachments with thumbnails, names, sizes, and remove.
- Attachments persist with the message and can be opened or revealed.
- Limits: for example, 8 files, 20 MB each, and 50 MB per message.
- A clear note that attachments are user-provided data, not instructions.

#### Implementation notes

- Add an attachments directory under the user data folder, scoped by agent and conversation.
- Add a `files:pick` IPC handler and use `webUtils.getPathForFile` in the sandboxed preload for drag/drop.
- Paste-image has no file path; read the clipboard file as bytes and save it through the main process.
- Add a `messages.attachments` JSON column and a `MessageAttachment` shared type.
- Widen the `SessionLike.sendAndWait` input to accept attachments; pass them from `Runner`.
- On a rebuilt session, reattach only the latest user message. Earlier attachments stay visible in the transcript and are referenced by name.
- Clean up attachment files when a thread or agent is deleted.

#### Done when

Paste a screenshot and drag a log, reload the app, and both still render; a rebuilt session can still read the latest attachments.

#### Risks

- Images and large files consume context. Cap size and compression, and show the limit before sending.
- Copied files duplicate data. Use content hashes and clean up with the owning thread.
- Treat attachments as untrusted input; never execute or import them automatically.

---

### 5. MCP tool servers

**Status:** Planned
**Size:** L, 4–6 focused dev days
**Depends on:** #2

#### Problem

Every integration is native code under `src/tools`. Adding an internal system means changing the app. The Copilot SDK already supports MCP servers, so the app can expose external tools without building each integration.

#### What ships

- **Settings → Tools** for adding a local stdio server with command, args, environment, and working directory.
- Test connection and tool discovery.
- Per-agent enablement with a tool list.
- MCP tools shown in the Context inspector.
- MCP tool calls routed through the approval center.

#### Implementation notes

- Add an `mcp_servers` table and a per-agent assignment.
- Store server environment values and HTTP headers in `secrets.ts`, never in plain settings.
- Pass `mcpServers` from `Runner.sessionFor` into `openSession`.
- Include the MCP configuration in the session signature so edits drop the cached session.
- Bridge MCP permission requests to the approval center; fail closed for unknown tools.
- Start with stdio only. Keep HTTP behind an advanced flag with a clear warning, since the product is local-first.
- Add the server and tool names to `ContextView` so the Context inspector stays honest.

#### Done when

A fixture MCP server's tools appear in an agent's Context view, a call shows up as a normal tool card, and write-like tools require approval.

#### Risks

- Tool explosion can consume context. Enable servers per agent and allow a tool filter.
- MCP servers are arbitrary local processes. Show the exact command before saving, and never auto-approve unknown write tools.
- Remote MCP conflicts with the local-first constraint; keep it off by default.

---

## Sequencing

Core cockpit:

```text
1. Chats ──► 2. Approvals ──► 3. Routines 2.0 ──► 4. Attachments ──► 5. MCP
```

Use-case track (independent):

```text
Config + CLI ──► Matcher + report ──► Fid Coder preset ──► More adapters
```

- **#1 first** because #3 and #4 attach to a thread; doing it later means reworking them.
- **#2 before #5** because third-party tools need a real permission gate.
- **#4 is independent** and can run in parallel with #3.
- **#6 can start now.** Its standalone CLI does not require #1–#5. The Fid Coder integration benefits from #2 (approvals) and multi-repo workspace support.
- Rough total: 4–5 weeks for the core track, plus 2–3 weeks for a reusable #6 v1.

## Deferred / next wave

- **Global full-text search and command palette.** After #1, the conversations table makes SQLite FTS cheap. `Ctrl+K` currently only filters agents.
- **Subagent delegation.** Generalize `explore_code` into named subagents with their own prompts, tool subsets, and budgets. A strong harness bet after approvals and threads.
- **Confluence and Jira writes.** Native follow-ups if MCP does not cover the internal Atlassian setup.
- **Per-hunk diff accept/reject and a change timeline.** The desk currently shows only the latest turn.
- **Usage and activity dashboard.** The app shows one quota bar, not history.
- **Portable auto-update or LAN remote UI.** Relevant to the internal distribution constraint, but not a top-five workflow feature.

## Open decisions

1. **Memory scope after threads.** Recommendation: keep the rolling summary on the agent as long-term facts, and treat each thread transcript as task context.
2. **Routine threads.** Recommendation: one thread per routine, so history stays readable.
3. **Attachment storage.** Recommendation: copy files into app data so history survives source changes; never edit the source file.
4. **MCP transport.** Recommendation: local stdio only in the first release.
5. **Approval policy scope.** Recommendation: per-agent rules with a global default.
6. **Release-impact packaging.** Recommendation: one dependency-free CLI plus a thin Fid Coder tool, so CI and the app share the same engine.
7. **Custom adapters.** Recommendation: built-in adapters only by default; load a team adapter only with `policy.allowCustomAdapters` and a validated relative path.
8. **AI boundary.** Recommendation: the engine selects deterministically; the agent reviews and explains. The CLI never calls Copilot.

## Recorded ideas (30 October 2026)

Five smaller ideas, written down beside the sequenced roadmap. They are notes. Building one does not start the others, and none of them replace items 1–5 above.

| Idea | What it adds | Touches |
|---|---|---|
| A | One missed routine runs when the app opens | The missed-run policy inside Routines 2.0 |
| B | Scroll and a key press in the local browser | New browser tools |
| C | One text file on the next message | A narrow slice of Composer attachments |
| D | A failed or skipped routine on the agent row | The status Routines 2.0 would also surface |
| E | Show a changed file in Explorer | The diff already on the Agent Desk |

### A. Catch one missed routine when the app opens

**Status:** Idea

#### Problem

A routine stores `next_run_at`, and `node-cron` fires only while Fid Coder is open. A 9:00 routine does nothing if the app was closed at 9:00.

#### What it would do

On `Scheduler.reload()`, after the cron jobs are registered, each enabled routine whose `nextRunAt` is already due calls the existing `fire()` once. That path already writes the following next run, skips with "agent busy" when a turn is in progress, and raises a toast when the routine asks for one. Startup does not wait for the Copilot turn.

One catch-up per routine. A week of missed mornings becomes a single run, then the next future slot. Two due routines on the same agent follow the current busy rule: the second is skipped while the first turn is still running.

#### Where it would land

- A due check next to `nextRunIso` in `src/main/routines/cron.ts`.
- The call from `Scheduler.reload()`.
- A unit test: a past `nextRunAt` is due, a future one is not, a paused routine is not. No Electron process and no live Copilot call.

#### Done when

An enabled routine whose next run passed while the app was closed runs once on the next open, and its stored next run moves to the following slot.

### B. Scroll and press a key in the local browser

**Status:** Idea

#### Problem

Browser tools are `browser_navigate`, `browser_snapshot`, `browser_click`, and `browser_type`. Long pages and menus stop there. The desk image is a preview for the person at the PC. Copilot turns are text, so the model keeps reading the accessibility snapshot.

#### What it would do

Two tools on the browser and all profiles:

- `browser_scroll` moves the page, or one selector from the snapshot, up or down. Default about 600 pixels, cap 2000.
- `browser_press` sends one key from a fixed list: Enter, Escape, Tab, the arrows, PageDown, PageUp, Home, and End.

Tool descriptions carry the rule. The system message stays as it is. No new Jira write tool.

#### Where it would land

- Handlers on the existing browser manager.
- Tool definitions in `src/tools/browser/browser.ts`.
- A pure key-list helper with a unit test.

#### Done when

A browser agent can scroll a long page and send Escape or Tab, and the snapshot that follows reflects the new view.

### C. Attach one text file to the next message

**Status:** Idea

#### Problem

The composer is a textarea. A log, a note, or a specification has to be pasted by hand. Item 4 above is the full attachment design, including images, several files, and files stored with the message. This idea is the small version.

#### What it would do

A paperclip attaches one text file. The renderer reads it locally, refuses a binary file when it sees a NUL byte, and clips the text to 8,000 characters so the fresh-session window of 12,000 characters still has room for the recent thread. A chip shows the file name and can be removed before send.

The saved user message stays one text message: a fenced copy of the file, then the typed text. Memory, the transcript, and routines need no new column. A browser agent can attach a file the same way. The model does not gain a tool that reads outside the workspace.

#### Where it would land

- A clip-and-fence helper in `src/shared`, with a unit test.
- The composer in `ChatView`. One file. Images stay out of this idea.

#### Done when

A text file appears in the sent message, a binary file is refused, and reloading the transcript still shows the fenced copy.

### D. Show a failed or skipped routine on the agent

**Status:** Idea

#### Problem

`routines.last_status` is already written (`ok`, `skipped: agent busy`, `error: …`). The Routines dialog shows it. The desk row shows the schedule and the next run. The sidebar shows last chat activity.

#### What it would do

The desk routine line uses the same status label as the dialog. The sidebar meta line shows that status when the newest routine run was skipped or failed. A completed routine stays quiet on the sidebar row. No new table, badge, or inbox. The inbox in Routines 2.0 can replace this later.

#### Where it would land

- Move `routineStatusLabel` and its tone from `RoutinesDialog` into `src/renderer/lib/routine-schedule.ts`.
- `listAgents` adds the status of the routine with the latest `last_run_at`.
- The desk routine row and the sidebar meta line render it.

#### Done when

A skipped or failed routine is visible on the agent row and on the desk without opening the Routines dialog.

### E. Reveal a changed file in Explorer

**Status:** Idea

#### Problem

A change row opens the diff, and the diff can revert that file. There is no way to open the file's folder from the desk.

#### What it would do

**Show in folder** on the diff. The main process loads that change's path, checks it is still inside the agent workspace, and calls `shell.showItemInFolder`. Shell edits stay untracked, as they are today.

#### Where it would land

- One IPC channel in `src/shared/channels.ts`, the preload inline list, `src/main/ipc/index.ts`, and `FidApi`.
- The button in the existing diff actions.

#### Done when

Show in folder highlights the changed file in Explorer, and a path outside the workspace is refused.

## Related documents

- `AGENTS.md` — repository conventions and where new code belongs.
- `docs/memory.md` — how transcripts and the rolling summary work.
- `docs/build-exe.md` — packaging and distribution.
