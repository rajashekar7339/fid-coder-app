# Fid Coder agent instructions

The app stays at the repository root. Do not put it back under `app/`.

Electron compiles three programs. Put each change in the process that owns it.

- `src/main` and `src/tools` are the Node process.
- `src/preload/index.ts` is one sandboxed file. It cannot import its neighbors. Channel names are copied into that file by hand.
- `src/renderer` is the Vite window.
- `src/shared` is the contract those sides share.
- `reference_projects/` is local reference material. Do not import it or rearrange it.

## Feature workflow

Read `CONTRIBUTING.md` before starting a feature. It is part of the contract.

- Read the code, tests, `AGENTS.md`, and any `temp/` handoff note first.
- When the user asks for a review or ideas, give advantages, drawbacks, risks, and a simplification plan. Do not implement until they say to proceed.
- Build the whole slice: shared rules, main handler, bridge, renderer, agent behavior, help docs, and tests.
- Keep the UI simple; preserve user drafts; give transformative actions an Undo.
- Run typecheck and the relevant unit/integration/e2e suites. Report exact results and artifacts; do not claim tests you did not run.

## Where new work goes

```text
src/
  main/
    index.ts
    paths.ts
    secrets.ts
    log.ts
    ipc/index.ts
    copilot/index.ts
    db/index.ts
    chat/runner.ts, enhance.ts
    browser/browser-manager.ts, gate.ts
    history/        history.ts
    skills/         index.ts, install.ts, save.ts
    routines/       scheduler.ts, cron.ts, notify.ts, service.ts
    workspace/      checkpoints.ts, explore-session.ts, review-session.ts, workspace-brief.ts, workspace-rules.ts,
                    architecture-map.ts, file-peek.ts, file-tree.ts
  preload/
    index.ts
  renderer/
    App.tsx
    main.tsx
    styles/index.css
    components/
      chat/         ChatView, MessageContent, ProjectMapDialog, EditedFilesCard
      approvals/    ApprovalCard, ApprovalHistoryDialog, QuestionCard, HandoffCard, SkillSaveCard, CardHeader
      agents/       AgentDialog, AgentAvatar
      sidebar/      Sidebar
      settings/     SettingsDialog
      desk/         AgentDesk, ContextDialog, ChangesPanel, DiffView, WorkspaceNavigator, WorkspaceCodePane
      routines/     RoutinesDialog
      skills/       SkillsDialog
      help/         HelpDialog, GuideContent
      ui/           Modal, Switch, ConfirmDialog, BrandMark, UsageBar, ModelSelect
    lib/            fid, format, guide, markdown, highlight, countdown
  shared/           types, channels, api, skills, enhance-prompt, commands, starters, citations, and other pure helpers
  tools/
    registry.ts     args.ts, process.ts, types.ts, workspace.ts
    browser/browser.ts
    files/files.ts
    git/git.ts
    jira/           jira.ts, jira-format.ts
    history/        history.ts
    shell/          shell.ts, shell-policy.ts
    ask/            ask.ts
    routines/       routines.ts
    explore/        explore.ts, explore-code.ts
    review/         review.ts
    skills/         skills.ts, save.ts
tests/
  unit/              source-level .test.ts files
  integration/       .test.cjs and .test.mjs files against dist
  e2e-live/          Electron/Playwright .e2e.mjs harnesses and manual diagnostics
scripts/
  generate-guide-screenshots.mjs
skills/             review-change/SKILL.md, architecture-review/SKILL.md, write-lean/SKILL.md
docs/
  guide/            in-app help
  feature-enhancements.md
  memory.md
  build-exe.md
```

