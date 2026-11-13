# Codex-style workspace changes

Status: implemented 10 November 2026. The approved slice includes the review-citation bridge and syntax-colored diffs; the in-progress thread card is deferred. A follow-up removed the separate reader; citations now open in the Changes panel itself.

Reference: Codex change review (screenshot 10 November 2026). The chat shows an edited-files card. The right side is a Changes panel with a turn picker, the selected diff, and a changed-file tree.

## What this matches

The screenshot is Codex reviewing one workspace thread. The chat shows an **Edited N files** card (`+566 −4,083`, Undo, View changes, a short file list, “Show more”). The right side is a **Changes** panel: a **Last turn** picker with the same totals, the selected file’s diff, and a folder tree of changed files with per-file `+`/`−`.

Fid Coder already records this data. `turns` and `file_changes` store each `file_write` / `apply_patch`, with additions, deletions, and a checkpoint. `CheckpointStore.latest`, `diff`, `revert`, and `revertTurn` exist. The Agent Desk shows only the latest turn as a flat list, and the diff opens in a modal. The chat never mentions the edit. Shell edits stay untracked. That limit stays.

Ask mode is unchanged. It cannot write files, so this panel has nothing to show for a read-only turn.

## What stays out

- Projects, a thread list, and renaming the sidebar. An agent remains one teammate, one workspace folder, and one transcript.
- A code editor, syntax-colored full-file view, or a new diff engine. Reuse `DiffView`.
- Recording shell edits, deletes, or git commits. The panel says what it tracks.
- A new model call, starter flow, or change to Ask mode, the project map, or tool profiles.
- Raising the existing caps: 40 files per turn, 14-day checkpoint retention.

## Experience

1. After an assistant reply whose turn edited files, the thread shows one card: **Edited N files**, the turn’s `+`/`−`, **Undo**, and **View changes**. The first four paths are visible. The rest sit behind **Show N more**. A turn still in progress says **Recording changes…** and Undo stays disabled until the turn status is set and every file is revertible.
2. **View changes**, or a **Changes** button in the chat header, opens a wide panel and closes the Agent Desk. The two panels do not sit open together. The header button shows the latest turn’s `+`/`−` when one exists.
3. The panel header is **Changes**, a turn menu (newest first, default **Last turn**, each row has its time and totals), **Undo**, and close. The body is the existing line diff on the left and a file tree on the right. The tree groups by folder, shows the file name, `+`/`−`, and **new** or **edit**. A filter box narrows the tree by path. Clicking a file in the tree or in the chat card selects it. **Revert file** stays on the diff, behind the same confirm dialog as today. **Undo** is **Revert turn**, same confirm copy as today.
4. The Agent Desk Changes section becomes one line: file count, totals, and **Open changes**. Browser, approvals, routines, workspace path, and project rules stay on the desk.
5. Below 1180px the panel uses the same scrim as the desk, wider than 324px so the diff and tree both fit (`min(760px, calc(100vw - 40px))`). At 1180px and above the shell gains a third column, about 46vw with a 560px minimum, only while the panel is open.

## Data

Add `CheckpointStore.list(agentId, limit)` beside `latest`. It returns the same `ChangeSet` shape, newest turn first, skipping turns with no file rows. Default limit 30.

`AppDatabase` gets `listChangeSets(agentId, limit)` using the same join as `latestChangeSet`. No schema change. Summaries only. File text still loads through `changes.diff` when a file is selected.

Wire `changes:list` through `src/shared/channels.ts`, `src/shared/api.ts`, `src/preload/index.ts` (channel string copied by hand), and `src/main/ipc/index.ts`.

A pure helper in `src/shared/change-tree.ts` groups relative paths into folders and applies the filter. The renderer does not invent that structure inline.

## Files

- `src/main/db/index.ts` — `listChangeSets`.
- `src/main/workspace/checkpoints.ts` — `list`, reusing the `latest` file mapping.
- `src/shared/channels.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc/index.ts` — `changes:list`.
- `src/shared/change-tree.ts` — folder grouping and path filter.
- `src/renderer/components/desk/ChangesPanel.tsx` — panel. It owns the selected turn, selected file, diff fetch, filter, and both confirm dialogs. `DiffView` stays as it is.
- `src/renderer/components/chat/EditedFilesCard.tsx` — the in-thread card.
- `src/renderer/components/chat/ChatView.tsx` — load the list with the thread, refresh when the live turn settles, render one card on the assistant message that shares `turnId`. Header **Changes** button.
- `src/renderer/App.tsx` — `changesOpen` state. Opening it clears `deskOpen`. Pass the open request from the card (`turnId`, optional `fileId`).
- `src/renderer/components/desk/AgentDesk.tsx` — replace the change list and diff modal with the one-line summary. Desk no longer calls `changes.diff`.
- `src/renderer/styles/index.css` — panel, tree, and card rules next to the existing desk and diff sections. `@import "tailwindcss"` stays the first line. Add `.app-shell.has-changes` beside `.has-desk`, including the 1180px overlay.
- `docs/guide/work-in-a-workspace.md` and `src/renderer/lib/guide.ts` — short section and one screenshot of the panel with a file selected. Extend `scripts/generate-guide-screenshots.mjs` for that shot.
- `tests/e2e-live/changes-context.e2e.mjs` — point the existing revert checks at the panel (open Changes, tree row, diff, revert file, undo turn). The desk must still expose project rules and Context, which that script checks later.

## Tests

- Unit: `list` order, turns with no files omitted, limit. Tree grouping, nested folders, and the filter. Card totals equal the sum of file stats.
- Integration: IPC/database list against a temp sqlite file, no Copilot call.
- `npm run typecheck`.
- Live `changes-context` e2e only when Copilot is signed in. If it is blocked, say so. Do not add a new live script.

