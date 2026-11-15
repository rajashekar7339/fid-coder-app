# Features from Rakazo and code_puppy

Notes from the local checkouts in `reference_projects/rakazo` and `reference_projects/code_puppy`, compared with Fid Coder on 14 November 2026.

Fid Coder already has the pieces both projects treat as the core: skills loaded on demand, routines, approvals, memory and `/compact`, file undo, attachments, a local browser, and Ask versus Agent mode. The list below is what was still missing, and what to leave out.

Product limits that shaped the list: GitHub Copilot is the only model, there is no Docker and no remote browser, tools stay in the agent workspace, and the browser is local and headed.

## Add these

### 1. Queue the next message while a turn is running

The composer is disabled until the turn ends. Rakazo lets you keep talking while work continues. code_puppy parks the next prompt and can steer the live turn.

- **Advantage:** you do not lose the follow-up you thought of mid-run.
- **Drawback:** two instructions can overlap.
- **Risk:** steering a turn that is already editing files can contradict the edit in progress.
- **Smallest slice:** show the queued text above the composer and send it when the turn finishes. Leave mid-turn steering for later.

### 2. One question card

**Status:** Implemented.

code_puppy's `ask_user_question` and Rakazo's question cards let the agent ask a multiple-choice question and wait. The agent calls `ask_user` with one question and two to four choices. The card adds **Other** and **Skip**. A skip or a two-minute timeout tells the agent there is no answer, and the turn continues. Stop, closing the app, and the end of the turn close the card. The card is not stored.

- **Advantage:** "which of these three?" gets a real answer.
- **Drawback:** a turn sits idle until you reply.
- **Risk:** the agent asks something it could have answered from the repo. The tool description and the system hint tell it not to, and not to ask again after a skip.
- **Smallest slice:** this is the slice that shipped. It is on every Ask and Agent profile. It is not on the `/routine` create turn and not on the read-only review subagent.
- **Tests:** unit parsing, the runner round trip, `npm run test:questions` for the card, and `npm run test:questions-live` for one real turn.

### 3. Separate chats per agent, with resume by folder and branch

One agent is still one transcript, so a routine and a coding task share the same thread. This is already on the roadmap in `feature-enhancements.md`. code_puppy adds a useful extra: reopen the last session for this folder and git branch.

- **Advantage:** a new task starts clean, and coming back to a branch finds the old chat.
- **Drawback:** memory has to stay on the agent while the transcript stays on the chat.
- **Risk:** the migration touches every saved message.
- **Smallest slice:** New chat, a history list, and one Main chat for existing messages.

### 4. Markdown commands from the workspace

code_puppy turns a file in `.agents/commands/`, `.github/prompts/`, or `.claude/commands/` into a slash command. Fid Coder's commands are a fixed list in code.

- **Advantage:** `/review-auth` can live in the repo next to the skills you already load.
- **Drawback:** a command whose body is a prompt can surprise someone who expected a local action.
- **Risk:** a command file is untrusted text, same as a skill.
- **Smallest slice:** the filename is the command, the body is the prompt for that turn, and no scripts run.

### 5. Routines that run only when something changed

Rakazo can watch a folder or a command and run only when the result differs. A schedule, a webhook, and an inbox are already planned.

- **Advantage:** "tell me when `src/main` changes" or "when this test command starts failing" without a daily ping.
- **Drawback:** the check has to run on a timer while the app is open.
- **Risk:** a noisy folder wakes the agent all day.
- **Smallest slice:** one folder or one command, at least five minutes apart, and a chat note only when it changed.

### 6. Routine history and Stop

Rakazo lists each run and lets you stop one that is still going. The same history, tray, and inbox are already on the roadmap.

- **Advantage:** a failed morning run is visible, and a stuck run can be stopped.
- **Drawback:** run rows need pruning.
- **Risk:** a crash mid-run can look like a second run on the next launch.
- **Smallest slice:** a History tab with status, time, and an excerpt, plus Stop. A cheaper Copilot model per routine can wait.

### 7. Pin, archive, and Ctrl+K

**Status:** Implemented.

