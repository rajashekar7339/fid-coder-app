# Codex-style workspace changes

Status: plan. Not started.

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

## Recommendation

Build this slice only. It uses the checkpoints already written and puts them where the screenshot puts them: in the thread, and in a turn-scoped diff plus file tree.
