# Fid Coder agent instructions

The app stays at the repository root. Do not put it back under `app/`.

Electron compiles three programs. Put each change in the process that owns it.

- `src/main` and `src/tools` are the Node process.
- `src/preload/index.ts` is one sandboxed file. It cannot import its neighbors. Channel names are copied into that file by hand.
- `src/renderer` is the Vite window.
- `src/shared` is the contract those sides share.
- `reference_projects/` is local reference material. Do not import it or rearrange it.

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
    chat/runner.ts
    browser/browser-manager.ts
    routines/       scheduler.ts, cron.ts, notify.ts
    workspace/      checkpoints.ts, explore-session.ts, workspace-brief.ts, workspace-rules.ts
  preload/
    index.ts
  renderer/
    App.tsx
    main.tsx
    styles/index.css
    components/
      chat/         ChatView, MessageContent, PlanStrip
      agents/       AgentDialog, AgentAvatar
      sidebar/      Sidebar
      settings/     SettingsDialog
      desk/         AgentDesk, ContextDialog, DiffView
      routines/     RoutinesDialog
      help/         HelpDialog, GuideContent
      ui/           Modal, Switch, ConfirmDialog, BrandMark, UsageBar, ModelSelect
    lib/            fid, format, guide, markdown, schedule, highlight
  shared/           types, channels, api, and other pure helpers
  tools/
    registry.ts     args.ts, process.ts, types.ts, workspace.ts, plan.ts
    browser/browser.ts
    files/files.ts
    git/git.ts
    jira/           jira.ts, jira-format.ts
    shell/          shell.ts, shell-policy.ts
    explore/        explore.ts, explore-code.ts
tests/
  unit/              source-level .test.ts files
  integration/       .test.cjs and .test.mjs files against dist
  e2e-live/          Electron/Playwright .e2e.mjs harnesses and manual diagnostics
scripts/
  generate-guide-screenshots.mjs
docs/
  guide/            in-app help
  memory.md
  build-exe.md
```

| Piece | Where it goes |
|---|---|
| Types and channel names | `src/shared` |
| A Copilot tool | `src/tools/<area>/<file>.ts` |
| Rows in SQLite | `src/main/db/index.ts` |
| An IPC handler | `src/main/ipc/index.ts` |
| The preload method | the existing list in `src/preload/index.ts` |
| A screen | `src/renderer/components/<screen>` |
| Its CSS | a section in `src/renderer/styles/index.css` |

Import a tool by its file name, for example `./browser/browser`. TypeScript resolves `./db` to `db/index.ts`. It does not resolve `./browser` to `browser/browser.ts`.

`src/main/db/index.ts`, `src/main/copilot/index.ts`, and `src/main/ipc/index.ts` are one module each. `src/renderer/styles/index.css` is one sheet, and `@import "tailwindcss"` stays its first line. Add new code in that file. Split one of those files only while you are already editing it, and keep the CSS sections in their current order.

`tests/unit/*.test.ts` imports from `src` keep the `.ts` suffix. Node runs those files as ESM. Leave `package.json` without `"type": "module"`. Tests in `tests/integration/` load `dist/` and run after `npm run build:node`.

`npm test` runs the unit and integration suites. `npm run test:features` runs the live Electron harness.

A feature is a tool file, a main handler, and a screen, in those three places. Keep Electron and React out of one shared feature folder.

## Product constraints

- GitHub Copilot is the only model backend. No Docker and no remote browser.
- Tools stay rooted in the agent workspace. Copilot does not write the disk except through registered tools.
- Browser tools use the local headed browser and one profile per agent.
- Keep changes small and match the surrounding code.