| Piece | Where it goes |
|---|---|
| Types and channel names | `src/shared` |
| A built-in skill | `skills/<skill-id>/SKILL.md` |
| Skill parsing, matching, and prompt text | `src/shared/skills.ts` |
| Skill discovery and supporting files | `src/main/skills/index.ts` |
| Skill upload | `src/main/skills/install.ts` |
| The read-only skill file tool | `src/tools/skills/skills.ts` |
| Reusing a used skill | `agent_skills` in `src/main/db/index.ts`, `use_skill` in `src/tools/skills/skills.ts`, and `usedSkillsFor` in `src/main/chat/runner.ts` |
| Creating a routine from chat | `src/main/routines/service.ts`, `src/tools/routines/routines.ts`, and `RoutinePort` in `src/tools/types.ts` |
| Routine timing rules | `src/shared/routine-schedule.ts` |
| Jira diagnostics | `src/main/log.ts`, the Jira tool callbacks in `src/main/chat/runner.ts`, and Settings → Jira |
| Enhancing a draft | `src/shared/enhance-prompt.ts`, `src/main/chat/enhance.ts`, and `Runner.enhanceDraft` |
| Tools and Ask/Agent mode | `toolProfile` + `readOnly` on the agent, `askTools` in `src/tools/registry.ts`, `askMode` in `src/main/chat/runner.ts`, and the Tools/Mode fields in `AgentDialog.tsx` |
| The project map | `src/main/workspace/architecture-map.ts`, `workspace_maps` in SQLite, and `ProjectMapDialog.tsx` |
| Workspace changes | `src/main/workspace/checkpoints.ts`, `changes:list`, `ChangesPanel.tsx`, and `EditedFilesCard.tsx` |
| Workspace explorer | `src/main/workspace/file-tree.ts`, `workspace:list`, `src/shared/file-tree.ts`, and `WorkspaceNavigator.tsx` |
| Composer attachments | `src/shared/attachments.ts`, `src/main/workspace/attachments.ts`, `dialog:pick-files`, and the composer chips in `ChatView.tsx` |
| Path:line citations and the in-place code view | `src/shared/citations.ts`, `src/renderer/lib/inline-markdown.tsx`, and `WorkspaceCodePane.tsx` |
| Starter prompts | `src/shared/starters.ts` and the empty state in `ChatView.tsx` |
| The Skills library | `src/renderer/components/skills/SkillsDialog.tsx` |
| A composer command | `src/shared/commands.ts` and the menu in `src/renderer/components/chat/ChatView.tsx` |
| A question card | `src/shared/question.ts`, `ask_user` in `src/tools/ask/ask.ts`, `Runner.askUser`, and `QuestionCard.tsx` |
| Browser handoff | `src/shared/browser-handoff.ts`, `browser_needs_you` in `src/tools/browser/browser.ts`, `gateBrowser` in `src/main/browser/gate.ts`, the handoff methods on `Runner`, and `HandoffCard.tsx` |
| Save a skill from chat | `src/shared/skill-draft.ts`, `save_skill` in `src/tools/skills/save.ts`, `src/main/skills/save.ts`, and `SkillSaveCard.tsx` |
| Pin and archive | `pinned` and `archived` on the agent, `src/shared/agent-list.ts`, `agents:place`, and the sidebar menu |
| A read-only review | `src/tools/review/review.ts` and `src/main/workspace/review-session.ts` |
| A Copilot tool | `src/tools/<area>/<file>.ts` |
| Rows in SQLite | `src/main/db/index.ts` |
| An IPC handler | `src/main/ipc/index.ts` |
| The preload method | the existing list in `src/preload/index.ts` |
| A screen | `src/renderer/components/<screen>` |
| Its CSS | a section in `src/renderer/styles/index.css` |

Skills are discovered from the workspace `.skills`, `.github/skills`, `.agents/skills`, and `.claude/skills`, the app data `skills/` folder, `~/.copilot/skills`, `~/.agents/skills`, and built-in `skills/`. The first copy of an id wins. A skill is invoked with `/skills <id> <task>`; uploads go to the app data `skills/` folder. `skills/<id>/SKILL.md` needs `name` and `description` frontmatter; `version` is optional and shown in the Skills library. Used skill ids are stored per agent. The agent can call `list_skills` to see installed skills and `use_skill` to load one when a message needs the instructions, so the body is not kept in the system prompt. Later turns also get a compact used-skills list. Supporting files stay beside `SKILL.md`; the read-only `skill_read` tool is scoped to that skill's folder, and later turns pass the skill id.

Enhance is manual and one-shot. The renderer calls `chat.enhance` only from the Enhance button; it writes nothing to SQLite, opens no agent session, and never sends. Do not call it from `send`, `runTurn`, or a routine path.

Jira diagnostics append to `logs/fid-coder.log` under the app data folder. Log whether the site and token are present, the agent name, tool failures, and the relevant paths; never log the token. A missing site or token, or a failed Jira tool, writes a warning that explains the browser fallback. Keep the tool result in chat generic ("Jira is unavailable."); detailed causes belong only in the log.

The agent can manage this agent's routines with `routine_list` and `routine_delete`, but `routine_create` is exposed only during a `/routine` turn. The runner parses the command, rejects Ask mode, sets the latest message to the command arguments, gives the turn only `routine_create` plus a short routine hint, and restores the normal toolset afterwards. Normal chat turns cannot create routines. The tools use `ctx.agentId`, so one agent cannot see or change another agent's routines. The service caps each agent at 20 routines and rejects the same instruction and timing twice. A bare time creates a one-time routine; `RoutineDraft` validates local dates and times, and the scheduler arms a one-time job with a timer. A one-time routine is disabled before its run, and a run missed while Fid Coder was closed is marked missed and paused. Routine write tools are removed during a routine turn, so a routine cannot create or delete routines. Ask mode excludes all routine tools. The notification switch also covers an approval request or a question card during a routine turn.