The agent menu can pin or archive. Pinned agents stay at the top of the list and keep a pin on the row. Archived agents leave the list and stay under **Archived**, with the conversation, routines, and browser profile kept. Restore brings an agent back, and a pin survives the round trip. **Ctrl+K** focuses the search. Enter opens the first match. Escape clears it. The search matches the name and the short description, including archived agents. An open dialog keeps **Ctrl+K**. There are no custom sections and no drag-reorder.

- **Advantage:** old agents leave the list without being deleted.
- **Drawback:** archive is another place to look. Search and the Archived row both reach it.
- **Risk:** low.
- **Smallest slice:** this is the slice that shipped.
- **Tests:** unit ordering and search, the database round trip, and `npm run test:sidebar` for the menu, search, and archive row.

### 8. Instruction history

Rakazo keeps earlier instruction text and can undo a change. The agent editor overwrites the current text.

- **Advantage:** a bad rewrite is recoverable.
- **Drawback:** ten copies of a long prompt.
- **Risk:** low if the agent cannot change its own tools from chat.
- **Smallest slice:** keep the last ten versions in the editor, with Restore. Permissions stay in the dialog.

### 9. A short open-work list

Rakazo keeps a few unfinished items on the bot, separate from its memory. The old task board was removed on purpose.

- **Advantage:** "still need to fix the preload" survives `/compact`.
- **Drawback:** it rots if nobody clears it.
- **Risk:** it turns back into a ticket system.
- **Smallest slice:** eight lines on the Agent Desk. You and the agent can add or complete them. A dated item should use the one-time routine that already exists.

### 10. Composer recall

code_puppy stores each prompt and brings it back with Up.

- **Advantage:** you can resend a prompt you typed yesterday.
- **Drawback:** history can hold text you would rather not keep.
- **Risk:** low.
- **Smallest slice:** the last fifty prompts for that agent, Up and Down when the box is empty.

### 11. A context hint

code_puppy measures the prompt and compacts from that. Fid Coder compacts at thirty messages or when you run `/compact`.

- **Advantage:** you can see a long thread before the reply gets worse.
- **Drawback:** Copilot does not give a clean billed-token number.
- **Risk:** a fancy counter will be wrong.
- **Smallest slice:** "about N messages" in the header, and offer `/compact`. Skip the fingerprint accounting.

### 12. One background shell, with Stop

code_puppy can background a long command and kill it. `shell_run` holds the turn.

- **Advantage:** a dev server or a long test does not freeze the agent.
- **Drawback:** a process can outlive the turn.
- **Risk:** an orphaned process.
- **Smallest slice:** one background command per agent, a log file inside the workspace, and Stop on the tool card.

### 13. Hand the browser back for sign-in

**Status:** Implemented.

The agent calls `browser_needs_you` with a short reason. A **Needs you** card appears. **I have the browser** brings the window forward and stays on. Clicks, typing, navigation, and snapshots are refused while the card is open. **Done** hands it back. The next click, type, or navigation waits for a fresh `browser_snapshot`. A ten-minute timeout continues the turn, tells the agent not to type a password, and still requires that snapshot. Stop closes the card. The card is not stored. It is on Ask mode and on the Browser and All tools profiles. It is not on Developer Agent mode, a routine run, the `/routine` create turn, or the review subagent.

- **Advantage:** a login or a captcha does not require pasting a password into chat.
- **Drawback:** the browser window and the chat can disagree about who is in control. The switch only focuses the window. Done is the hand-back.
- **Risk:** the bot clicks while you are typing. Browser tools stay blocked for the whole time the card is open.
- **Smallest slice:** this is the slice that shipped.
- **Tests:** unit rules for the held browser and the fresh snapshot, the runner round trip, `npm run test:handoff` for the card, and `npm run test:handoff-live` for one real browser turn.

### 14. Save this as a skill

**Status:** Implemented.

The agent calls `save_skill` only when you ask, with a name, a description, and the steps. A card shows editable name, when-to-use, and steps fields; correct anything that's off before Save. **Save** writes one `SKILL.md` into the app skills folder. **Don't save**, a two-minute timeout, and Stop write nothing. Secrets and fenced scripts are refused before the card. A built-in skill name is refused. Replacing an installed skill overwrites `SKILL.md` and leaves other files in that folder. Ask mode can save one. The card is the confirmation. `/skill-save` sends the same proposal request, reviews the whole task rather than only the last message, and never writes without the card. It is not on a routine run, the `/routine` create turn, or the review subagent.

