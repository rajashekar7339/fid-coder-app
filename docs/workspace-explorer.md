# Workspace explorer

Status: implemented 11 November 2026. Design mock: `temp/workspace-explorer-mock.html`.

The Changes panel is now a Workspace navigator. The chat header's **Workspace** button, the `/files` command, and the Agent Desk's **Browse files** action open it at any time, even before the agent has changed a file; all three are hidden when the agent has no workspace folder. A `path:line` citation opens it at the exact file and range. The user can browse the repo without asking the agent a question.

## Behavior

- The right column stacks **References**, **Changed**, and **All files**.
- **References** lists every citation in the answer. A changed reference is labelled; selecting one moves the tree and viewer together.
- **Changed** lists the selected turn's files and totals. Its rows open the diff. The turn picker, **Undo**, and **Revert file** are unchanged.
- **All files** is a lazy, read-only tree. Directories load one level at a time; changed files in the selected turn carry a dot and `+`/`−`.
- A citation selects the path, expands its ancestors, and marks the range. A recorded change shows its diff; a file without a change opens read-only.
- A citation may name only a file, such as `Test.java:123`. The reader tries the exact workspace-relative path first, then a unique path suffix. When several files share the name, the panel says the name is ambiguous and lists the candidates instead of opening an arbitrary file. A partial path such as `main/java/Test.java` works the same way.
- A file from **All files** opens read-only. When the selected turn recorded a change, **View diff** switches to the diff.
- `Ctrl+P` focuses the filter. **Changed only** limits the tree to the selected turn. The filter covers loaded folders; the footer says how many files are loaded.
- Loaded folders reload when `changes:list` refreshes after a turn or revert.
- Common images (PNG, JPEG, GIF, WebP, BMP, ICO, AVIF) open as read-only previews. The preview is capped at 10 MB.
- Markdown files open in a rendered read-only preview with a **Preview / Source** toggle. The preview reuses the chat Markdown renderer, so headings, lists, tables, code blocks, and Mermaid diagrams render.
- HTML files open in a sandboxed **Preview / Source** view. Scripts, forms, and external assets are blocked by the sandbox and a restrictive CSP; inline styles work. The preview reads up to 20,000 lines.
- Below 1180px the panel uses the existing overlay. At 1180px and above it stays a third column.
- At 1181px and wider, **Collapse chat** in the panel header slides the chat left and gives the workspace the full width. **Show chat** restores the split; closing the panel also restores it.

## Data

```ts
export type WorkspaceEntry = {
  name: string;
  path: string; // relative, forward slashes
  kind: "dir" | "file";
};

export type WorkspaceDirectory = {
  entries: WorkspaceEntry[];
  truncated: boolean;
};

export type WorkspaceImagePeek = {
  path: string;
  mime: string;
  dataUrl: string;
  bytes: number;
};

workspace.list(agentId: string, path = ""): Promise<WorkspaceDirectory>;
workspace.image(agentId: string, path: string): Promise<WorkspaceImagePeek>;
```

- `workspace:list` reads one directory level, skips symlinks and `SKIP_DIR_NAMES`, sorts folders first, and caps a folder at 400 entries with a `truncated` flag.
- `workspace.file` accepts `startLine` and `limit`. Browsing reads 400-line pages and appends them with **Load more**; citations keep the 160-line window. The 512 KB text and binary guards stay.
- `workspace:image-read` reads a supported image into a data URL after `resolveInside` and a size check.
- `src/main/workspace/resolve-file.ts` resolves exact paths and unique name suffixes for text and image reads. Its index skips `SKIP_DIR_NAMES` and symlinks, caps at 20,000 entries, and is cached for three seconds. An incomplete index asks for a fuller path instead of claiming the file is missing.
- Every path goes through `resolveInside`; the tree is agent-scoped.
- No schema change, no model call, no new agent tool.

## Files

- `src/main/workspace/file-tree.ts`, `src/main/workspace/file-peek.ts`, `src/main/workspace/image-peek.ts`, `src/main/workspace/resolve-file.ts`: safe listing, path resolution, paging, image preview.
- `src/shared/file-tree.ts`, `src/shared/image.ts`, `src/shared/preview.ts`, `src/shared/types.ts`: path tree, image type map, preview routing and CSP, shared types.
- `src/shared/channels.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc/index.ts`: `workspace:list`, `workspace:image-read`, and the paging arguments.
- `src/renderer/components/desk/ChangesPanel.tsx`: panel state, request and citation selection, diff, revert.
- `src/renderer/components/desk/WorkspaceNavigator.tsx`: References, Changed, All files, filtering, and the tree.
- `src/renderer/components/desk/WorkspaceCodePane.tsx`: read-only code, paging, Markdown/HTML previews, and image preview.
- `src/renderer/styles/index.css`: navigator, tree, preview, image, and collapse rules.
- `src/renderer/components/chat/ChatView.tsx`, `src/shared/commands.ts`: the **Workspace** header button and `/files` command.
- `src/renderer/components/desk/AgentDesk.tsx`: the Workspace section's **Browse files** action.
- Tests: `tests/unit/file-tree.test.ts`, `tests/unit/image.test.ts`, `tests/unit/preview.test.ts`, `tests/unit/changes.test.ts`, `tests/unit/commands.test.ts`, `tests/integration/file-tree.test.cjs`, `tests/integration/file-peek.test.cjs`, `tests/integration/image-peek.test.cjs`, `tests/e2e-live/changes-ui.e2e.mjs`. The changes e2e includes a bare-name citation to an unchanged nested file.
- Help: `docs/guide/work-in-a-workspace.md`, `docs/guide/understand-a-codebase.md`, `docs/guide/chat-with-an-agent.md`, `docs/guide/the-cockpit.md`.

## Decisions and limits

- The tree is always visible in the navigator, not a tab.
- **All files** stays read-only; **View diff** is the only review action from it.
- Heavy folders are hidden; `.gitignore` parsing and ignored-file display are deferred.
- Whole-repo search is deferred. The filter covers loaded folders, and the footer says so.
- No editing, saving, git status, filesystem watching, symbol outlines, or second diff engine.
- A folder is capped at 400 entries; a text page at 400 lines; a preview read at 20,000 lines; an image at 10 MB.
- HTML previews never run scripts or load external assets. Source mode is always available.