`/compact` summarizes the current conversation on demand with the same Auto memory update used after 30 messages. It does not wait for ten new turns, and it runs when Automatic memory is off. The command takes no arguments, does not open the agent session, and drops the live session after a successful update or when the summary is already current, so the next message sends the summary and the recent window. An empty thread does not call the model. A failed summary leaves the previous summary and the live session in place.

Mode is the access control and Tools is the Agent-mode domain. **Ask mode ignores `toolProfile`** and registers `askTools()`, the full read-only set: file reads, search, git/PR reads, browser navigate/snapshot, Jira reads, history, the read-only explorer, `ask_user`, `browser_needs_you`, and `save_skill`. It never gets workspace writes, shell, click, or type tools. `save_skill` is the exception: Ask mode can propose one skill, and the Save card is the only write. It writes one `SKILL.md` in the app skills folder. `ask_user` is also on every Agent-mode profile. It asks one question with two to four choices. The card adds Other and Skip. A skip or a two-minute timeout returns no answer and the turn continues. Stop, a closed window, and the end of the turn dismiss it. The `/routine` create turn and the read-only review subagent do not get it. The card is not stored in SQLite. Copilot ships its own `ask_user`; `openSession` marks Fid's tool with `overridesBuiltInTool: true` so the card handles the call instead of the built-in's unregistered user-input hook. **Agent mode** registers `toolsForAgent(toolProfile)`. The editor shows Tools only in Agent mode; a new agent starts in Ask mode with no tool profile to pick, and switching to Agent mode requires one. Do not preselect All tools. The composer switch saves the same `readOnly` value. Instructions describe the role, never a permission rule. Instruction presets only fill the Instructions box; the Code reviewer, Implementer, Architecture reviewer, and Release notes presets name the bundled skill ids so the agent loads the detailed skill with `use_skill`. The project map is built only after the user chooses **Build map** or **Refresh map**; opening a saved map or the dialog never calls a model. The map is cached by workspace in `workspace_maps` and marked stale when the git key changes. Do not generate it on agent creation or on a normal turn.

The agent hands the headed browser back with `browser_needs_you` when a page needs a sign-in or a captcha. The Needs you card focuses the window, and browser tools stay blocked until Done. The next click, type, or navigation waits for a fresh `browser_snapshot`. A ten-minute timeout continues the turn and still requires that snapshot. Stop closes the card. The card is not stored. Ask mode and the Browser and All tools profiles get the tool. Developer Agent mode, routine runs, the `/routine` create turn, and the review subagent do not. `save_skill` writes one `SKILL.md` into the app skills folder only after the user chooses Save. The card shows editable name, when-to-use, and steps fields; correct anything that's off before Save. Don't save, a two-minute timeout, and Stop write nothing. Secrets, fenced scripts, and a built-in skill name are refused before the card. Replacing an installed skill overwrites `SKILL.md` only. Ask mode and every Agent profile can call it. `/skill-save` sends the same proposal request and reviews the whole task, not only the last message; it never writes without the card. A routine run, the `/routine` create turn, and the review subagent cannot.

Citations keep their line range. Clicking one opens the Workspace panel at that file. A citation may carry only a file name (`Test.java:123`). The reader resolves an exact workspace path first, then a unique path suffix (case-insensitive), and reports an ambiguity instead of guessing; `findChangedFile` uses the same suffix rule. If the file belongs to a recorded turn, the panel shows its diff with the cited lines marked. If it has no recorded change, the panel shows the current file read-only with syntax highlighting and the cited range marked. The navigator's **References** section lists every citation in the answer, **Changed** lists the selected turn's files, and **All files** is a lazy read-only tree of the workspace. A file opened from All files is read-only and offers **View diff** when the turn recorded a change. The chat header's **Workspace** button, the `/files` command, and the Agent Desk's **Browse files** action open the same panel even when no turn has changes. All three are hidden when the agent has no workspace folder. Opening a file or selecting lines makes it the active context for the next message; the last file visited wins, and an active chip appears in the composer. Ctrl+Shift+L or the chip's pin action pins it so several files and ranges can be collected before sending. The agent receives the paths or selected text and decides what to use. At wide widths, **Collapse chat** in the panel header hides the center column; **Show chat** and closing the panel restore it. Use component names, not file names or `path:line` references, in Mermaid node labels; put the evidence in the prose and numbered steps. The renderer strips `path:line` citations from diagram labels before drawing, so existing messages and cached maps stay clean. Prefer flowcharts for architecture, control flow, and data flow; use `sequenceDiagram` only when ordering between actors over time is the point. Keep a diagram to about 12 nodes.

