# Features

One backlog for Fid Coder. Combined on 15 November 2026 from the old feature-enhancements, future-enhancements, and reference-feature-ideas notes, then checked against the code. Those three files are retired.

**DONE** means the behavior is in the app. Open items are still to build. Removed means it was taken out on purpose.

The user guide (`docs/guide/`), `docs/memory.md`, `docs/build-exe.md`, `docs/workspace-explorer.md`, and `docs/archive/` stay their own documents. The Datadog analyst plan stays in `docs/datadog-implementation.md`.

## Product constraints

- GitHub Copilot is the only model backend.
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
- Ask mode and Agent mode. Ask mode uses the read-only tool set. Agent mode uses the selected tool profile.
- Per-agent headed browser and Jira tools.
- GitHub pull request tools and the GitHub token.
- Native workspace tools: list, glob, search, read, write, patch, git, and shell.
- `explore_code`, the workspace brief, project rules, and the project map (built only when the user asks).
- Turn checkpoints, file diffs, and revert.
- The workspace explorer: citations, changed files, and a lazy tree. Spec: `docs/workspace-explorer.md`.
- Skills loaded on demand, the Skills library, and `/skills`.
- `/compact` and the rolling summary. Spec: `docs/memory.md`.
- Enhance on the composer. It rewrites the draft and does not send.
- Routines 2.0: cron and one-time schedules, manual runs, Windows toasts, a tray while the app is open, run history, and an inbox. **Limitation:** nothing runs while the app is closed, and a missed slot is not caught up. Spec is under Routines 2.0 below.
- Copilot usage, the help center, and the portable Windows build.
- Pinning a code selection (`Ctrl+Shift+L`) for the next message. Quoting a span of a chat reply is still open (idea 17).

### Approval center

**DONE.** Turn-scoped.

An inline card names the command, working directory, and risk reason. The choices are **Allow once**, **Always allow**, **Reject**, and **Always deny**. Each agent has saved allow and deny rules, and deny wins. A timeout denies, and Stop denies a pending request. Decisions are stored. `shell_run` waits for that decision on deletes, git pushes, and downloads. The model cannot set its own confirmed flag.

A conversation id on the audit row waits until chats exist. Saved rules live in Settings → Safety, with a history view on the Agent Desk.

### Composer attachments

**DONE.** This replaces the 30 October design (copies under user data, an 8-file / 20 MB cap, and a dependency on chats) and idea C (one fenced text file and no new column).

Images the app supports go to the model as binary attachments, up to 10 MB. Every other file is passed by path. Text and code uploads are copied to `.fid/uploads/<id>/` inside the workspace. Workspace references keep their relative path. Line selections send the exact text, up to 200,000 characters. The runner stores descriptors on the message as JSON and puts an `Attached files:` list at the top of the prompt. The agent reads those paths with its own file tools. A text attachment needs an agent with file tools. A Browser & Jira agent can still receive a supported image.

### Queue a follow-up

**DONE.** Idea 1.

The composer stays open while a turn runs. **Enter** queues the draft; it appears above the composer in order. Each row shows **Send now**, **Edit**, and **Cancel**. **Send now** stops the current turn and starts that message. **Edit** changes the queued text in place, and **Cancel** removes it. With text in the composer, **Ctrl+Enter** (Cmd+Enter) does the same as Send now.

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

The bell count is live approvals plus unread routine and turn rows. Opening a stored row marks it read. Snooze hides that row for four hours and does not apply to an approval. The same count is the window badge.

The run row is written as `running` before the turn. A `running` row left after a restart becomes interrupted and is not fired again. Scheduled finishes, misses, and interrupted runs enter the inbox. A manual run stays in history only. Rows older than 90 days are removed on reload.

Tests: unit rules for due times, excerpts, labels, and the inbox list; integration coverage for a closed-app miss, pause, interrupt, Stop, a failed abort, snooze, and pruning; `npm run test:routines` for the desk, the Routines/History switch, History refresh, draft preservation, the idle Save state, and the inbox. No live Copilot run.

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

### Datadog analyst

**Status:** Open. The plan is `docs/datadog-implementation.md` (draft, 31 October 2026). It is a read-only analyst that uses the agent's headed browser session. It does not use a Datadog API key. SSO inside the Playwright window is the prerequisite. Nothing from that plan is in the app.

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
- **Confluence and Jira writes.** Native follow-ups if MCP does not cover the internal Atlassian setup.
- **Usage and activity dashboard.** The app shows one quota bar.
- **Portable auto-update or a LAN remote UI.** Relevant to internal distribution, and not a top workflow feature.
- **Per-hunk accept and a change timeline** are idea 35. The desk shows the latest turn.

## Open decisions

1. **Memory after threads.** Keep the rolling summary on the agent. Treat each thread transcript as task context.
2. **Routine threads.** One thread per routine.
3. **MCP transport.** Local stdio only in the first release.
4. **Approval policy scope.** Per-agent rules with a global default. The approval center already stores per-agent rules.
5. **Release-impact packaging.** If the Datadog plan grows a CLI, keep one dependency-free CLI plus a thin Fid Coder tool. The engine selects deterministically. The agent reviews and explains. The CLI never calls Copilot.

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

Stop repair, compaction-by-window, and tool-output spill can sit with that quiet work. Fetched-text taint and the paused-approval resume belong with the approval center, before Agent mode widens further. Browser scroll and key press come before element refs. MCP, the Datadog analyst, report templates, and command secrets come later. Chats unblock a routine's own thread and forked chats. The inbox already opens the agent.

## Related documents

- `AGENTS.md` — repository conventions and where new code belongs.
- `docs/memory.md` — transcripts and the rolling summary.
- `docs/build-exe.md` — packaging and distribution.
- `docs/workspace-explorer.md` — the shipped workspace panel.
- `docs/datadog-implementation.md` — the unshipped Datadog analyst plan.
- `docs/guide/` — the in-app help.
