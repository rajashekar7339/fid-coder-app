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
- Opening a file makes it the active context for the next message; the last file visited wins. In source mode, click a line number, shift-click, or drag down the gutter to make the active context a range instead of the whole file. Escape clears the selection, and the active chip's **×** clears the file. The active chip is automatically included with the next send.
- Press **Ctrl+Shift+L** (or the chip's pin action) to pin the active file or range. Pin several files or ranges while browsing; pinned chips stay in the composer until they are sent or removed.
- The composer paperclip attaches local files. A text or code upload is copied to `.fid/uploads/` so the agent's file tools can read it; a supported image is sent as an image attachment. A text upload needs an agent with file tools; a Browser & Jira agent can still receive a supported image. Both sources share the same send path.

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

## Composer attachments

```ts
export type MessageAttachment = {
  kind: "selection" | "workspace" | "upload";
  path: string; // relative for workspace kinds, absolute for an upload
  name: string;
  startLine?: number;
  endLine?: number;
};

chat.send(agentId, text, attachments): Promise<void>;
dialog.pickFiles(): Promise<{ attachments: MessageAttachment[]; errors: string[] }>;
```

- `src/shared/attachments.ts` owns labels, dedupe, line-range normalization, and stored JSON parsing.
- `src/main/workspace/attachments.ts` validates selection ranges, stats workspace files, reads the exact selection lines, and follows Code Puppy's split: supported images up to 10 MB become binary attachments; text, code, binary, and other images are copied or passed as paths; workspace files and copied uploads are passed to the agent as paths. A text attachment without file tools is rejected with a clear error.
- Uploads come from the native picker in main. `FID_CODER_ATTACH_IMPORT_FILES` (`path.delimiter` separated) replaces the dialog in tests.
- The runner prepends `Attached files:` to the user prompt with the copied upload path, the workspace reference path, or the selected range. It stores the descriptors in `messages.attachments` as JSON; the file body is never stored in the database. The agent decides how to read the file with its normal tools; no attachment-specific tool rules are added.
- Limits: 10 MB per supported image and 200,000 characters per selection. Text and code files are passed by workspace path, so their size is not capped. Images larger than 10 MB or in another format are passed as files when the agent has file tools.
- Images keep their detected `image/*` MIME type and are sent as binary attachments. Text uploads are copied under `.fid/uploads/<id>/` and referenced by that workspace-relative path. The stored descriptor keeps the path, name, and line range, never the file body.

## Files

- `src/main/workspace/file-tree.ts`, `src/main/workspace/file-peek.ts`, `src/main/workspace/image-peek.ts`, `src/main/workspace/resolve-file.ts`: safe listing, path resolution, paging, image preview.
- `src/shared/file-tree.ts`, `src/shared/image.ts`, `src/shared/preview.ts`, `src/shared/types.ts`: path tree, image type map, preview routing and CSP, shared types.
- `src/shared/channels.ts`, `src/shared/api.ts`, `src/preload/index.ts`, `src/main/ipc/index.ts`: `workspace:list`, `workspace:image-read`, and the paging arguments.
- `src/renderer/components/desk/ChangesPanel.tsx`: panel state, request and citation selection, diff, revert.
- `src/renderer/components/desk/WorkspaceNavigator.tsx`: References, Changed, All files, filtering, and the tree.
- `src/renderer/components/desk/WorkspaceCodePane.tsx`: read-only code, paging, gutter selection, references, Markdown/HTML previews, and image preview.
- `src/renderer/styles/index.css`: navigator, tree, preview, image, composer chips, and collapse rules.
- `src/renderer/components/chat/ChatView.tsx`, `src/shared/commands.ts`: the **Workspace** header button, `/files` command, paperclip, and composer chips.
- `src/shared/attachments.ts`, `src/main/workspace/attachments.ts`, `src/main/db/index.ts`, `src/main/chat/runner.ts`: attachment rules, SDK shape, storage, and send.
- `src/renderer/components/desk/AgentDesk.tsx`: the Workspace section's **Browse files** action.
- Tests: `tests/unit/file-tree.test.ts`, `tests/unit/image.test.ts`, `tests/unit/preview.test.ts`, `tests/unit/changes.test.ts`, `tests/unit/commands.test.ts`, `tests/unit/attachments.test.ts`, `tests/integration/file-tree.test.cjs`, `tests/integration/file-peek.test.cjs`, `tests/integration/image-peek.test.cjs`, `tests/integration/attachments.test.cjs`, `tests/e2e-live/changes-ui.e2e.mjs`. The changes e2e includes a bare-name citation to an unchanged nested file and the composer attachment checks.
- Help: `docs/guide/work-in-a-workspace.md`, `docs/guide/understand-a-codebase.md`, `docs/guide/chat-with-an-agent.md`, `docs/guide/the-cockpit.md`.

## Decisions and limits

- The tree is always visible in the navigator, not a tab.
- **All files** stays read-only; **View diff** is the only review action from it.
- Heavy folders are hidden; `.gitignore` parsing and ignored-file display are deferred.
- Whole-repo search is deferred. The filter covers loaded folders, and the footer says so.
- No editing, saving, git status, filesystem watching, symbol outlines, or second diff engine.
- A folder is capped at 400 entries; a text page at 400 lines; a preview read at 20,000 lines; an image at 10 MB.
- HTML previews never run scripts or load external assets. Source mode is always available.
- Text uploads are copied into `.fid/uploads/` and stay there for later turns; `.fid/uploads/.gitignore` keeps them out of git status. Images are sent as attachments. A cleanup/retention policy is deferred.
- A vision model is required for image attachments; the runtime decides whether the chosen model accepts them.