- **Advantage:** a procedure you just finished becomes reusable.
- **Drawback:** a bad skill gets reused later. You see the steps before they are saved.
- **Risk:** the agent saves secrets or scripts into the skill. Those are refused before the card, and the file contains no scripts.
- **Smallest slice:** this is the slice that shipped.
- **Tests:** unit draft rules, the runner round trip, `npm run test:handoff` for the card, `npm run test:save-skill-live` for one real turn that writes the file, and `npm run test:skill-command-live` for a multi-turn `/skill-save`.

### 15. A toast when a turn finishes and the window is unfocused

Rakazo notifies when a bot finishes or is waiting. Routine toasts already exist.

- **Advantage:** you can leave a long run and come back from the toast.
- **Risk:** low.
- **Smallest slice:** one toast, and a click focuses that agent.

### 16. Duplicate or export an agent

Rakazo exports the setup.

- **Advantage:** a second reviewer starts from a copy.
- **Risk:** an export that includes the transcript or a token.
- **Smallest slice:** name, instructions, model, and tool profile only.

### 17. Quote a span of a chat message

You can already pin a code selection. Rakazo also quotes part of a reply.

- **Smallest slice:** select text, Quote, and send that span as a chip.

### 18. Four tool switches inside a profile

Rakazo can disable one tool. Profiles are coarse.

- **Smallest slice:** Shell, Write files, Browser actions, and Git write, as off switches in the agent editor.

### 19. Three starter templates

Instruction presets only fill the box. A Rakazo template also adds a skill and a paused routine.

- **Smallest slice:** morning digest, pull-request review, and weekly repo check. Each creates the agent and one paused routine.

## More from the second pass

Same rules as above: one small slice, no new backend, and nothing that breaks the Copilot-only, local-browser limits.

### 20. Stop without losing the turn

Stop aborts the session and saves the partial text plus `Stopped`. code_puppy keeps the partial answer and the completed tool results, then repairs dangling tool calls so the next request is valid.

- **Advantage:** stopping is safe, and you can continue from what already happened.
- **Drawback:** a stopped command may still be finishing on disk.
- **Risk:** the next turn replays a side effect. Note it on the tool card and pair it with approval.
- **Smallest slice:** keep partial text and completed tool cards, synthesize an "interrupted" result for a call with no return, and escalate a stop that does not settle after a few seconds.

### 21. Compact before the window, not at thirty messages

Fid compacts at thirty messages or when you run `/compact`. code_puppy compacts at a share of the model window, keeps a protected recent tail verbatim, and falls back to a sliding window if summarization fails. Item 11 is the visible hint; this is the action that follows it.

- **Advantage:** a long coding session stays under the limit without a manual command.
- **Drawback:** an extra model call, and Copilot may not expose the window size.
- **Risk:** the summary silently drops an exact filename or error. Keep the recent tail and label the summary as a navigation aid.
- **Smallest slice:** use the last response's input-token count plus an estimate, trigger at about 80%, keep the last N turns verbatim, and fall back to dropping the oldest turns. Show "about N% full" in the header.

### 22. Spill a large tool result to a file

Fid clips tool output to 2,000 characters in the transcript. code_puppy writes the full payload aside and gives the model a preview plus a handle it can read later.

- **Advantage:** a long test log is still available without crowding every later turn.
- **Drawback:** another file to clean up.
- **Risk:** the spill file captures a secret from a command. Scrub known env values and expire it.
- **Smallest slice:** over 20,000 characters, write the full result under the app data folder, return the first and last 2,000 characters plus the path, and let `file_read` read it. Expire after seven days.

### 23. Retry a dropped turn, stop a loop

Copilot can drop a stream, return an empty reply, or truncate output. code_puppy retries with progress-aware backoff and stops after repeated identical failing calls; Rakazo also has continuation prompts.

