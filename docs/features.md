# Features

One backlog for Fid Coder. Combined on 15 November 2026 from the old feature-enhancements, future-enhancements, and reference-feature-ideas notes, then checked against the code. Those three files are retired. The OpenBot survey was consolidated on 20 November 2026 under [OpenBot survey](#openbot-survey-20-november-2026); use that section instead of rescanning the reference project.

**DONE** means the behavior is in the app. Open items are still to build. Removed means it was taken out on purpose.

The user guide (`docs/guide/`), `docs/memory.md`, `docs/build-exe.md`, `docs/workspace-explorer.md`, and `docs/archive/` stay their own documents. The Datadog analyst plan stays in `docs/datadog-implementation.md`.

## Product constraints

- GitHub Copilot is the default model backend. DeepSeek is an optional BYOK provider chosen per agent; the key stays in the main process.
- No Docker and no remote browser.
- Tools stay rooted in the agent workspace.
- The browser is local and headed, with one profile per agent.
- Agents, transcripts, checkpoints, and settings stay on the PC.
- Routines run only while Fid Coder is open. A run that comes due while the app is closed does not run later. Background execution after the window closes is not permitted.
- Keep changes small and match `AGENTS.md`.

## DONE

### Baseline

- The cockpit: sidebar, conversation, and Agent Desk.
- Agent CRUD with model, tool profile, workspace, instructions, and long-term memory.
- Per-agent model provider: Copilot (default) or DeepSeek. DeepSeek uses an encrypted API key or a test environment key, supports tools, and reports tokens without Copilot credits. DeepSeek Flash accepts images; V4 Pro does not.
- Ask mode and Agent mode. Ask mode uses the read-only tool set. Agent mode uses the selected tool profile.
- Per-agent headed browser and Jira tools.
- GitHub pull request tools and the GitHub token.
- Native workspace tools: list, glob, search, read, write, patch, git, and shell.
- `explore_code`, the workspace brief, project rules, and the project map (built only when the user asks).
- Turn checkpoints, file diffs, and revert.
- The workspace explorer: citations, changed files, and a lazy tree. Spec: `docs/workspace-explorer.md`.
- Skills loaded on demand, the Skills library, and `/skills`.
- `/compact` and the rolling summary. Spec: `docs/memory.md`.
- User-managed facts. The user writes them. They are data in the system message, separate from the summary.
- Enhance on the composer. It rewrites the draft and does not send.
- Routines 2.0: cron and one-time schedules, manual runs, Windows toasts, a tray while the app is open, run history, and an inbox. **Limitation:** nothing runs while the app is closed, and a missed slot is not caught up. Spec is under Routines 2.0 below.
- Copilot usage, the help center, and the portable Windows build.
- The Fid app icon on the window, taskbar, tray, toast, and portable executable.
- A compact window chrome: no native title strip, draggable top headers, and the Windows controls over the right pane.
- Pinning a code selection (`Ctrl+Shift+L`) for the next message. Quoting a span of a chat reply is still open (idea 17).

### Approval center

**DONE.** Turn-scoped.

An inline card names the command, working directory, and risk reason. The choices are **Allow once**, **Always allow**, **Reject**, and **Always deny**. Saved allow and deny rules can apply to all agents or one agent, and deny wins. Settings → Safety lists the built-in denies and lets you create, edit, or delete a rule with exact or prefix matching. A timeout denies, and Stop denies a pending request. Decisions are stored. `shell_run` waits for that decision on deletes, git pushes, and downloads. The model cannot set its own confirmed flag.

Three built-in denies (`format`, `diskpart`, and the system-root `rm -rf /`) cannot be removed and are checked before every saved rule, so an allow rule cannot override them. `format` blocks the command and any arguments; `diskpart` blocks the command and its scripts; `rm -rf /` blocks the three exact root forms. Settings → Safety lists them with that detail above the saved rules. **New rule** adds a saved rule for all agents or one agent, with an allow/deny decision, an exact or word-boundary prefix match, and an optional folder. Saved rules can be edited in place or deleted. Saved rules are checked only when a command asks for approval.

A conversation id on the audit row waits until chats exist. Saved rules live in Settings → Safety, with a history view on the Agent Desk.

### Composer attachments

**DONE.** This replaces the 30 October design (copies under user data, an 8-file / 20 MB cap, and a dependency on chats) and idea C (one fenced text file and no new column).

Images the app supports go to the model as binary attachments, up to 10 MB. When the agent has a workspace and file tools, text and code uploads are copied to `.fid/uploads/<id>/` inside the workspace and the agent reads them as paths. Without a workspace or file tools, a text-like upload (CSV, TSV, text, Markdown, JSON, code) is sent as whole-file text, up to 200,000 characters; binary files such as XLSX, PDF, and ZIP still need a workspace and file tools. Workspace references keep their relative path. Line selections send the exact text, up to 200,000 characters. The runner stores descriptors on the message as JSON and puts an `Attached files:` list at the top of the prompt. The agent reads workspace paths with its own file tools. A Browser & Jira agent can receive a supported image or a text-like upload.

### Queue a follow-up

**DONE.** Idea 1.

The composer stays open while a turn runs. **Enter** queues the draft; it appears above the composer in order. Each row shows **Send now**, **Edit**, and **Cancel**. **Send now** stops the current turn and starts that message. **Edit** changes the queued text in place, and **Cancel** removes it. With text in the composer, **Ctrl+Enter** (Cmd+Enter) does the same as Send now. While the turn runs, the composer shows only **Stop**; it does not repeat the queue and send-now buttons beside it.

The queue belongs to the main process, one FIFO per agent, in memory and capped at 20. It drains after a successful turn. Stop or an error pauses it; **Send next** starts the first item and **Clear** empties it. A forced send aborts the current turn, waits for that turn to finish, and then sends the message through the normal `runTurn` path, so it becomes an ordinary stored user message and turn. It does not steer the active turn. Pending approvals, questions, handoffs, and skill cards close when the turn is stopped. A queued message keeps its attachments.

Tests: unit queue rules, integration queue order/edit/stop/force, `npm run test:queue`, and `npm run test:queue-live`.

### Edit and delete a chat message

**DONE.**

Every user message from a normal chat turn has **Edit** and **Delete** actions beside its time. Routine-generated messages, assistant replies, and tool steps are read-only. Both actions are disabled while the agent is working; Stop first.

**Edit** opens the message in place. **Save & rerun** removes the old reply and every later turn, clears the agent summary, drops the live session, and sends the edited text as a new chat turn. The original attachments are reused. If the new turn fails to start, the old history is left untouched. **Delete** asks for confirmation and removes only that user message, its reply, and their turn; earlier and later turns stay, and later turns may refer to the removed exchange. It removes the turn's file-change and inbox rows. Neither action reverts files on disk or undoes a command's side effects. There is no Undo.

The renderer reloads messages and workspace changes after either action. The next message rebuilds context from the remaining messages because the memory summary was cleared.

Tests: unit action eligibility, integration edit/rewind/delete/refusal cases, `npm run test:message-actions`, and `npm run test:message-actions-live`.

### One question card

**DONE.** Idea 2.

The agent calls `ask_user` with one question and two to four choices. The card adds **Other** and **Skip**. A skip or a two-minute timeout tells the agent there is no answer, and the turn continues. Stop, closing the app, and the end of the turn close the card. The card is not stored. One pending question per agent. It is on every Ask and Agent profile. It is off the `/routine` create turn and off the read-only review subagent. A routine run can ask, and the notification switch covers that request.

Tests: unit parsing, the runner round trip, `npm run test:questions`, and `npm run test:questions-live`.

### Pin, archive, and Ctrl+K

**DONE.** Idea 7.

The agent menu can pin or archive. Pinned agents stay at the top and keep a pin on the row. Archived agents leave the main list and stay under **Archived**, with the conversation, routines, and browser profile kept. Restore brings an agent back, and a pin survives the round trip. **Ctrl+K** focuses the search. Enter opens the first match. Escape clears it. The search matches the name and the short description, including archived agents. An open dialog keeps **Ctrl+K**. There are no custom sections and no drag-reorder.

A global full-text search of transcripts is still open. See the deferred list.

Tests: unit ordering and search, the database round trip, and `npm run test:sidebar`.

### Hand the browser back

**DONE.** Idea 13.

The agent calls `browser_needs_you` with a short reason (required, trimmed, collapsed whitespace, max 200). A **Needs you** card appears. **I have the browser** brings the window forward and stays on. Clicks, typing, navigation, and snapshots are refused while the card is open. **Done** hands it back. The next click, type, or navigation waits for a fresh `browser_snapshot`. A ten-minute timeout continues the turn, tells the agent not to type a password, and still requires that snapshot. Stop closes the card and aborts the wait. The card is not stored. One pending handoff per agent. It is on Ask mode and on the Browser and All tools profiles. It is off Developer Agent mode, a routine run, the `/routine` create turn, and the review subagent.

Tests: unit rules, the runner round trip, `npm run test:handoff`, and `npm run test:handoff-live`.

### Save a skill from chat

**DONE.** Idea 14.

The agent calls `save_skill` only when you ask, with a name, a description, and the steps. The card shows editable name, when-to-use, and steps fields. **Save** writes one `SKILL.md` into the app skills folder. **Don't save**, a two-minute timeout, and Stop write nothing. Secrets and fenced scripts are refused before the card. A built-in skill name is refused. Replacing an installed skill overwrites `SKILL.md` and leaves other files in that folder. Ask mode can save one. The card is the confirmation. `/skill-save` sends the same proposal request, reviews the whole task, and never writes without the card. It is off a routine run, the `/routine` create turn, and the review subagent.

Tests: unit draft rules, the runner round trip, `npm run test:handoff` for the card, `npm run test:save-skill-live`, and `npm run test:skill-command-live`.

### Routines 2.0: tray, history, inbox

**DONE.** Includes idea 6 (history and Stop) and idea 29 (the needs-you bell). Chats are still one transcript. **Open chat** and a toast click open that agent. The user guide is `docs/guide/create-a-routine.md`.

**Limitation.** Routines run only while Fid Coder is open. Closing the window quits the app. There is no keep-running tray mode and no start at login. A scheduled run does not continue after the app closes, and it does not start in the background. A slot that passed while the app was closed is not caught up (idea A will not ship; background runs are not permitted). A one-time routine in that case is marked missed and paused, and its instruction does not run. A repeating routine keeps its next future time. The same rule applies while all routines are paused: a past one-time is marked missed, and a past repeating slot does not fire on the next open.

While the app is open, the tray menu is Open, Pause all routines or Resume, and Quit. The tooltip includes the waiting count. **Settings → This PC** can pause every routine. A manual **Run now** still works while routines are paused.

The dialog puts **Routines** and **History** in a switch at the top of the routine list. History has a **Refresh** action and lists the trigger, start, duration, status, and a short excerpt. **Stop** is shown only for a run that is still going. The editor stays mounted while History is open, so an unsaved draft survives a look at the history. The desk row shows the last status and when it ran. The sidebar agent row stays quiet.

The bell count is live approvals, questions, handoffs, and skill saves plus unread routine and turn rows. Opening a stored row marks it read. Snooze hides that row for four hours and does not apply to a waiting card. The same count is the window badge.

The run row is written as `running` before the turn. A `running` row left after a restart becomes interrupted and is not fired again. Scheduled finishes, misses, and interrupted runs enter the inbox. A manual run stays in history only. Rows older than 90 days are removed on reload.

Tests: unit rules for due times, excerpts, labels, and the inbox list; integration coverage for a closed-app miss, pause, interrupt, Stop, a failed abort, snooze, and pruning; `npm run test:routines` for the desk, the Routines/History switch, History refresh, draft preservation, the idle Save state, the Needs you board, the all-routines list, and the inbox. No live Copilot run.

### Working indicator

**DONE.** O12. Added 20 November 2026.

An agent with an active turn shows a lime **Working** label and a pulsing dot in the sidebar, in place of its last-activity date. The **Agents** header shows `N working`. A working row that is not selected also gets a faint lime tint and a short left accent so it is visible without reading the label.

The main process exposes `chat:running-all`, backed by `Runner.runningAgentIds()`. The renderer polls it every 1.5 seconds and also updates immediately from `user`, `done`, and `error` chat events. There is no new table and no task state; the runner's in-memory running set is the source of truth.

Tests: `runningAgentIds` in `tests/integration/message-queue.test.cjs`; `npm run test:sidebar` stubs the running set and checks the row label, the working class, and the header count. The sidebar suite passed 23/23 on 20 November 2026.

### Tool activity summary and duration

**DONE.** O5. Added 20 November 2026.

The collapsed tool card now says what the run did, not only how many steps it took: **Read 2 files · Searched the code · Ran 1 command**. Counts are grouped by tool family; tools without a useful count, such as a routine or a question, keep their label. A failed call adds **N issues** to the summary and **Failed** on its own step. While a call is still running, the line shows that call's active label instead of a past-tense count.

The assistant reply's foot shows **Worked for 42s**, **Worked for 2m**, or **Worked for 1h 5m**. A live turn shows **Working for 12s** and ticks each second. Completed durations come from the turn's `started_at` and `ended_at`, joined onto each message as `turnStartedAt` and `turnEndedAt`. The duration is elapsed turn time, so a wait on an approval counts. The grouping rules live in `src/shared/summary.ts`; `ToolGroup` and `TurnDuration` in `ChatView.tsx` render them.

Tests: unit `tests/unit/tool-summary.test.ts`; `tests/e2e-live/tool-activity.e2e.mjs` seeds a finished turn with four tool calls and checks the summary, the issue count, the failed step, and the 2m duration. The harness passed 5/5, with no live Copilot turn.

### Live working indicator

**DONE.** Added 20 November 2026.

The old three-dot **Thinking** row is now one line beside the agent name: **Thinking**, animated lime bars, and the elapsed time. There is no separate card. It appears while a turn waits between steps, gives way to the tool card while a tool runs, and disappears when the answer starts streaming. Raw model reasoning is not shown. The row is renderer-only and is not stored.

Tests: `workDurationLabel` in `tests/unit/tool-summary.test.ts` covers the elapsed label. The row itself was checked in the running app during a live turn.

### Spreadsheet reader

**DONE.** Added 20 November 2026.

`table_read` reads `.csv`, `.tsv`, `.xlsx`, and `.xlsm` files inside the agent workspace. It returns the sheet names, data-row count, headers, and a Markdown preview. CSV files are one sheet; an Excel file can name a sheet. `headerRow` defaults to 1 and can be 0. `offset` and `limit` page the data: 50 rows by default, 200 maximum. Output is capped at 24,000 characters and each cell at 200 characters, so a large sheet never floods the model context.

It refuses paths outside the workspace, files larger than 20 MB, non-UTF-8/binary CSV, `.xls`/`.ods`, and any other extension. Excel formulas are not calculated; the reader returns the cached value where the file has one. Macros are never executed. Dates are shown as local `YYYY-MM-DD` or `YYYY-MM-DD HH:MM`.

It is a native tool and needs no MCP server. Dependencies: `read-excel-file` (MIT) and `csv-parse` (MIT). The app does not use the stale npm `xlsx` package, which has unfixable high-severity advisories.

Tests: unit `tests/unit/table.test.ts`; integration `tests/integration/table.test.cjs` covers CSV, a semicolon delimiter, paging, a generated XLSX sheet, traversal refusal, and an unsupported `.xls`. The live `npm run test:native-live` harness reads a temp CSV with a real Copilot turn.

### Confluence read and update

**DONE.** Added 20 November 2026.

Both Confluence tools and updates are native; no MCP server is needed. Settings → Confluence supports Cloud and Data Center/Server. Cloud stores the site, account email, and API token; Data Center stores the site and a personal access token. The token is encrypted with Windows `safeStorage`; the agent never sees it. Web requests use Electron's network stack, so they follow the Windows proxy and certificate store.

Tools:
- `confluence_search` — CQL search, up to 20 pages, with id, title, space, version, and URL.
- `confluence_page` — read by a pasted URL, id, or space + title; Common Cloud and Data Center page URLs are parsed directly, and short `/x/` links follow same-site redirects with the saved token. Returns text, storage XHTML, or both.
- `confluence_update_page` — read the page first and pass its `expectedVersion`. The update asks for approval, refuses a stale version, and refuses a Markdown replace when the current page contains Confluence macros. `mode=append` keeps the existing body; `mode=replace` replaces it. `format=markdown` converts basic Markdown to storage XHTML; `format=storage` passes storage unchanged.

The Confluence tools are read-only in Ask mode and report-only routines. `confluence_update_page` is available only in Agent mode and is never added to a routine turn. Updates use the existing approval card, so the decision is recorded and can be denied. A pasted link outside the configured Confluence site is refused before the token is sent. If a short link redirects to a sign-in page, the agent is told to open it in the browser or use the canonical URL.

Tests: unit `tests/unit/confluence.test.ts` covers the URL, id, and display-link forms. Integration `tests/integration/confluence.test.cjs` covers CQL search, page text/storage, a pasted short link, an approved Markdown append, a stale version, a macro-page replacement refusal, a denied update, and Cloud Basic auth. The live `npm run test:native-live` harness has a real Copilot agent resolve a pasted short link, read the page, request approval, and append to a local fake page; it never contacts a real Confluence site.

### Datadog analyst

**DONE.** Added 20 November 2026; browser-only on 21 November 2026. The implementation record is `docs/datadog-implementation.md`.

The **Datadog Analyst** is seeded once per installation with the read-only `datadog` profile and an optional workspace. It starts with the `datadog-triage` skill and loads `datadog-query` when it needs query syntax. The profile has the two Datadog browser tools, workspace read/search/git reads, Jira and Confluence reads, and browser navigate/snapshot/handoff, but no shell, writes, patch, browser click/type, or Confluence update.

No API key is requested or stored. Settings → Datadog stores one URL: the address you open for Datadog, such as `https://app.datadoghq.com`. A pasted Log Explorer, monitor, or other deep link is trimmed to the site. The Datadog Analyst opens the logged-in Log Explorer in the local headed browser, captures the page's JSON log response, and returns compact rows. If Datadog asks for a sign-in, the browser handoff card appears; sign in once and the profile keeps the session. The session credential stays in the browser and is never read into a tool, logged, or shown.

Tools:
- `datadog_browser_logs` — opens the Log Explorer with a query and time window, captures the page's JSON log response, and returns service, env, version, host, status, trace id, HTTP fields, message, and stack. Browser results are a page sample.
- `datadog_browser_error_summary` — clusters the captured page sample into message patterns with first/last seen, service, version, and a sample frame.

The capture is limited to the configured Datadog origin and records JSON responses only; cookies and request headers are never recorded. The agent is read-only and treats log text as untrusted. A missing log payload returns the captured endpoints and suggests `browser_snapshot` or a wider window.

The triage skill turns telemetry into a root cause: sample the error, extract the stack and trace id, search the workspace, read the failing path and callers, check recent git changes, and report `path:line` evidence with a confidence level.

Tests: unit `tests/unit/datadog.test.ts`; integration `tests/integration/datadog.test.cjs` covers both browser tools against a fake capture, public and internal log shapes, a sign-in page, a missing payload, and a missing URL; `tests/integration/tool-profiles.test.cjs` covers the read-only profile, browser profile, and Ask mode; `tests/integration/agent-database.test.cjs` covers the one-time seed. The live `npm run test:datadog-browser-live` harness has a real Copilot agent open a local fake Datadog page in the headed browser, capture the JSON response, read a temp workspace, and report the root cause. It never contacts Datadog.

### App icon

**DONE.** Added 21 November 2026. This is packaging polish, not an agent feature.

The window, taskbar, tray, toast, and packaged executable use the Fid brand mark instead of the Electron default. `assets/app-icon/` holds the SVG source and the generated 512 px window PNG, 32 px tray PNG, and multi-size ICO. `scripts/generate-app-icon.ps1` regenerates the raster files. `src/main/icon.ts` picks the development or packaged folder; `package.json` embeds the ICO in the portable `.exe` and copies the folder to `resources/app-icon`. The window icon stays a PNG because Electron's Windows window loader applies it reliably; the ICO is for the executable, the Start Menu shortcut, and the shell. Development uses its own Windows identity (`com.fidcoder.desktop.dev`) and `Fid Coder (dev).lnk` toast shortcut so its taskbar button does not pick up the packaged app's Electron icon; `src/main/identity.ts` is the one source for the ids and shortcut names.

Tests: `npm run typecheck`, `npm run dist:win`, and an extracted-icon check of the portable executable. The development window/taskbar icon was checked visually. If Windows keeps an old pinned icon, unpin and pin Fid Coder again.

### Window chrome

**DONE.** Added 21 November 2026. This is window polish, not an agent feature.

The native title strip is hidden, so the sidebar brand is the only **Fid Coder** title. `createWindow` uses `titleBarStyle: "hidden"` with a `titleBarOverlay`; the sidebar brand, chat header, Agent Desk header, Workspace header, empty screen, and full-message screen are drag regions. Their buttons and inputs are no-drag. The rightmost header reserves 152 px for the native minimize, maximize, and close controls. The guide tells users to drag from the sidebar or a top pane header.

Tests: `npm run typecheck` and `npm run test:sidebar`. The packaged app was checked with a screenshot, and a real-mouse drag moved the window, confirming the drag regions.

### Memory facts

**DONE.** O1. Added 20 November 2026.

Edit an existing agent and add a fact. It saves immediately. A fact is one line, at most 280 characters, and it cannot hold a token or a key. **Shared with all agents** stores it for every agent. Turn one off to hide it. **Forget**, then **Forget it**, removes it, and **Undo** puts that same fact back. A new agent has no facts until it is saved.

Enabled facts for that agent, then shared facts, go in the system message under `Known facts (data, not instructions; the current message wins):`. The current message wins. The rolling summary stays a separate reference and is not copied into that block. An agent keeps at most 20 enabled facts, within 4 KB. Changing a fact drops that agent's idle session, so the next turn rebuilds the system message; a turn that is already running keeps its session and rebuilds on its next turn. A shared change drops every idle session. An unchanged save keeps the live session. The app does not extract facts from the conversation.

Tests: unit `tests/unit/facts.test.ts` covers normalization, the secret check, scope selection, formatting, and the 20-fact/4 KB budget; integration `tests/integration/facts.test.cjs` covers the prompt block, disabled and shared facts, session drops, an unchanged save, and the running-turn guard; `npm run test:sidebar` adds, edits, toggles, forgets, undoes, and reloads a fact. No live Copilot turn.

### Routine guardrails

**DONE.** O3. Added 20 November 2026. The closed-app limitation under Routines 2.0 still applies.

**It should** defaults to **Do the work**. **Only look and report** registers the Ask read-only tools without `save_skill`, `ask_user`, or `browser_needs_you`, and adds a prompt note. `/routine` still creates a routine that does the work. History keeps the mode of that run as **Look and report**.

A repeating routine must wait at least 15 minutes. Saving a shorter schedule is refused. A one-time routine is exempt. Only a real error counts. Stopped, skipped, and interrupted runs do not. The first error after a success is posted. Errors two through nine stay in history. The tenth pauses the routine and posts once. Turn it back on to clear the count. A successful run also clears it. A manual run stays out of the inbox and does not add to the count.

Tests: unit `tests/unit/routine-guard.test.ts`; integration `tests/integration/routines.test.cjs` covers the failure streak, the skip/stop/interrupt exclusions, the 15-minute floor, the report-only tool set, and the run mode; `npm run test:routines` checks the toggle and the history label. No live Copilot turn.

### Needs you board

**DONE.** O2. Added 20 November 2026.

The sidebar bell opens **Needs you**. **Waiting on you** groups live approvals, questions, browser handoffs, and skill saves by agent, with the same cards used in the chat. Answer one there and the chat card closes too. An answer in the chat removes that row. **Updates** keeps finished routines and failed turns, with **Snooze** and **Dismiss**. Opening a row still goes to that agent. The count on the bell includes questions, handoffs, and skill saves.

### All routines

**DONE.** O6. Added 20 November 2026.

The **Routines** tab on that same window lists every agent's routines. A row shows the schedule, the next run, the last status, and **Look and report** when that routine only reports. The switch enables or pauses it. **Run now** starts it. **Open** switches to that agent and opens its Routines dialog. Creating and editing stay in that dialog.

Tests: unit `tests/unit/needs-you.test.ts`; integration `tests/integration/routines.test.cjs` covers the cross-agent list; `npm run test:routines` answers a question, an approval, and a handoff from the board, checks that a chat answer removes the row, and toggles, runs, and opens a routine from the full list. No live Copilot turn.

## Still to build

Sizes below are focused development estimates from 30 October 2026, not commitments.

| # | Feature | Status | Size | Depends on |
|---|---|---|---|---|
| 1 | Chats (threads) per agent | Open | L, 4–6 dev days | — |
| 5 | MCP tool servers | Open | L, 4–6 dev days | Approval center (DONE) |

```text
Approval center (DONE) ──► 5. MCP
```

Routines 2.0 shipped on the one transcript. A later chat can give a run its own thread. Approvals are already in place, so MCP can start when a thread id is not required. Attachments shipped on the single transcript and do not wait on chats.

OpenBot-derived candidates are in [OpenBot survey](#openbot-survey-20-november-2026). They are not numbered into this table yet.

### 1. Chats (threads) per agent

**Status:** Open. Also idea 3. Idea 34 (fork a chat) waits on this.

An agent is both identity and conversation. `messages` and `turns` are keyed by `agent_id`, and `Runner` keeps one session and one running turn per agent. A routine writes into the same transcript as interactive work.

What ships:

- **New chat** in the conversation header and with `Ctrl+N`.
- A thread history popover with title search, rename, delete, and archive.
- Auto-title from the first user message, editable.
- Every thread has its own transcript, turn changes, and live turn.
- Routines write to their own thread.
- Switching threads during a run preserves both live views.
- Reopen the last chat for this folder and git branch.
- **Duplicate chat** from the history list, with a new title and a "forked from" label. No merge.

Implementation:

- Add a `conversations` table: `id`, `agent_id`, `title`, `created_at`, `updated_at`, `archived_at`.
- Add `conversation_id` to `messages` and `turns`.
- Change the Runner session cache key from `agentId` to `agentId:conversationId`, and keep the active turn per conversation.
- Add `conversationId` to every `ChatEvent` so the renderer filters by thread.
- Keep agent memory long-term and agent-wide. The thread transcript is the working context. A thread carries its own change set.
- Migrate existing data by creating one `Main` thread per agent and assigning all existing messages and turns.
- Add `conversations.list/create/rename/delete`. Change `messages.list` and `chat.send` to take a conversation id.
- Update `ChatView`, `App`, and the sidebar. Add a `ChatHistory` component.

Done when: two threads on one agent have separate transcripts and change sets, a running turn in one stays in that thread, and existing data survives the migration.

Risks: the migration touches every stored message and turn. Cover it with an integration test against a seeded pre-thread database. Long-term facts stay on the agent. Task context stays in the thread.

### 5. MCP tool servers

**Status:** Open. Also idea 31.

Every integration is native code under `src/tools`. The Copilot SDK already supports MCP servers.

What ships:

- **Settings → Tools** for a local stdio server: command, args, environment, and working directory.
- Test connection and tool discovery.
- Per-agent enablement, off unless that agent asks for it, with a tool list and a cap.
- MCP tools shown in the Context inspector.
- MCP tool calls routed through the approval center. Unknown write tools fail closed.
- Health and retry handling. HTTP and OAuth stay out of the first slice.

Implementation:

- Add an `mcp_servers` table and a per-agent assignment.
- Store server environment values and HTTP headers in `secrets.ts`.
- Pass `mcpServers` from `Runner.sessionFor` into `openSession`.
- Include the MCP configuration in the session signature so edits drop the cached session.
- Bridge MCP permission requests to the approval center.
- Show the exact command before saving.
- Add the server and tool names to the Context inspector.

Done when: a fixture MCP server's tools appear in an agent's Context view, a call shows up as a normal tool card, and write-like tools require approval.

_Datadog analyst is DONE; see the implementation record in `docs/datadog-implementation.md`._

## OpenBot survey (20 November 2026)

This is the consolidated survey of `reference_projects/OpenBot`. It exists so a future session does not have to rescan that project. Start here, then read only the OpenBot file a candidate names.

**Caveat.** OpenBot's server ships as signed images and is not in this checkout. Everything below about server behavior comes from its docs and `shared/` contracts, not from reading server source. A question about backend policy internals still needs OpenBot's server repository or a running deployment. All OpenBot paths below are relative to `reference_projects/OpenBot/`.

**Verdict.** OpenBot is a team-scale agent workspace. Fid Coder is a local coding cockpit. The useful transfer is the interaction model around a long-running agent: what it remembers, what waits on you, how scheduled work behaves, how setup failures are explained, and how tool work is narrated. The enterprise stack, remote computers, recorder, delegation, voice, and automatic learning do not fit the product constraints in this document.

**Size key.** S = under a day; M = 1–3 days; L = 3–6 days; XL = more than a week.

### Candidate table

| ID | Candidate | Fid gap | Size | Wave |
|---|---|---|---|---|
| O1 | User-managed memory facts — **DONE** | Facts on the agent, plus optional shared facts | M | 2 |
| O2 | Needs-you board — **DONE** | Inbox is a flat list; approvals open the chat | M | 3 |
| O3 | Routine guardrails and report-only mode — **DONE** | 15-minute floor, ten-failure pause, report-only tools | S/M | 1 |
| O4 | Setup checklist | No health screen; failures appear only when used | M | 4 |
| O5 | Human tool activity summary and duration — **DONE** | Counted summary and turn duration | S | 1 |
| O6 | All routines view — **DONE** | Routines are per-agent only | S/M | 3 |
| O7 | Routine completion checklist | Partial multi-step routines look complete | M | 5 |
| O8 | Multi-field ask form | `ask_user` is one question | M | 5 |
| O9 | Fixed result cards, checklist first | Markdown and Mermaid only | M | 5 |
| O10 | Secret request card | Planned as idea 30, not built | M | 5 |
| O11 | Routine/follow-up proposal card | `/routine` only | M | 5 |
| O12 | Working indicator — **DONE** | Sidebar **Working** label and `N working` count | S | 1 |
| O13 | Activity/audit trail | Pieces exist, no unified view | L | Later |
| O14 | Global full-text search | Deferred until chats exist | M | Later |
| O15 | Subagents | Idea 32 is the right-sized version | L | Later |
| O16 | Goals/check-ins | Big state machine | L | Later |
| O17 | Skill tool declarations | Skills are instructions only | M | Later |

O1, O2, O3, O5, O6, and O12 are **DONE** (20 November 2026). Wave 4 is O4, the setup checklist. Wave 5 is O7–O11. The rest are later or not taken. O10 is the same work as idea 30 and follows that item's schedule; it is listed here because OpenBot's UX sharpens it.

An `O` number is a stable reference for discussion. It is not a backlog number and does not imply that the item is approved.

### O1. User-managed memory facts

**Status: DONE (20 November 2026).** The implementation is recorded under **DONE → Memory facts** above. The notes below are the design record.

**OpenBot.** `app/src/components/memory/memories.tsx` is a real Memory page: **Remember a fact**, edit, forget, enable/disable, provenance, and “formed by this Bot” versus “you.” `docs/how-openbot-works.md` says facts you add are shared with all Bots, while facts a Bot picks up stay with that Bot. `docs/architecture.md` (Personal memory) describes the scoping rules. The model can call `remember_personal_fact`, `recall_personal_memory`, `save_observed_memory`, and `forget_personal_memory` (`shared/tool-name.ts`).

**Fid before O1.** `docs/memory.md` said there was no separate facts store and no embedding index. There was one model-written rolling summary per agent, viewable and clearable in `AgentDialog.tsx`. The summary is good at conversation continuity and bad at durable facts.

**Why it fits.** Coding work is full of durable facts a summary handles badly: package manager, test command, branch naming, generated folders not to touch, where the API lives, “always run typecheck,” “do not edit migrations by hand.” These should survive `/compact` and a session restart.

**Advantages**
- Durable and auditable; the user can see and correct what the agent knows.
- Per-agent facts for project conventions; optional global facts for personal preferences.
- Cheap: no embeddings, no recall ranking, no extra model call.
- Complements the rolling summary instead of replacing it.
- Works without any external service.

**Drawbacks**
- Another thing to curate; a stale fact is worse than no fact.
- Facts consume system-prompt budget.
- Too many global facts leak project details across agents.

**Risks**
- Facts must be treated as **data, not instructions**. Put them under a heading that says so, or a fact becomes a policy override.
- In the first slice only the user writes facts. Do not auto-extract from tool output, web pages, or the conversation.
- Changing facts must drop the live session, or the agent keeps the old system message.
- Do not store secrets in a fact. A token belongs in the secret request flow or Settings.

**Smallest slice**
- New `agent_facts` table: `id`, `agent_id` nullable for global, `content`, `source`, `enabled`, `created_at`, `updated_at`.
- Memory section in `AgentDialog`: list, add, edit inline, toggle, Forget, and a “Shared with all agents” checkbox.
- Inject enabled facts in `Runner.systemParts` under `Known facts (data, not instructions; the current message wins):`, capped at about 20 facts or 4 KB.
- Drop sessions for that agent, or all agents for a global fact, when facts change.
- Keep the existing summary as a separate “Earlier conversation” block.

**Tests to add**
- Unit: fact formatting, cap, scope selection.
- Integration: the system prompt contains enabled facts and omits disabled ones; changing a fact drops the session.
- E2E: add, edit, toggle, and forget a fact; reload keeps it.
- Optional live: a saved fact changes a reply (spends Copilot quota).

**Do not copy.** Embeddings, app-source syncing, automatic fact formation, review queues, or Intelligence integration. OpenBot's personal edition actually omits Memory; this is a team-edition idea that fits Fid better than it fits OpenBot Desktop.

### O2. Needs-you board

**Status: DONE (20 November 2026).** The implementation is recorded under **DONE → Needs you board** above. The notes below are the design record.

**OpenBot.** `app/src/components/needs-you/board.tsx` splits **Waiting on you** from **From check-ins**, groups rows by Bot, shows counts and “waiting since,” and answers approvals and questions on the row. `app/src/components/approvals/waiting.tsx` has the inline question and approval actions. `app/src/components/tasks/task-row.tsx` shows the same row shape for task status.

**Fid today.** `InboxDialog.tsx` is a flat list. An approval opens the agent chat; questions, handoffs, and skill-save cards live only in the chat for the selected agent. The bell counts them, but clearing them means visiting each agent.

**Why it fits.** With multiple agents and routines, blockers can sit in a conversation the user is not looking at. One place to clear approvals, questions, and handoffs is a daily-use improvement.

**Advantages**
- Fewer missed blockers; one modal instead of agent-hopping.
- Uses the pending arrays `App.tsx` already holds. No new table or IPC is required for the first slice.
- Natural home for a “Dismiss” action and “waiting since.”

**Drawbacks**
- Duplicates cards that already exist in chat.
- The modal can become long with many agents.
- An answer given out of context can be worse than opening the conversation.

**Risks**
- Show the command, folder, and reason before an approval. Never a bare “Allow.”
- Resolve events must remove the row in both the inbox and the chat.
- Do not mix informational routine updates with things that need an answer.
- A stale card must not be able to decide a request that was already settled elsewhere.

**Smallest slice**
- Expand `InboxDialog` into **Needs you** with two sections: **Waiting on you** (approvals, questions, handoffs, skill saves) and **Updates** (routine and turn rows).
- Group by agent. Pass the existing `pendingApprovals`, `pendingQuestions`, `pendingHandoffs`, `pendingSkillSaves` and handlers from `App.tsx`.
- Use compact rows with inline actions. Reuse the existing card components where they fit; do not build a second approval model.
- Add relative “waiting since,” per-agent counts, and an optional **Dismiss** for stored rows. Keep Snooze.
- No new database table.

**Tests to add**
- E2E: seed an approval, a question, and a handoff; answer each from the inbox; the chat updates and the row disappears.
- E2E: resolving an approval in the chat removes it from the inbox.
- Integration: no new storage; the inbox view still builds from the existing rows and pending requests.

**Do not copy.** Tasks, task threads, check-in findings, and stalled-handoff machinery. Those depend on OpenBot's delegation model, which Fid leaves out.

### O3. Routine guardrails and report-only mode

**Status: DONE (20 November 2026).** The implementation is recorded under **DONE → Routine guardrails** above. The closed-app limitation still applies. The notes below are the design record.

**OpenBot.** `docs/routines.md` has the clearest rules in the repository:
- A 15-minute floor, because a model can be talked into “every minute.”
- A 20-enabled-routine cap.
- Ten consecutive failures switch the routine off. It posts one message on the first failure after a success and one final message on auto-disable.
- Missed windows are skipped, not replayed.
- **Does: Act for you** versus **Only tell you**.

**Fid before O3.** `MAX_ROUTINES_PER_AGENT = 20`; a custom cron could fire every minute; the scheduler notified on every failure and never auto-disabled; every routine ran with the agent's normal tool set.

**Why it fits.** This is the difference between a routine that is useful and one that quietly burns quota or fills the inbox with the same broken job every night.

**Advantages**
- Protects model spend and attention.
- Report-only routines make scheduled monitoring safe.
- Mostly scheduler state; the UI is one toggle.
- Matches the existing run-history and inbox model.

**Drawbacks**
- Auto-disable can surprise someone who depends on a routine.
- Report-only limits routines that legitimately need writes.
- A minimum interval can block deliberate test schedules.

**Risks**
- Do not count `stopped` or `skipped: agent busy` as failures. Only `error`.
- Reset the failure count on success and when the user re-enables the routine.
- Report-only must use the Ask tool set minus `save_skill`, `ask_user`, and `browser_needs_you`, not just a prompt sentence, or a tool can still write or wait for a person.
- Make the 15-minute floor a clear validation message, not a silent skip.
- A routine that is auto-disabled should stay visible with a reason and a one-click **Enable** action.

**Smallest slice**
- Add `consecutive_failures` and `read_only` to `routines` (migration).
- Scheduler: increment on `error`, reset on `ok`; notify and add an inbox row on the first failure after a success and on the tenth; disable at ten.
- Routine editor: **It should** toggle — **Do the work** / **Only look and report**.
- Report-only runs with that reduced read-only set and a prompt note.
- Optional second step: reject a custom cron that fires more often than every 15 minutes.

**Tests to add**
- Integration: a failure sequence increments, a success resets, the tenth disables, and a stopped or skipped run does not count.
- Integration: a report-only routine gets the reduced read-only set.
- E2E: the toggle saves and the run history shows the mode.
- Unit: the 15-minute validation if it is added.

**Do not copy.** Goals, check-ins, event triggers, “posts in a channel,” or cross-agent routine ownership. Those are a different product.

### O4. Setup checklist

**OpenBot.** `app/src/components/setup/setup-checklist.tsx` shows one row per prerequisite with **Ready / Needs setup / Not checked**, a detail sentence, and the fix. **Check again** re-runs the checks. It explicitly does not block use, and optional gaps are worded as optional.

**Fid today.** Settings has Copilot, GitHub, and Jira sections. Browser failures are discovered when the agent first tries to browse. There is no single “what is missing?” screen.

**Why it fits.** A local Electron app has several prerequisites that fail in different places. A checklist turns “why doesn't the browser work?” into “the local browser is not installed; run this.”

**Advantages**
- Fewer support questions and actionable errors.
- Surfaces optional integrations without nagging.
- Can be entirely local; no network calls required.
- Useful after an update, a profile move, or a new machine.

**Drawbacks**
- Another screen to maintain.
- A check can be flaky or slow.
- Too much red makes the app feel broken.

**Risks**
- Do not auto-launch a headed browser just to check it. Check the executable path, or offer an explicit **Test browser** button.
- Never display secret values; only “saved” or “missing.”
- Do not block anything. A missing optional integration is neutral, not an error.
- A failed check should say what could not be checked, not claim the feature is broken.

**Smallest slice**
- A **Setup** section in Settings with rows:
  - Copilot sign-in (existing status)
  - Local browser (executable exists, or a **Test browser** action)
  - App data writable
  - GitHub token (optional)
  - Jira site and token (optional)
  - At least one agent has a workspace (optional)
- New `setup:check` IPC returning `{ id, title, detail, status, fix }`.
- **Check again** button. Each fix opens the existing Settings section or starts the browser test.
- No new storage.

**Tests to add**
- Integration: each check with temporary user data; missing and present cases.
- E2E: rows render, **Check again** updates, a fix opens the right section.
- No live Copilot run.

**Do not copy.** Server environment variables, admin/member wording, Kubernetes checks, or remote computer checks.

### O5. Human tool activity summary and duration

**Status: DONE (20 November 2026).** The implementation is recorded under **DONE → Tool activity summary and duration** above. The notes below are the design record.

**OpenBot.** `app/src/components/channels/tool-activity.tsx` turns a run of tool calls into one sentence: “Read 3 files and searched for 2 patterns.” Each step has a human label and a detail. `tool-line.tsx` distinguishes **In progress / Not completed / Blocked / Didn't work / Interrupted / Done by you**. `worked-for.tsx` adds “Worked for 2m.” `coding-tool-cards.tsx` adds command, diff, and todo cards for coding harness tools.

**Fid before O5.** `ToolGroup` in `ChatView.tsx` said “5 tool steps · Read a file · Searched the code” and put the raw body in a disclosure. It was accurate, but it read like a log, not like a person describing what happened. There was no turn duration and no per-step failure state.

**Why it fits.** The transcript is the main product surface. This is cheap polish with a large perceived-quality gain.

**Advantages**
- Scannable at a glance; fewer disclosures opened.
- Makes failures and interruptions visible.
- Duration answers “was that slow?” without a separate dashboard.
- Reuses the existing tool labels and stored tool messages.

**Drawbacks**
- Counts require a name-to-family mapping.
- A wrong count is worse than no count.
- Duration needs a join from messages to turns.
- Too many summary words can be longer than the list it replaces.

**Risks**
- Do not hide the raw output; keep the disclosure.
- Mark failures clearly; do not turn a failed step into a neutral line.
- Treat duration as approximate if the turn waited on approvals.
- Do not show a model-facing refusal sentence to the person. Translate it, as OpenBot's `shared/approval-outcomes.ts` does.

**Smallest slice**
- Extend the `ToolGroup` summary with counts by family:
  - `file_read` and `read_many` → “Read N files”
  - `search_text` and `explore_code` → “Searched the code N times”
  - `shell_run` → “Ran N commands”
  - `apply_patch` and `file_write` → “Changed N files”
  - browser tools → “Used the browser N times”
  - other tools → the existing labels
- Add “N issues” when any step failed or was stopped.
- Add a per-step status word from the `tool-end` event or the stored content.
- Add “Worked for Xs” under the assistant reply using `turns.ended_at`.
- Optionally translate model-facing refusal text into person-facing text: “You declined it” rather than “Do not try this action again.”

**Tests to add**
- Unit: the family mapping and pluralization.
- E2E: a read/search/shell run produces the expected summary.
- E2E: a completed turn shows a duration; a stopped turn does not claim success.
- No new model call.

**Do not copy.** Per-tool diff cards, command-output cards, and todo cards. Fid already has `EditedFilesCard` and `ChangesPanel`; duplicating diffs inside the tool group would be noise.

### O6. All routines view

**Status: DONE (20 November 2026).** The implementation is recorded under **DONE → All routines** above. The notes below are the design record.

**OpenBot.** `/routines` lists every Bot's routines in one place, with what it does, when it starts, and the next run. Active rows come first.

**Fid today.** Routines exist only inside one agent's Routines dialog and on that agent's desk. With several agents, scheduled work is scattered.

**Advantages**
- One place to see every next run and last failure.
- Toggle or run a routine without opening the agent first.
- Pairs naturally with the needs-you board.
- Small query and a small UI.

**Drawbacks**
- Another surface for controls that already exist.
- Editing still has to open the agent's Routines dialog.
- Cross-agent lists can become long.

**Risks**
- Toggling the wrong agent's routine. Show the agent name on every row.
- A stale next-run time. Reuse the existing schedule formatting.
- Do not allow create or edit from this view in the first slice; only Open, Enable/Disable, and Run now.

**Smallest slice**
- Add `routines:list-all` in `src/main/db/index.ts` and `src/main/ipc/index.ts`, joining the agent name.
- Add a **Routines** tab to the needs-you/inbox modal, or a small **All routines** modal from the sidebar.
- Group by agent; show schedule, next run, last status, and a toggle. **Open** switches to that agent and opens the existing Routines dialog.
- No schema change.

**Tests to add**
- Integration: `list-all` returns routines from multiple agents with the agent names.
- E2E: toggle a routine from the global list; Run now; Open switches agents.

### O7. Routine completion checklist

**OpenBot.** `shared/routine-checklist.ts` reads a top-level list of 2–10 parts from a routine's instruction. `shared/run-notices.ts` sends one nudge for parts that are still open. The run is expected to close each part as **Done**, **Blocked** (with the reason), or **Skipped** (with the reason).

**Fid today.** A routine can stop after the first two steps of a five-step instruction and still look finished.

**Advantages**
- A multi-step routine completes or says what is blocked.
- The run output is an explicit checklist instead of a vague summary.
- No UI work; the run history already shows the output.

**Drawbacks**
- One extra model turn when parts are open.
- Prompt overhead on every multi-part routine.
- List parsing is heuristic.

**Risks**
- A numbered list of data (twenty issue ids) is not a checklist. Cap at 2–8 top-level items.
- The model can write “Done” without doing the work. The checklist improves reporting, not truth.
- A nudge loop must be capped at one.
- Do not apply this to normal chat turns.

**Smallest slice**
- Add a shared parser for the outermost list of 2–8 items, adapted from OpenBot's rules.
- On a routine turn, append a short checklist notice to the prompt.
- After the run, find open parts in the final answer. If any remain, send one nudge with the open parts. If they are still open, append `Open: …` to the run output.
- No new table and no UI.

**Tests to add**
- Unit: list parsing, inline numbered steps, open-part detection, caps.
- Integration: a routine with a three-part list gets one nudge and its output records the closed parts.
- No live Copilot run for the parser; one optional live run for the full behavior.

### O8. Multi-field ask form

**OpenBot.** `app/src/components/gallery/form.tsx` supports up to eight labeled fields (text, email, number, select, textarea), required fields, validation, a submitted state, and recovery from a malformed form.

**Fid today.** `ask_user` asks one question with two to four choices plus **Other**. Some setup or requirements questions need three or four related values at once.

**Advantages**
- Fewer round trips when the agent needs several facts.
- Structured answers are easier for the model to use than free text.
- Reuses the existing pending-card pattern.

**Drawbacks**
- A larger card and a larger tool schema.
- The model may use it when a simple question would do.
- Validation and focus handling add code.

**Risks**
- Never request passwords, tokens, or other secrets. Those belong in the secret request flow.
- Cap the fields and lengths. Do not copy eight fields.
- Do not store the form separately; the answer belongs in the tool result and transcript.
- A malformed form must return a repair message, not leave the turn suspended.

**Smallest slice**
- Add `ask_form` with at most four fields: text, select, or boolean; one required flag; no email/number/textarea types in the first slice.
- One pending form per agent, with the same timeout and Stop behavior as `ask_user`.
- Return `{ status: "submitted", values }` or `{ status: "skipped" }`.
- A card with labels, required markers, inline validation, and a submitted summary.

**Tests to add**
- Unit: schema, duplicate field ids, required fields, length caps.
- Integration: the runner round trip returns the values to the model.
- E2E: the card submits, validates, and shows the answers after submit.
- No live Copilot run required for the card; one optional live run.

### O9. Fixed result cards, checklist first

**OpenBot.** `app/src/components/gallery/cards.tsx` defines record, metrics, checklist, and notice cards. `table.tsx` adds a sortable table; `charts.tsx` adds bar, donut, line, area, and progress charts. The model calls tools such as `showTable`, `showMetrics`, and `showChecklist`; the renderer validates the arguments and draws a component. `docs/how-openbot-works.md` calls this “components instead of prose.”

**Fid today.** Markdown, Mermaid, code blocks, `EditedFilesCard`, and `ChangesPanel`. There is no agent-rendered structured card.

**Why it fits, narrowly.** A turn-scoped checklist is the one card that adds something Markdown does not: a plan the user can scan while the agent works. Tables and charts are mostly presentation and cost more than they return in a coding app.

**Advantages**
- A plan reads better as a checklist than as prose.
- It gives the “plan” feel without reviving the removed sticky `set_plan` strip.
- Validation keeps the card safe and predictable.

**Drawbacks**
- Another rendering surface and another tool schema.
- The model may call it too often or not at all.
- Cards duplicate text if the model also writes the same list.

**Risks**
- Do not build an arbitrary React component gallery. A fixed, validated registry only.
- Cap items and string lengths; reject malformed arguments and return a repair message.
- Render only from the tool call's arguments, never from HTML or scripts.
- Scope the card to the turn. Do not persist it as an agent-level plan.

**Smallest slice**
- One `show_checklist` tool: title, items (`text`, `done`, optional `note`), max 12 items.
- Render it as a card in the transcript only when the tool call is complete.
- Prompt guidance: use it for a plan or progress update, not for ordinary findings.
- No charts, tables, record cards, metrics, or forms in the first slice.
- If it proves useful, add a sortable table; stop there.

**Tests to add**
- Unit: schema, caps, malformed arguments.
- E2E: a known tool call draws the checklist; a second turn does not inherit the first turn's card.
- One live test that the model calls it for a plan-shaped request; this spends quota.

**Do not copy.** Record cards, metrics cards, charts, donut charts, generated forms, the component gallery, or the admin playground.

### O10. Secret request card

**OpenBot.** `app/src/components/computer/computer-view.tsx` has a secret-supply form. The value goes straight to the page, never the transcript. The activity trail records that a secret was requested and how long it was, not what it said. `shared/tool-name.ts` names `computer_request_secret`; `docs/approvals.md` says credential changes are handed to the person.

**Fid today.** `src/main/secrets.ts` already stores the Copilot, GitHub, and Jira tokens encrypted with Electron `safeStorage`. Settings can save or clear them. An agent cannot ask for a new token without the user pasting it into chat. Idea 30 (“Command secrets without chat”) is already open.

**Why it fits.** Authenticated coding work needs `NPM_TOKEN`, a deploy key, or a Jira token. A request card is a safer bridge than chat, and it reuses the encrypted store.

**Advantages**
- The secret never enters the transcript or the model context.
- Explicit name, purpose, and scope make the request reviewable.
- Reuses `secrets.ts` and the existing card pattern.
- Closes idea 30 with a smaller UX than a full vault.

**Drawbacks**
- Environment injection can leak into a command's output.
- A secret may outlive the task unless it is cleared.
- The agent's own code can read an exported variable.

**Risks**
- Name the exact variable and scope in the card. Never a generic “enter a token.”
- Never return the value to the model. Return only “Stored.”
- Redact plain, base64, and URL-encoded forms in logs and tool output.
- Do not add a secret-read tool.
- Prefer one-time or session-scoped secrets; make **Clear** easy.
- This is not a security boundary against a malicious command. Say so in the doc and the card.

**Smallest slice**
- A `request_secret` tool with `name`, `purpose`, and `scope` (“shell_run only”).
- A card that asks for the value; on submit, store it encrypted under the agent and name.
- `shell_run` injects only names the user approved, in the environment of that call.
- The tool result says `Stored <NAME> for shell commands.`
- No browser fill, no secret listing, no value ever returned.

**Tests to add**
- Integration: store, inject, and clear; the value never appears in a tool result or log.
- Integration: redaction of plain, base64, and URL-encoded forms.
- E2E: the card saves and the next command sees the variable.
- No live Copilot run required for the store; one optional live request.

**Do not copy.** The browser password manager, the vault UI, OAuth app connections, or per-host credential filling.

### O11. Routine/follow-up proposal card

**OpenBot.** `shared/check-in-offer.ts` defines `offer_check_in`, which a Bot calls to offer a check-in on something just looked at. `docs/routines.md` lets a Bot create routines from conversation, with the cap and floor containing the risk.

**Fid today.** `routine_create` is exposed only during a `/routine` turn. Normal chat cannot create a routine, which is deliberate.

**Why it fits.** Users say “remind me tomorrow” or “check this every Monday” in normal chat. A proposal card makes that discoverable without giving the agent blanket write access.

**Advantages**
- One confirmation card, not a new permission.
- The agent can offer a follow-up at the moment it is useful.
- Reuses the routine service and the existing card patterns.

**Drawbacks**
- The model may propose routines too often.
- Another pending card type.
- Overlaps with `/routine`.

**Risks**
- The card is the write gate. The agent never creates the routine unattended.
- Cap one proposal per turn. Only propose when the user asked for a schedule or reminder.
- Validate the schedule with the existing service and show the next run before Create.
- **Not now** must write nothing.

**Smallest slice**
- A `propose_routine` tool with name, instruction, and schedule, available only in normal chat.
- A card with editable fields, **Create routine**, and **Not now**.
- On Create, call the existing `RoutinesService`; on failure, leave the card open with the error.
- No edit of existing routines and no goals/check-ins.

**Tests to add**
- Unit: schedule validation and caps.
- Integration: the card creates a routine through the service; Not now writes nothing.
- E2E: propose, edit, create, and see the routine in the agent's list.
- One live test that the model proposes for a reminder-shaped request.

### O12. Working indicator

**Status: DONE (20 November 2026).** The implementation is recorded under **DONE → Working indicator** above. The notes below are the design record.

**OpenBot.** `app/src/components/channels/working-now.tsx` shows which conversation is working and links to it; the sidebar marks every busy conversation.

**Fid before O12.** `ChatView` kept live turns in a renderer map so switching agents preserved the live view, but the sidebar had no running dot. A routine or queued turn could be running in an agent the user was not looking at.

**Advantages**
- Situational awareness with queue and routines.
- Clicking the row opens the working agent.
- Small state and a small UI.

**Drawbacks**
- The renderer needs a reliable running set.
- A stale dot is confusing.

**Risks**
- Main process is the source of truth. Emit start and end events; do not infer from the last message.
- Clear the dot on abort, error, and app restart.
- Do not show a routine run as the user's active turn unless it actually is.

**Smallest slice**
- Add `chat:running` IPC returning agent ids, plus start/end events.
- Show a pulsing dot and “Working” on the sidebar agent row.
- Optionally show a small “Working now” line above the composer for another agent.
- No new table.

**Tests to add**
- E2E: start a turn, switch agents, see the dot; stop the turn, see it clear.
- Integration: the running set clears on abort and error.

### O13. Activity/audit trail

**OpenBot.** `app/src/components/bot-profile/activity.tsx` groups routines, goals, handoffs, approvals, questions, and follow-ups. `app/src/components/audit/ask-the-trail.tsx` lets an admin ask questions about the audit trail. `shared/activity-rows.ts` deduplicates an action's first row from its failure row.

**Fid today.** Tool steps, approval history, routine history, and workspace changes already exist in separate places. There is no unified activity view.

**Verdict.** Do not build this now. A real audit table needs structured rows for every tool action, retention rules, sensitive-output handling, and a UI that does not duplicate the transcript. Fid already has the pieces a coding user needs. Revisit after MCP or multi-agent work creates actions that are not visible in a single transcript.

**If it is revisited:** start with a per-turn summary (steps, files changed, approvals, failures) rather than an audit table. OpenBot's “record the action before it runs” rule is the right principle for MCP.

### O14. Global full-text search

**OpenBot.** Not a clean match; its nearest feature is the natural-language audit query in `ask-the-trail.tsx`.

**Fid today.** Agent-name Ctrl+K search is done. Global transcript search is deferred in this document until chats exist.

**Verdict.** Keep it deferred. When chats ship, SQLite FTS5 over messages and turns is the pragmatic version. Do not copy the audit-query model; it adds a model call and an audit vocabulary Fid does not need.

### O15. Subagents

**OpenBot.** `shared/subagent.ts` describes `run_subagent`: a fresh run of the same Bot, in a derived thread, with up to 10 at once and 100 per answer. `app/src/components/channels/subtask-step.tsx` draws one row that opens to the subagent's steps. A subagent that reaches an approval stops and hands it back; the parent asks the user.

**Fid today.** `review_code` is a read-only subagent. Idea 32 (“read-only helpers”) is the planned general version.

**Verdict.** Idea 32 is the right size. OpenBot's design is a reference for a later generic version, not a reason to build task threads now. If Fid adds one helper, keep it read-only, depth one, no shell or browser, with a 12,000-character cap. Do not let a subagent ask or approve on its own.

### O16. Goals/check-ins

**OpenBot.** `docs/routines.md` unifies routines, goals, and check-ins. A goal has an outcome and can be completed; a check-in only tells you and runs at most hourly. `shared/responsibility-turn.ts` carries the run rules.

**Fid today.** Simple cron and one-time routines.

**Verdict.** Defer. Goals are a state machine: recurring versus ends-when-met, progress reports, completion switching off routines, event subscriptions, and a different run contract. Fid's simple routines plus O3 (report-only) and O7 (checklist) cover most of the value. If this is revisited, start with a **check-in** = read-only routine whose findings land in Needs you, not with full goals.

### O17. Skill tool declarations

**OpenBot.** `app/src/components/skills/skill-tools.tsx` lets a skill declare the tools it needs. Selection happens over skills: the run gets those skills' tools plus every granted tool no skill claims. A declaration is not a grant; it is intersected with what the Bot already has.

**Fid today.** Skills are instructions only. Tools are registered by profile. There are around 30 tools, so tool-count pressure is low.

**Verdict.** Revisit after MCP, when the tool count grows. If it is built, start with explicit `/skills <id>` invocation only: offer the declared tools plus the core read tools. Do not add model-based automatic skill selection in the first slice; it adds a model call and can hide a tool a task needs.

### Related to existing backlog

These are not new features. They are OpenBot details worth using when the existing item is built.

| OpenBot idea | Existing Fid item | What to borrow |
|---|---|---|
| Conversation-scoped approvals | 1. Chats (threads) per agent | **Allow once / Allow for this conversation / Always allow here / Deny**, plus the “Allowed in this conversation” line with **Turn off**. See `app/src/components/approvals/conversation-allowances.tsx`. |
| Tool effect classification | 5. MCP tool servers | Read/write/destructive effects; unknown tools are writes; a write asks before it runs; record the decision before the action. See `docs/approvals.md`, `shared/tool-name.ts`. |
| Subagent hand-back | 32. Read-only helpers | A helper that reaches an approval stops; the parent asks the user. No inherited approval right. |
| Fixed result cards | 33. A report template the agent fills | Prefer a fixed checklist/table card over arbitrary HTML components in the transcript. Keep the existing sandboxed HTML report for long documents. |
| Check-in findings | 9. A short open-work list | A finding is a row with **Work on it**, **Dismiss**, and **Stop checking**. Do not build a task board. |
| Secret request | 30. Command secrets without chat | The card names the variable and scope; the value goes to the command, never the transcript; return only “Stored.” |
| Working now | 15. A toast when a turn finishes | The same running set can drive the sidebar dot and the toast. |

### Not taking

These are intentionally excluded. They overlap with **Leave these out** below; listing them here keeps a future session from reopening them by accident.

- **Enterprise governance.** SSO, organizations, roles, SCIM, audit CSV, CEL boundaries, what-if policy simulation, Kubernetes/Helm, remote computers, shared computers, supervisors, and container isolation. Different product and deployment model.
- **Docker, remote browsers, and live screen streaming.** Fid's browser is local and headed; the user can see it.
- **Teach a Bot / recorder / screen recording.** OpenBot's most impressive feature, but it needs a browser extension, a Learning backend, and a product decision this document currently answers “no” to. Do not start here.
- **Group chat, task threads, delegation, bot-to-bot messages, and bots creating bots.** Explicitly out. The compatible subset is the read-only helper (idea 32).
- **Voice calls and dictation.** Out.
- **Automatic Learning and proposed skills from conversations.** Requires an external Learning service and carries noisy-skill risk. Fid's explicit `/skill-save` is the better local model.
- **Arbitrary generated React components.** A fixed, validated card registry is safe; a component gallery is not.
- **Auto-review approval model.** Explicitly out.
- **Security-floor and update-feed machinery.** Fid ships a portable Windows build; internal IT blocks installers. Not the same distribution problem.
- **Multiple model providers and model routing.** Copilot only.
- **A full audit table now.** O13 is later work.
- **Goals/check-ins now.** O16 is later work.

### Design principles worth copying

1. **One declaration, read from both sides.** OpenBot's `shared/` keeps approval outcomes, thread ids, and tool labels from drifting. Fid already does this; keep it.
2. **Record or decide before acting.** OpenBot writes the audit row before the action, so no path acts without a record. Use this for MCP and future app tools.
3. **Translate model-facing text for the person.** “Do not try this action again” is written for the model. The person should read “You declined it.” See `shared/approval-outcomes.ts`.
4. **Every wait has a card, a timeout, and an outcome line.** A question, handoff, or approval that disappears silently reads as a broken turn.
5. **Fail closed on unknown writes.** Especially for MCP and future app tools.
6. **Setup never blocks.** It says what is missing and how to fix it.
7. **Turn-scoped plans, not sticky plans.** The removed `set_plan` strip failed because it persisted across turns. A `show_checklist` card scoped to one turn avoids that.
8. **One message per failure, not one per attempt.** Run history can keep every row; the inbox and notifications should not.

### Source index

Read these only when a candidate needs more detail. This is the map that replaces a full rescan. Every path in this table is under `reference_projects/OpenBot/`.

| Area | OpenBot files |
|---|---|
| Routines | `docs/routines.md`, `shared/routine-checklist.ts`, `shared/run-notices.ts`, `app/src/routes/_authed/_app/routines.tsx`, `app/src/routes/_authed/_app/routines_.new.tsx`, `app/src/lib/routines/plan.ts` |
| Memory | `app/src/components/memory/memories.tsx`, `app/src/components/memory/sources.tsx`, `docs/architecture.md` (Personal memory), `shared/tool-name.ts` |
| Needs you | `app/src/components/needs-you/board.tsx`, `app/src/components/needs-you/needs-you.tsx`, `app/src/components/needs-you/board-row.tsx`, `app/src/components/needs-you/stalled-handoffs.tsx`, `app/src/components/approvals/waiting.tsx`, `app/src/components/approvals/conversation-allowances.tsx`, `app/src/components/tasks/task-row.tsx`, `app/src/components/suggestions/suggestion-row.tsx` |
| Setup | `app/src/components/setup/setup-checklist.tsx` |
| Tool transcript | `app/src/components/channels/tool-activity.tsx`, `app/src/components/channels/tool-line.tsx`, `app/src/components/channels/coding-tool-cards.tsx`, `app/src/components/tasks/worked-for.tsx`, `app/src/components/channels/browser-activity.tsx`, `app/src/components/channels/research-results.tsx`, `app/src/components/tasks/task-steer.tsx` |
| Result cards | `app/src/components/gallery/cards.tsx`, `app/src/components/gallery/table.tsx`, `app/src/components/gallery/charts.tsx`, `app/src/components/gallery/form.tsx`, `app/src/components/gallery/frame.tsx`, `docs/how-openbot-works.md` |
| Secrets and computer | `app/src/components/computer/computer-view.tsx`, `shared/tool-name.ts`, `docs/approvals.md` |
| Approvals | `docs/approvals.md`, `app/src/components/approvals/*`, `shared/approval-outcomes.ts`, `shared/standing-rule.ts`, `shared/tool-name.ts` |
| Subagents | `shared/subagent.ts`, `app/src/components/channels/subtask-step.tsx` |
| Recorder | `shared/recorder-api.ts`, `shared/demonstration-rules.ts`, `shared/recorder-masking.ts`, `app/src/components/computer/bot-browser.tsx`, `docs/personal-edition.md` |
| Delegation | `shared/orchestration.ts`, `docs/coworkers.md`, `app/src/components/bot-profile/delegation.tsx` |
| Activity/audit | `app/src/components/bot-profile/activity.tsx`, `app/src/components/audit/ask-the-trail.tsx`, `shared/activity-rows.ts` |
| Skills | `app/src/components/skills/skill-tools.tsx`, `app/src/components/skills/skill-fields.tsx`, `app/src/components/skills/proposed-skill.tsx` |
| Working now | `app/src/components/channels/working-now.tsx` |
| Conversation allowances | `app/src/components/approvals/conversation-allowances.tsx` |

**Do not rescan `reference_projects/OpenBot` for these features.** If a future question needs backend policy internals, read OpenBot's server repository or a running deployment, not this checkout. If OpenBot changes materially, update this section instead of starting a new survey.

## Smaller ideas still open

Each one is a note. Building one does not start the others.

### A. Catch one missed repeating routine when the app opens

**Will not ship.** This is a limitation of Routines 2.0. Background execution while Fid Coder is closed is not permitted. A slot that passed while the app was closed does not run on the next open. A one-time routine in that case is marked missed and paused.

### D. Show a failed or skipped routine on the agent

**Desk line DONE** with Routines 2.0. The desk routine row shows the last status and a relative time when `lastRunAt` is set.

The sidebar status line will not ship. The inbox is the list of skipped, failed, and missed runs, and the agent row stays quiet.

### E. Reveal a changed file in Explorer

A change row opens the diff, and the diff can revert that file. There is no way to open the file's folder from the desk.

**Show in folder** on the diff. The main process loads that change's path, checks it is still inside the agent workspace, and calls `shell.showItemInFolder`. Shell edits stay untracked.

Where: one IPC channel in `src/shared/channels.ts`, the preload inline list, `src/main/ipc/index.ts`, `FidApi`, and the button in the existing diff actions.

Done when: Show in folder highlights the changed file in Explorer, and a path outside the workspace is refused.

### 4. Markdown commands from the workspace

A file in `.agents/commands/`, `.github/prompts/`, or `.claude/commands/` becomes a slash command. Fid Coder's commands are a fixed list in code.

- **Advantage:** `/review-auth` can live in the repo next to the skills.
- **Drawback:** a command whose body is a prompt can surprise someone who expected a local action.
- **Risk:** a command file is untrusted text, same as a skill.
- **Smallest slice:** the filename is the command, the body is the prompt for that turn, and no scripts run.

### 5. Routines that run only when something changed

Watch a folder or a command and run only when the result differs.

- **Advantage:** "tell me when `src/main` changes" without a daily ping.
- **Drawback:** the check has to run on a timer while the app is open.
- **Risk:** a noisy folder wakes the agent all day.
- **Smallest slice:** one folder or one command, at least five minutes apart, and a chat note only when it changed.

### 8. Instruction history

Keep earlier instruction text and undo a change. The agent editor overwrites the current text.

- **Advantage:** a bad rewrite is recoverable.
- **Drawback:** ten copies of a long prompt.
- **Risk:** low if the agent cannot change its own tools from chat.
- **Smallest slice:** keep the last ten versions in the editor, with Restore. Permissions stay in the dialog.

### 9. A short open-work list

A few unfinished items on the agent, separate from its memory. The old plan strip was removed on purpose. See Removed below.

- **Advantage:** "still need to fix the preload" survives `/compact`.
- **Drawback:** it rots if nobody clears it.
- **Risk:** it turns back into a ticket system.
- **Smallest slice:** eight lines on the Agent Desk. You and the agent can add or complete them. A dated item should use the one-time routine that already exists.

### 10. Composer recall

Store each prompt and bring it back with Up.

- **Advantage:** you can resend a prompt you typed yesterday.
- **Drawback:** history can hold text you would rather not keep.
- **Risk:** low.
- **Smallest slice:** the last fifty prompts for that agent, Up and Down when the box is empty.

### 11. A context hint

Compaction today runs at thirty messages or when you run `/compact`.

- **Advantage:** a long thread is visible before the reply gets worse.
- **Drawback:** Copilot does not give a clean billed-token number.
- **Risk:** a fancy counter will be wrong.
- **Smallest slice:** "about N messages" in the header, and offer `/compact`. Skip fingerprint accounting. Idea 21 is the automatic compaction that can follow this hint.

### 12. One background shell, with Stop

`shell_run` holds the turn.

- **Advantage:** a dev server or a long test does not freeze the agent.
- **Drawback:** a process can outlive the turn.
- **Risk:** an orphaned process.
- **Smallest slice:** one background command per agent, a log file inside the workspace, and Stop on the tool card.

### 15. A toast when a turn finishes and the window is unfocused

Routine toasts already exist. This is a toast for an interactive turn.

- **Advantage:** a long run can be left, and the toast brings you back.
- **Risk:** low.
- **Smallest slice:** one toast, and a click focuses that agent.

### 16. Duplicate or export an agent

- **Advantage:** a second reviewer starts from a copy.
- **Risk:** an export that includes the transcript or a token.
- **Smallest slice:** name, instructions, model, and tool profile only.

### 17. Quote a span of a chat message

Pinning a code selection is already DONE. This quotes part of a reply.

- **Smallest slice:** select text, Quote, and send that span as a chip.

### 18. Four tool switches inside a profile

Profiles are coarse.

- **Smallest slice:** Shell, Write files, Browser actions, and Git write, as off switches in the agent editor.

### 19. Three starter templates

Instruction presets only fill the Instructions box. A template also adds a skill and a paused routine.

- **Smallest slice:** morning digest, pull-request review, and weekly repo check. Each creates the agent and one paused routine.

### 20. Stop without losing the turn

Stop aborts the session and saves the partial text plus `Stopped`.

- **Advantage:** stopping is safe, and the next message can continue from what already happened.
- **Drawback:** a stopped command may still be finishing on disk.
- **Risk:** the next turn replays a side effect. Note it on the tool card and pair it with approval.
- **Smallest slice:** keep partial text and completed tool cards, synthesize an "interrupted" result for a call with no return, and escalate a stop that does not settle after a few seconds.

### 21. Compact before the window, not at thirty messages

`/compact` and the thirty-message update are DONE. This changes when compaction runs.

- **Advantage:** a long coding session stays under the limit without a manual command.
- **Drawback:** an extra model call, and Copilot may not expose the window size.
- **Risk:** the summary drops an exact filename or error. Keep the recent tail and label the summary as a navigation aid.
- **Smallest slice:** use the last response's input-token count plus an estimate, trigger at about 80%, keep the last N turns verbatim, and fall back to dropping the oldest turns. Show "about N% full" in the header.

### 22. Spill a large tool result to a file

Tool output is clipped in the transcript.

- **Advantage:** a long test log stays available without crowding every later turn.
- **Drawback:** another file to clean up.
- **Risk:** the spill file captures a secret from a command. Scrub known env values and expire it.
- **Smallest slice:** over 20,000 characters, write the full result under the app data folder, return the first and last 2,000 characters plus the path, and let `file_read` read it. Expire after seven days.

### 23. Retry a dropped turn, stop a loop

Copilot can drop a stream, return an empty reply, or truncate output.

- **Advantage:** fewer lost turns, and fewer sessions that run the same failing test five times.
- **Drawback:** a retry can replay a tool that already succeeded.
- **Risk:** retry storms and duplicate edits. Cap attempts and never retry a write or shell call without a note.
- **Smallest slice:** retry a dropped stream twice with a short delay, retry an empty reply once, recover a truncated answer by asking for the continuation, and stop after six identical failing tool calls with a visible reason.

### 24. Reject with a note

Approval cards are binary.

- **Advantage:** "use the existing helper" is more useful than a bare no.
- **Drawback:** another text box on a card.
- **Risk:** low. The note is model input, so treat it as data.
- **Smallest slice:** an optional note on Reject, included in the denial message. Saved allow and deny rules stay as they are.

### 25. Treat fetched text as untrusted

Jira, pull requests, pages, and shell output enter with no distinction from workspace files.

- **Advantage:** a poisoned issue or page cannot quietly turn into a push or a file write.
- **Drawback:** the first web read can make the rest of the turn ask more often.
- **Risk:** over-tainting. Workspace files the user opened stay trusted.
- **Smallest slice:** mark the turn after a browser, Jira, GitHub, or shell result that contains external text. While tainted, require approval for `file_write` and `apply_patch`, and for any `shell_run` outside a short read-only allowlist. Show a small "external content" chip. Keep it deterministic.

### 26. Resume a paused approval after restart

An approval row survives a restart. The tool call waiting on it does not.

- **Advantage:** closing the app no longer loses an approved action.
- **Drawback:** the saved arguments can go stale while the app is closed.
- **Risk:** re-running against changed files. Show the saved command and the current state before resuming.
- **Smallest slice:** store the pending tool name, arguments, cwd, and turn id with the approval. On launch, show the card again. On approve, rebuild the call from the saved row. Reuse the approvals table.

### 27. Let the agent keep its own notes

Memory today is a model-written summary you can clear.

- **Advantage:** project conventions survive `/compact` and are auditable.
- **Drawback:** a second memory to curate.
- **Risk:** stale or poisoned facts. Cap the size and show the source.
- **Smallest slice:** a per-agent `MEMORY.md` in app data, capped at 4 KB, read and write tools, and a read-only view with history in the agent editor. Keep it out of the system prompt except as labelled data.

### 28. Browser actions that survive a rerender

The browser snapshots the page, then clicks by text or selector. Idea B (scroll and a key press) is the first slice of this item.

- **Advantage:** fewer clicks on the wrong control after a page rerenders.
- **Drawback:** one more snapshot per action.
- **Risk:** a stale ref or a slow page. Report "uncertain" and do not retry.
- **Smallest slice:** `browser_scroll` moves the page, or one selector, up or down (default about 600 pixels, cap 2000). `browser_press` sends one key from a fixed list: Enter, Escape, Tab, the arrows, PageDown, PageUp, Home, and End. Both tools are on the browser and all profiles. No new Jira write tool.
- **Follow-up:** numbered refs in `browser_snapshot`. `browser_click` and `browser_type` take a ref. A failed click returns "not confirmed, inspect before retrying". No replay tool.

### 30. Command secrets without chat

GitHub and Jira tokens are already stored encrypted. An agent cannot inject a new token into a command without pasting it.

- **Advantage:** `npm publish` or a deploy script works without a token in the prompt.
- **Drawback:** the agent's own code can read an exported variable.
- **Risk:** redaction misses an encoded copy. Never treat this as a boundary.
- **Smallest slice:** per-agent secret names in Settings, injected into `shell_run` only, redacted in plain, base64, and URL-encoded forms, and a `request_secret` card that names the exact host. No secret-read tool.

### 32. Read-only helpers

`explore_code` is the seed. This is one bounded helper for a side question.

- **Advantage:** a side question does not derail the main turn.
- **Drawback:** duplicated reading and token cost.
- **Risk:** a helper result can be wrong. Label it.
- **Smallest slice:** one helper, read-only tools only, depth one, no shell or browser, a 12,000-character result cap, and a card in the parent chat. No new sidebar agent. Add it after the queue (idea 1) exists.

### 33. A report template the agent fills

HTML files already open in a sandboxed preview.

- **Advantage:** a review or a test board reads better as a page than a wall of Markdown.
- **Drawback:** a generated page can be broken.
- **Risk:** scripts or network access in the page. Keep the existing sandbox.
- **Smallest slice:** a `report_write` tool that fills one fixed HTML template with title, summary, sections, and a table, writes it under `.fid/reports/`, and opens the existing preview. No page host, no share links, no component kit.

### 35. Accept one hunk

The changes panel accepts or reverts a whole file.

- **Advantage:** keep the useful half of a bad edit.
- **Drawback:** hunk state must survive a refresh.
- **Risk:** a stale hunk applies to the wrong lines. Re-read the file and refuse on a mismatch.
- **Smallest slice:** Accept and Reject on one hunk in `DiffView`, applied through the existing checkpoint, with a whole-file fallback.

## Deferred

- **Global full-text search.** After chats exist, the conversations table makes SQLite FTS cheap. Agent-name **Ctrl+K** is already DONE.
- **Jira writes.** Confluence writes are DONE natively; Jira remains a read-only tool. Native follow-ups if MCP does not cover the internal Atlassian setup.
- **Usage and activity dashboard.** The app shows one quota bar.
- **Portable auto-update or a LAN remote UI.** Relevant to internal distribution, and not a top workflow feature.
- **Per-hunk accept and a change timeline** are idea 35. The desk shows the latest turn.

## Open decisions

1. **Memory after threads.** Keep the rolling summary on the agent. Treat each thread transcript as task context.
2. **Routine threads.** One thread per routine.
3. **MCP transport.** Local stdio only in the first release.
4. **Approval policy scope.** Per-agent rules with a global default. The approval center already stores per-agent rules.
5. **Datadog packaging.** No separate Datadog CLI. The browser capture stays inside the app, and the model-facing contract is the two browser tools.

## Removed

### Agent plan status

**Removed on 31 October 2026.** Revisit only if progress can be host-driven.

It was a `set_plan` tool, a plan strip under the chat, a `plans` table, a `plan` chat event, and a `plans:get` IPC channel. The agent called `set_plan` with steps marked `pending`, `in_progress`, or `done`. The strip showed the current step. The latest plan was saved per agent and restored on reload.

Why it was removed:

- Whether a plan appeared depended on the model calling `set_plan`.
- The saved plan was scoped to the agent. An old plan stayed visible on later messages.
- The collapsed tool card already shows the running step, and it is host-generated.

If it comes back:

- Derive steps from tool events, or from a plan the host builds after the first user message.
- Scope progress to one turn. Clear it when the turn ends.
- Keep the tool card as the source of truth.
- Store only the current turn's steps, with the turn id.
- Cover it with a live test that sends two unrelated messages and checks that the second turn does not show the first turn's steps.

Pieces that were removed: `src/tools/plan.ts`, `planTools` in the registry, `PlanStep` / `PlanView` in shared types, the `plan` chat event, `plans:get`, the `plans` table, `PlanStrip.tsx`, and the `onPlan` hook on `ToolContext`.

## Leave these out

They fight the Copilot-only, no-Docker, local-browser rules, or they are larger than the job.

- Other model providers, round-robin keys, and models.dev.
- Docker computers, shared team desktops, and remote browsers.
- Group chat, bots messaging bots, and bots that create bots.
- Webhooks, inbound email, and Slack as routine triggers.
- Public share links and a page host. A report can already be a Markdown or HTML file in the workspace.
- A ticket board. Idea 9 is the smaller open-work list.
- Voice calls, screen recording to teach a skill, and an automatic approval model.
- Speculative execution and a code-mode Python sandbox.
- Plugins, hooks, and skill scripts.
- A durable-execution database. If a long task must survive a restart, one Markdown file in `.fid/` is enough.
- Shared memory services. Each agent keeps its own notes.

## Suggested order

Quiet interface work still open: composer recall, instruction restore, the finish toast, reject-with-note, the context hint, and Show in folder. Queue-while-running is done. Next are workspace commands. Change-watch routines remain open. Read-only helpers can follow.

Stop repair, compaction-by-window, and tool-output spill can sit with that quiet work. Fetched-text taint and the paused-approval resume belong with the approval center, before Agent mode widens further. Browser scroll and key press come before element refs. MCP, report templates, and command secrets come later. The Datadog analyst is DONE. Chats unblock a routine's own thread and forked chats. The inbox already opens the agent.

From the OpenBot survey, memory facts (O1), the needs-you board (O2), routine guardrails (O3), the tool activity summary (O5), the all-routines view (O6), and the working indicator (O12) are DONE. Wave 4 is the setup checklist (O4). The remaining OpenBot candidates wait on that, and O13–O17 wait on a product decision or a larger change.

## Related documents

- `AGENTS.md` — repository conventions and where new code belongs.
- `docs/memory.md` — transcripts, the rolling summary, and user-managed facts.
- `docs/build-exe.md` — packaging and distribution.
- `docs/workspace-explorer.md` — the shipped workspace panel.
- `docs/datadog-implementation.md` — the shipped Datadog analyst design and tool contract.
- `docs/guide/` — the in-app help.
