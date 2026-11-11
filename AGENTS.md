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
    ipc/index.ts
    copilot/index.ts
    db/index.ts
    chat/runner.ts, enhance.ts
    browser/browser-manager.ts
    history/        history.ts
    skills/         index.ts, install.ts
    routines/       scheduler.ts, cron.ts, notify.ts
    workspace/      checkpoints.ts, explore-session.ts, review-session.ts, workspace-brief.ts, workspace-rules.ts,
                    architecture-map.ts, file-peek.ts
  preload/
    index.ts
  renderer/
    App.tsx
    main.tsx
    styles/index.css
    components/
      chat/         ChatView, MessageContent, ProjectMapDialog, EditedFilesCard
      approvals/    ApprovalCard, ApprovalHistoryDialog
      agents/       AgentDialog, AgentAvatar
      sidebar/      Sidebar
      settings/     SettingsDialog
      desk/         AgentDesk, ContextDialog, ChangesPanel, DiffView
      routines/     RoutinesDialog
      skills/       SkillsDialog
      help/         HelpDialog, GuideContent
      ui/           Modal, Switch, ConfirmDialog, BrandMark, UsageBar, ModelSelect
    lib/            fid, format, guide, markdown, schedule, highlight
  shared/           types, channels, api, skills, enhance-prompt, commands, starters, citations, and other pure helpers
  tools/
    registry.ts     args.ts, process.ts, types.ts, workspace.ts
    browser/browser.ts
    files/files.ts
    git/git.ts
    jira/           jira.ts, jira-format.ts
    history/        history.ts
    shell/          shell.ts, shell-policy.ts
    explore/        explore.ts, explore-code.ts
    review/         review.ts
    skills/         skills.ts (read-only bundled skill files)
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
| Enhancing a draft | `src/shared/enhance-prompt.ts`, `src/main/chat/enhance.ts`, and `Runner.enhanceDraft` |
| Ask mode and read-only tools | `readOnly` on the agent, `askTools` in `src/tools/registry.ts`, and `askMode` in `src/main/chat/runner.ts` |
| The project map | `src/main/workspace/architecture-map.ts`, `workspace_maps` in SQLite, and `ProjectMapDialog.tsx` |
| Workspace changes | `src/main/workspace/checkpoints.ts`, `changes:list`, `ChangesPanel.tsx`, `EditedFilesCard.tsx`, and `src/shared/change-tree.ts` |
| Path:line citations and the in-place code view | `src/shared/citations.ts`, `src/renderer/lib/inline-markdown.tsx`, and `ChangesPanel.tsx` |
| Starter prompts | `src/shared/starters.ts` and the empty state in `ChatView.tsx` |
| The Skills library | `src/renderer/components/skills/SkillsDialog.tsx` |
| A composer command | `src/shared/commands.ts` and the menu in `src/renderer/components/chat/ChatView.tsx` |
| A read-only review | `src/tools/review/review.ts` and `src/main/workspace/review-session.ts` |
| A Copilot tool | `src/tools/<area>/<file>.ts` |
| Rows in SQLite | `src/main/db/index.ts` |
| An IPC handler | `src/main/ipc/index.ts` |
| The preload method | the existing list in `src/preload/index.ts` |
| A screen | `src/renderer/components/<screen>` |
| Its CSS | a section in `src/renderer/styles/index.css` |

Skills are discovered from the workspace `.skills`, `.github/skills`, `.agents/skills`, and `.claude/skills`, the app data `skills/` folder, `~/.copilot/skills`, `~/.agents/skills`, and built-in `skills/`. The first copy of an id wins. A skill is invoked with `/skills <id> <task>`; uploads go to the app data `skills/` folder. `skills/<id>/SKILL.md` needs `name` and `description` frontmatter; `version` is optional and shown in the Skills library. Used skill ids are stored per agent. The agent can call `list_skills` to see installed skills and `use_skill` to load one when a message needs the instructions, so the body is not kept in the system prompt. Later turns also get a compact used-skills list. Supporting files stay beside `SKILL.md`; the read-only `skill_read` tool is scoped to that skill's folder, and later turns pass the skill id.

Enhance is manual and one-shot. The renderer calls `chat.enhance` only from the Enhance button; it writes nothing to SQLite, opens no agent session, and never sends. Do not call it from `send`, `runTurn`, or a routine path.

Ask mode is a tool boundary, not a prompt preference. `readOnly` filters the agent's normal profile through `askTools(profile)`: workspace agents keep reads, search, git/PR reads, history, and the read-only explorer; Browser & Jira agents keep Jira reads, browser navigate/snapshot, and history. Neither gets write, shell, click, or type tools. The project map is built only after the user chooses **Build map** or **Refresh map**; opening a saved map or the dialog never calls a model. The map is cached by workspace in `workspace_maps` and marked stale when the git key changes. Do not generate it on agent creation or on a normal turn.

Citations keep their line range. Clicking one opens the Changes panel at that file. If the file belongs to a recorded turn, the panel shows its diff with the cited lines marked. If it has no recorded change, the panel shows the current file read-only with syntax highlighting and the cited range marked. The panel's **References** tab lists every citation in the answer, so one cited file or range can follow another without a separate reader. Use component names, not file names or `path:line` references, in Mermaid node labels; put the evidence in the prose and numbered steps. The renderer strips `path:line` citations from diagram labels before drawing, so existing messages and cached maps stay clean. Prefer flowcharts for architecture, control flow, and data flow; use `sequenceDiagram` only when ordering between actors over time is the point. Keep a diagram to about 12 nodes.

Workspace changes come from file tools only. The chat card and `ChangesPanel` share the `changes:list` summaries; fetch one selected file with `changes.diff`, never every file. The card belongs to the last assistant message of a turn. A citation path selects the newest recorded change for that file and passes its range to `DiffView`; a file without a change uses the panel's read-only code view. Shell changes are not recorded, and Undo uses the selected turn.

Import a tool by its file name, for example `./browser/browser`. TypeScript resolves `./db` to `db/index.ts`. It does not resolve `./browser` to `browser/browser.ts`.

`src/main/db/index.ts`, `src/main/copilot/index.ts`, and `src/main/ipc/index.ts` are one module each. `src/renderer/styles/index.css` is one sheet, and `@import "tailwindcss"` stays its first line. Add new code in that file. Split one of those files only while you are already editing it, and keep the CSS sections in their current order.

`tests/unit/*.test.ts` imports from `src` keep the `.ts` suffix. Node runs those files as ESM. Leave `package.json` without `"type": "module"`. Tests in `tests/integration/` load `dist/` and run after `npm run build:node`.

`npm test` runs the unit and integration suites. The Electron harnesses have separate scripts: `npm run test:changes`, `npm run test:features`, `npm run test:skills`, `npm run test:skills-reuse`, `npm run test:map`, and `npm run test:enhance`. The live ones need Copilot and spend quota; `test:changes` is deterministic. See `CONTRIBUTING.md` for the test levels.

A feature is a tool file, a main handler, and a screen, in those three places. Keep Electron and React out of one shared feature folder.

## Product constraints

- GitHub Copilot is the only model backend. No Docker and no remote browser.
- Tools stay rooted in the agent workspace. Copilot does not write the disk except through registered tools.
- Browser tools use the local headed browser and one profile per agent.
- Keep changes small and match the surrounding code.