- **Advantage:** fewer lost turns, and fewer sessions that run the same failing test five times.
- **Drawback:** a retry can replay a tool that already succeeded.
- **Risk:** retry storms and duplicate edits. Cap attempts and never retry a write or shell call without a note.
- **Smallest slice:** retry a dropped stream twice with a short delay, retry an empty reply once, recover a truncated answer by asking for the continuation, and stop after six identical failing tool calls with a visible reason.

### 24. Reject with a note

Approval cards are binary. code_puppy returns `USER REJECTED: <feedback>` to the model, so a rejection can be a correction.

- **Advantage:** "use the existing helper" is more useful than a bare no.
- **Drawback:** another text box on a card.
- **Risk:** low; the note is model input, so treat it as data.
- **Smallest slice:** an optional note on Reject, included in the denial message. Saved allow and deny rules stay as they are.

### 25. Treat fetched text as untrusted

Rakazo marks a run tainted when web, email, connector, or shell text enters, then gates writes and sends even in its automatic mode. Fid reads Jira, pull requests, pages, and shell output with no such distinction.

- **Advantage:** a poisoned issue or page cannot quietly turn into a push or a file write.
- **Drawback:** the first web read can make the rest of the turn ask more often.
- **Risk:** over-tainting. Workspace files the user opened should stay trusted.
- **Smallest slice:** mark the turn after a browser, Jira, GitHub, or shell result that contains external text; while tainted, require approval for `file_write` and `apply_patch`, and for any `shell_run` outside a short read-only allowlist. Show a small "external content" chip. Keep it deterministic; no judge model.

### 26. Resume a paused approval after restart

An approval row survives a restart, but the tool call waiting on it does not. Rakazo checkpoints the turn before a pause.

- **Advantage:** closing the app no longer loses an approved action or a long task.
- **Drawback:** the saved arguments can go stale while the app is closed.
- **Risk:** re-running against changed files. Show the saved command and the current state before resuming.
- **Smallest slice:** store the pending tool name, arguments, cwd, and turn id with the approval. On launch, show the card again; on approve, rebuild the call from the saved row. Reuse the approvals table; do not add a durable-execution engine.

### 27. Let the agent keep its own notes

Fid's memory is a model-written summary you can only clear. Rakazo keeps a small editable memory document with revisions and explicit read and write tools.

- **Advantage:** project conventions and preferences survive `/compact` and are auditable.
- **Drawback:** a second memory to curate.
- **Risk:** stale or poisoned facts. Cap the size and show the source.
- **Smallest slice:** a per-agent `MEMORY.md` in app data, capped at 4 KB, read and write tools, and a read-only view with history in the agent editor. Keep it out of the system prompt except as labelled data.

### 28. Browser actions that survive a rerender

Fid snapshots the page, then clicks by text or selector. Rakazo returns element refs, rechecks them against a fresh snapshot, and refuses to replay an action whose outcome is uncertain.

- **Advantage:** fewer clicks on the wrong control after a page rerenders.
- **Drawback:** one more snapshot per action.
- **Risk:** a stale ref or a slow page. Report "uncertain" instead of retrying.
- **Smallest slice:** numbered refs in `browser_snapshot`, `browser_click` and `browser_type` take a ref, a failed click returns "not confirmed, inspect before retrying", and add `browser_scroll` plus `browser_press` for long pages and Escape or Tab. No replay tool.

### 29. A needs-you inbox

Routine toasts exist; an approval or a failed turn has no persistent place. Rakazo groups needs-attention, working, unread, and settled runs.

- **Advantage:** you can leave the app and still find what waited.
- **Drawback:** another list to clear.
- **Risk:** notification fatigue. A snooze must not hide an approval.
- **Smallest slice:** one bell with unread counts for approval requests, failed turns, and finished routines; clicking opens that agent. Add a window badge. Keep the finish toast from item 15.

### 30. Command secrets without chat

Fid stores the GitHub and Jira tokens encrypted, but an agent cannot inject a new token into a command without pasting it. Rakazo exports command variables fresh per command, redacts them from output, and lends a secret through a card.

- **Advantage:** `npm publish` or a deploy script works without a token in the prompt.
- **Drawback:** the agent's own code can read an exported variable.
- **Risk:** redaction misses an encoded copy. Never treat this as a boundary.
- **Smallest slice:** per-agent secret names in Settings, injected into `shell_run` only, redacted in plain, base64, and URL-encoded forms, and a `request_secret` card that names the exact host. No secret-read tool.