## Risks

- Undo of an older turn still fails when a later edit changed the same file. Show that error on the panel. Do not build a git-style undo stack.
- The chat must not call `changes.diff` for every file. One selected file at a time.
- The 40-file cap means **Show more** never reveals a 45th file. The card and tree share that cap. The footer keeps the current sentence: file tools are tracked, shell changes are not.
- Opening Changes hides the desk. Context, rules, and the browser preview remain one click away on the desk button.

## Review notes (10 November 2026)

Feasible. The data is already there: `turns`, `file_changes`, the checkpoint blobs, `diffLines`, `latest`, `diff`, `revert`, and `revertTurn`. No schema change is needed. The main gap is the review-citation path: the plan covers an agent's edits but not a citation from a review answer pointing at the right file and highlighted range in the change.

### Add before implementation

1. **Review citation bridge.** When a `path:line` citation is clicked:
   - Look up the path in the loaded change sets, newest turn first.
   - `FilePeekDialog` shows the exact file and range, plus a **Changed in last turn** badge and **View diff** when the file is part of a change.
   - **View diff** opens `ChangesPanel` at that turn and file and passes the cited range to `DiffView`; the matching lines get a cited marker and scroll into view.
   - If the file is not in a change set, the reader behaves as it does today with no diff action.
   - This needs `FilePeekDialog.tsx`, `ChangesPanel.tsx`, `DiffView.tsx`, `ChatView.tsx`, and `App.tsx`; the mock shows the intended state.

2. **One owner for the change list.** The plan has `ChatView` loading the list and `ChangesPanel` fetching its own. Lift `changeSets` to `App` (or one small hook) and pass it to the header button, card, and panel. Reverting a file or turn must refresh that shared list so the card cannot show stale files.

3. **In-progress card.** `LiveTurn` and `ChatEvent` have no `turnId`, so the thread cannot reliably attach a card to a running turn. Either add `turnId` to the live event or defer **Recording changes…** to the Changes button/panel. Recommended: show the card after `done`, and use the header/panel for the recording state.

4. **Diff syntax colors.** `DiffView` is currently plain red/green text. Codex is syntax-colored. Reuse `highlightCode`/`languageForPath` per line; this stays inside the existing diff engine. The mock shows the intended result.

5. **Undo targets the selected turn.** The panel's Undo must call `revertTurn(selectedTurnId)`, not the latest turn. After a file revert, remove that file from the panel and select the next file or turn. After a turn revert, remove the turn from the list.

6. **Card placement and refresh.** `Message.turnId` exists. Render the card once, on the last assistant message that shares the turn, not on tool messages or every assistant message. Refresh the change list on thread load, `done`/`error`, and after any revert.

7. **States and accessibility.** Cover no workspace, Ask mode (no card and no Changes button), no recorded changes, loading/error, filtered-empty tree, and a turn whose files are not revertible. Add keyboard focus to the tree, restore focus when the panel closes, and preserve the selected file when switching turns if that path still exists.

### Recommended order

1. `changes:list`, `change-tree`, shared `changeSets` in App, card, panel, file tree, diff; reuse `DiffView`.
2. Citation bridge: changed badge, View diff, cited lines in `DiffView`.
3. Syntax-colored diff, docs/screenshot, deterministic UI checks for the card/panel/citation path, then update the live `changes-context` e2e.

### Decisions made

- Citation bridge: included.
- Syntax-colored diff: included.
- In-progress thread card: deferred.
- Third-column layout at 1180px and overlay below it: included.

UI mock: `temp/codex-changes-mock.html` (interactive), screenshots `temp/mock2-agent.png`, `temp/mock2-review.png`, `temp/mock2-diff.png`, `temp/mock2-mobile.png`.

## Follow-up: citations in place (10 November 2026)

The separate `FilePeekDialog` reader was removed after the first implementation. A citation now opens `ChangesPanel` directly:

- A recorded change selects the file and turn, shows the diff in place, and marks the cited range in `DiffView`.
- A file without a recorded change shows a read-only code view in the same pane, with syntax highlighting and the cited range marked.
- The navigator's **References** section carries the answer-wide citation list. A reference with a recorded change opens its diff; one without opens the read-only view. A **changed** label marks the former.
- The **Changed** tab stays available for the turn's file tree, with the existing filter, revert file, and turn Undo.
- There is no changed badge, **View diff** step, **Back to code** step, tab history, or modal. The project map closes when a citation opens the panel.

The deterministic changes e2e covers both changed and unchanged citations, the reference list, revert, and Undo. The skills e2e covers a project-map citation opening the panel and reference-to-file navigation.

## Follow-up: workspace explorer (11 November 2026)

The panel is now a workspace navigator. The **References**, **Changed**, and **All files** sections stack in the right column; **All files** is a lazy, read-only tree built from `workspace:list`. The chat header's **Workspace** button, `/files`, and the Agent Desk's **Browse files** action open the panel even when there are no changes; all are hidden without a workspace folder. A citation selects the path, expands its ancestors, and marks the range in the diff or code. A file from **All files** opens read-only and offers **View diff** when the selected turn recorded a change. Browsing reads 400-line pages through `workspace.file`; citations keep their 160-line window. Markdown and HTML files open with a **Preview / Source** toggle; HTML previews are sandboxed and block scripts and external assets. Images open as read-only previews. At wide widths, **Collapse chat** in the panel header gives the workspace the full width; closing the panel restores the chat. The generic `src/shared/file-tree.ts` helper replaced the change-specific `src/shared/change-tree.ts`, which was removed. See `docs/workspace-explorer.md` for the design and data notes.

## Recommendation

Build this slice only. It uses the checkpoints already written and puts them where the screenshot puts them: in the thread, and in a turn-scoped diff plus file tree.