Workspace changes come from file tools only. The chat card and `ChangesPanel` share the `changes:list` summaries; fetch one selected file with `changes.diff`, never every file. `workspace.file` and `workspace:image-read` go through `resolve-file.ts`, which searches skipped folders out and never guesses between two same-named files. The card belongs to the last assistant message of a turn. A citation path selects the newest recorded change for that file and passes its range to `DiffView`; a file without a change uses the panel's read-only code view. The All files tree uses `workspace:list` one directory at a time, skips symlinks and `SKIP_DIR_NAMES`, caps a folder at 400 entries, and marks files changed in the selected turn. Loaded folders reload when `changes:list` refreshes after a turn or revert. Browsing reads 400-line pages through `workspace.file`; citations still read their 160-line window. PNG, JPEG, GIF, WebP, BMP, ICO, and AVIF files open through `workspace:image-read` as read-only previews, capped at 10 MB. Markdown files open in a rendered preview with a **Preview / Source** toggle; HTML files open in a sandboxed preview that blocks scripts and external assets. Source mode always remains available. Shell changes are not recorded, and Undo uses the selected turn.

Composer attachments follow Code Puppy: only supported images go to the model as binary attachments; every other file is passed by path. Text and code uploads are copied to `.fid/uploads/<id>/` inside the workspace, workspace references keep their relative path, and line selections send the exact text. `runner.runTurn` puts a short `Attached files:` list with those workspace paths at the top of the prompt; the agent reads them with its own file tools. A text attachment needs an agent with file tools; a Browser & Jira agent can still receive a supported image. Do not add attachment-specific behavior rules or suppress tools. `src/shared/attachments.ts` owns labels, dedupe, range normalization, and stored parsing; `src/main/workspace/attachments.ts` sends supported images up to 10 MB as blobs, copies uploads, and resolves paths. Text, binary, and unsupported or oversized images are passed by path. The runner stores descriptors in `messages.attachments` as JSON, never the file body. Limits: 10 MB per supported image; 200,000 characters per selection. Use `FID_CODER_ATTACH_IMPORT_FILES` (`path.delimiter` separated) to bypass the native picker in tests.

Import a tool by its file name, for example `./browser/browser`. TypeScript resolves `./db` to `db/index.ts`. It does not resolve `./browser` to `browser/browser.ts`.

`src/main/db/index.ts`, `src/main/copilot/index.ts`, and `src/main/ipc/index.ts` are one module each. `src/renderer/styles/index.css` is one sheet, and `@import "tailwindcss"` stays its first line. Add new code in that file. Split one of those files only while you are already editing it, and keep the CSS sections in their current order.

`tests/unit/*.test.ts` imports from `src` keep the `.ts` suffix. Node runs those files as ESM. Leave `package.json` without `"type": "module"`. Tests in `tests/integration/` load `dist/` and run after `npm run build:node`.

The sidebar can pin and archive an agent. Pin sorts that agent first. Archive hides it under Archived and keeps the conversation, routines, and browser profile. Ctrl+K focuses the name search, Enter opens the first match, and the search includes archived agents. Editing an agent keeps both flags. Neither flag changes tool access.

`npm test` runs the unit and integration suites. The Electron harnesses have separate scripts: `npm run test:changes`, `npm run test:features`, `npm run test:modes`, `npm run test:skills`, `npm run test:skills-reuse`, `npm run test:map`, `npm run test:enhance`, `npm run test:questions`, `npm run test:questions-live`, `npm run test:sidebar`, `npm run test:handoff`, `npm run test:handoff-live`, `npm run test:save-skill-live`, `npm run test:skill-command-live`, `npm run test:routines`, and `npm run test:routines-live`. The live ones need Copilot and spend quota; `test:changes`, `test:questions`, `test:sidebar`, `test:handoff`, and `test:routines` are deterministic. `test:modes` runs two live turns: Agent mode edits a file, Ask mode must not. See `CONTRIBUTING.md` for the test levels.

A feature is a tool file, a main handler, and a screen, in those three places. Keep Electron and React out of one shared feature folder.

## Product constraints

- GitHub Copilot is the only model backend. No Docker and no remote browser.
- Tools stay rooted in the agent workspace. Copilot does not write the disk except through registered tools.
- Browser tools use the local headed browser and one profile per agent.
- Keep changes small and match the surrounding code.