### 31. MCP servers, bound per agent

Fid's roadmap has MCP. code_puppy adds per-agent bindings, health and retry handling, and a server that does not start unless that agent asks for it.

- **Advantage:** an internal system becomes a tool without changing Fid.
- **Drawback:** tool schemas consume context, and a server is arbitrary local code.
- **Risk:** a flaky or hostile server. Show the command, fail closed, and cap the tool list.
- **Smallest slice:** stdio only, off by default, one server checked per agent, a connection test, tools routed through the approval center, and no HTTP or OAuth in the first slice.

### 32. Read-only helpers

code_puppy and Rakazo both delegate research or review to a child with a smaller toolset and return a bounded result. `explore_code` is the seed.

- **Advantage:** a side question does not derail the main turn.
- **Drawback:** duplicated reading and token cost.
- **Risk:** a helper result is untrusted and can be wrong. Label it.
- **Smallest slice:** one helper, read-only tools only, depth one, no shell or browser, a 12,000-character result cap, and a card in the parent chat. No new sidebar agent. Add it after the queue exists.

### 33. A report template the agent fills

Fid can already preview an HTML file in a sandbox. Rakazo's pages add a curated kit and versions; the file is the useful part.

- **Advantage:** a review, migration plan, or test board reads better as a page than a wall of Markdown.
- **Drawback:** a generated page can be broken or ugly.
- **Risk:** scripts or network access in the page. Keep the existing sandbox.
- **Smallest slice:** a `report_write` tool that fills one fixed HTML template with title, summary, sections, and a table, writes it under `.fid/reports/`, and opens the existing preview. No page host, no share links, no component kit.

### 34. Fork a chat

Once chats exist, Rakazo and code_puppy can branch one without changing the original.

- **Advantage:** try a refactor or a reviewer pass on a copy.
- **Drawback:** copied history and storage.
- **Risk:** confusing which branch is live. Show the lineage.
- **Smallest slice:** Duplicate chat from the history list, with a new title and a "forked from" label. No merge.

### 35. Accept one hunk

The changes panel accepts or reverts a whole file. code_puppy's diffs are per edit; Rakazo's reviews are per change.

- **Advantage:** keep the useful half of a bad edit.
- **Drawback:** hunk state must survive a refresh.
- **Risk:** a stale hunk applies to the wrong lines. Re-read the file and refuse on a mismatch.
- **Smallest slice:** Accept and Reject on one hunk in `DiffView`, applied through the existing checkpoint, with a whole-file fallback.

## Leave these out

They fight the Copilot-only, no-Docker, local-browser rules, or they are larger than the job.

- Other model providers, round-robin keys, and models.dev.
- Docker computers, shared team desktops, and remote browsers.
- Group chat, bots messaging bots, and bots that create bots.
- Webhooks, inbound email, and Slack as routine triggers.
- Public share links and a page host. A report can already be a Markdown or HTML file in the workspace.
- A ticket board. The open-work list above is the smaller version.
- Voice calls, screen recording to teach a skill, and an automatic approval model.
- Speculative execution and the code-mode Python sandbox. Tools would run before the reply is finished, which fights approvals.
- Plugins, hooks, and skill scripts. Both codebases treat third-party code as out of bounds.
- A durable-execution database. If a long task must survive a restart, one Markdown file in `.fid/` is enough.
- Shared memory services. Each agent keeps its own notes.

## Order

Do the quiet interface work first: composer recall, pin and archive, instruction restore, and the finish toast. Then queue-while-running, and workspace commands. Then change-watch routines, run history, and browser hand-off. Read-only helpers, at most three, with a status card in the parent chat and no new sidebar agent, come after the queue exists.

From the second pass, group the small safety fixes with the quiet interface work: Stop repair, reject-with-note, compaction, and tool-output spill. Fetched-text taint and the paused-approval resume belong with the approval work, before Agent mode widens. Browser refs come before hand-off. MCP, report templates, and command secrets come later.

The question card (item 2) is already in the app.
