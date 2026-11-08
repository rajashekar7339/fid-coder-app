# Building a feature in Fid Coder

This is the working agreement for changes in this repo. It records how the Skills redesign, the date labels, the Enhance Prompt feature, and the command-draft fix were built. Read it with `AGENTS.md`; that file owns the folder map and the layering rules.

## The loop

1. **Read first.** Read the code you will touch, the existing tests, `AGENTS.md`, and any handoff note in `temp/`. Check `git status` before editing. If a file changed on disk since you last read it, read it again and treat the current content as deliberate; do not revert unrelated work. Do not infer behavior from the feature name.
2. **Review when asked.** If the user asks for a review, plan, or ideas, give advantages, drawbacks, risks, and a simplification plan. Stop there if they say they will review. Do not implement until they say to proceed.
3. **Simplify before adding.** Reuse existing state, components, IPC, and tests. Prefer one button, one status line, and one undo over a panel. Remove dead code and duplicate paths.
4. **Build the whole slice.** A feature normally touches shared rules, the main process, IPC/preload, the renderer, agent/tool behavior, the help guide, and tests. Do not stop at the backend.
5. **Verify.** Run typecheck, the unit/integration suites, and the relevant e2e harness. Report exact pass counts and artifact paths. Say what you could not run.
6. **Document.** Add the help section and screenshot. Update `AGENTS.md` when the file map changes. Mark any `temp/` handoff note as implemented.
7. **Report.** State what changed, what it does, what is tested, and what is deliberately not automatic.

## Working with the project owner

- The owner usually asks for **review first**, then **proceed**. Respect that gate.
- The owner values **explicit user action** over hidden automation, especially for model calls and skill loading.
- The owner values **token and quota discipline**. Prefer a compact pointer, a cheap model, a hard cap, and an on-demand load over a standing catalog.
- The owner prefers a **small, clean UI**: one clear action, no search/filter/settings unless the task needs them.
- The owner expects **the whole feature**: backend, UI, agent behavior, help docs, screenshots, and tests.
- When giving ideas, give a short list with trade-offs and a recommendation. Do not silently pick an option that changes token cost or behavior.
- Do not add a feature the owner did not ask for. If you spot an improvement, mention it separately.
- Preserve user work: do not clear a draft, send a message, or overwrite a transformed draft without an explicit action and an undo.
- Report honestly: a skipped or blocked test is not a pass.

## Non-negotiables

- **Explicit over automatic.** Skills start with `/skills <id> <task>`; Enhance only runs from its button; a project map is built only from **Build map** or **Refresh map**. The one approved exception is skill reuse: after an explicit first use, later turns get a compact used-skills list and the agent may call `use_skill` when it judges the message needs it. Do not add a full catalog, auto-send, or any other hidden model call.
- **No new hidden model calls.** A feature model call needs an explicit trigger (a user turn or a button), a timeout, a size cap, and a clear cost story. Do not put a skill catalog or full skill bodies in every prompt.
- **No hidden writes.** A side utility should not write SQLite, create a chat turn, or emit chat events unless that is its job.
- **User control.** Transformative actions get an **Undo**. Commands that open dialogs must not throw away a normal draft.
- **Least privilege.** Tool access is scoped. Ask mode is enforced by the registered tools, not only by prompt text. Read-only skill resources stay inside the skill folder. Throwaway sessions get no tools.
- **File as source of truth.** Default versions and skill metadata live in `SKILL.md`, not hardcoded in application code.
- **Small and matching.** Match the surrounding code, keep the CSS sections in order, and do not add a dependency for a small UI action.

## Layer checklist

| Concern | Where | Rule |
|---|---|---|
| Pure rules, types, prompt text | `src/shared/` | No Electron or React. Unit-testable. |
| Discovery, DB, LLM calls, IPC handlers | `src/main/` | Caps, timeouts, skip rules, path checks. No React. |
| Tool behavior | `src/tools/` | Put the capability in `ToolContext`; scope paths; read-only where possible. |
| Bridge | `src/preload/`, `channels.ts`, `api.ts` | Copy channel names into preload by hand. Do not import between preload files. |
| UI | `src/renderer/` | Reuse existing components and CSS patterns. Keep it simple and accessible. |
| Help | `docs/guide/` and `guide.ts` | Add a section and screenshot for user-visible behavior. |
| Tests | `tests/unit`, `tests/integration`, `tests/e2e-live` | Pure rules first, then wiring, then the real user path. |
| Handoff note | `temp/` | If a note exists, keep its contract current and mark the status. |

## Review format

Use this order when the owner asks for a review:

1. **What I reviewed** — backend, UI, tests, handoff note.
2. **Advantages** — what is good and why.
3. **Drawbacks and risks** — product, cost, security, race conditions, UX.
4. **Code-level findings** — actual bugs or stale paths, with file references.
5. **Simplification** — what to remove or reuse; do not rewrite for its own sake.
6. **UI plan** — the smallest interaction that solves the task.
7. **Docs and test plan** — what a user will read and what proves it works.
8. **Recommendation** — proceed or change course.

If the owner says “then I will review those,” stop after the review. If they say “proceed,” build the whole slice.

## UI rules

- Prefer one action over a group of controls. Put it next to the existing control it complements.
- Disable an action when it cannot run; define the exact conditions (not signed in, empty draft, agent running, call in flight).
- While a call runs: show a clear busy label, keep the user's draft visible, and block duplicate actions.
- Make the draft **read-only** while a rewrite is in progress. Guard `send()` and the form submit, not only the Send button.
- Show a skip reason inline as a quiet status, not as a red error.
- Show errors with `errorText(caught)` and leave the draft untouched.
- Give a one-step **Undo** for a rewrite. Clear the undo when the user edits, sends, or switches agents.
- Preserve a normal draft when a dialog command such as `/help` or `/skills` is selected.
- Selecting a skill should keep the current message as the task: `hello` + skill `write-lean` becomes `/skills write-lean hello`. If the draft already has a `/skills` prefix, replace the skill and keep its task.
- A starter prompt fills the composer and focuses it; it does not send.
- A cached project map renders without a model call. A missing or stale map offers an explicit build or refresh action.
- Cite evidence as `path:line`; the citation opens a read-only preview with the line highlighted.
- Large diagrams get a full-screen view with zoom; keep the inline view usable.
- Use accessible names, `role="status"` for changing status text, and keep interactive buttons outside the live region.
- Date and time labels: use the existing `createdAt`/`lastActivityAt` data. Prefer `Today` / `Yesterday` / a real date, and put the full timestamp in a tooltip.
- For long threads, use a visible, sticky day divider instead of repeating a full date on every message.

## Agent and token rules

- **Skills:** global, not per-agent. A skill is invoked explicitly with `/skills <id> <task>`. Store the used id per agent. Later turns get only a compact id/name/description list; the agent calls `use_skill` when it decides the skill is needed. The body is not kept in the system prompt. Supporting files are read with `skill_read`, scoped to the skill folder.
- **Skill versions:** read `version` from `SKILL.md`. Do not add a code fallback such as `1.0.0`.
- **Enhance:** manual and one-shot. One button click, one model call. Use a throwaway session with no tools, a cheap model when available, a timeout, and input/output caps. Write nothing to SQLite and never auto-send. Skip composer commands and a running agent; reject a chat send while a rewrite is in flight.
- **Ask mode:** store `readOnly` on the agent, but decide the tools from it at session build time. `askTools(profile)` filters the agent's normal tool set, so one read-only name set covers workspace and Browser & Jira agents. Never rely on prompt-only restrictions. Switching modes may drop the live session; replaying the conversation is expected.
- **Project map:** explicit build, one read-only exploration, cached by workspace and git key. Opening the dialog or reading a saved map must not call a model. Mark stale maps; do not inject the map into every turn.
- **Model calls:** a throwaway session still spends quota. Document it. Do not add a standing model call to a normal turn without asking.

## Testing

Run the smallest set that proves the change, then the relevant end-to-end path.

| Level | Command | Use it for |
|---|---|---|
| Types | `npm run typecheck` | Every change. |
| Unit | `npm test` (unit part) | Pure rules, parsing, formatting, prompt text. |
| Integration | `npm test` (integration part) | DB, main-process wiring, tools, IPC-adjacent logic. Mock Copilot. |
| Deterministic UI | `npm run test:skills` | Electron UI, Ask mode, starters, cached project map, citations, full-screen diagrams, library, reader, help screenshots. No Copilot turn. |
| Live UI | `npm run test:skills-reuse` | A real skill turn and reuse on a later turn. Needs Copilot. |
| Live UI | `npm run test:map` | One real project-map build, read-only workspace check, and cached reopen. Needs Copilot. |
| Live UI | `npm run test:enhance` | One real rewrite, Undo, skips, and no-send checks. Needs Copilot. |
| Live UI | `npm run test:features` | Changes/revert, workspace rules, context inspector. Needs Copilot. |

Rules:

- Add a **unit** test for each new pure rule, including skips and caps.
- Add an **integration** test for runnable main-process behavior. Mock the Copilot session; do not spend quota to test a skip.
- Add a **live e2e** only when the real model behavior is the thing being verified. Keep the prompt deterministic and the assertions on observable behavior.
- Add a **deterministic e2e** for UI state, disabled states, undo, draft preservation, and help images.
- Put live tests behind their own npm scripts. They need Copilot and spend quota.
- Use a temporary `FID_CODER_USER_DATA`; never touch the real profile. Set `FID_CLEAN=1` to delete artifacts.
- If a suite is blocked by account state (for example, no selectable models), report it as blocked, not passed.
- After a behavior change, update the test that encoded the old behavior. Do not leave a stale test name.

### Screenshots

- Add a real image under `docs/guide/images/`.
- Import it explicitly in `src/renderer/lib/guide.ts` and add it to `EXPLICIT_IMAGES`; `import.meta.glob` can be stale for a new file.
- The image file must exist before the import is used, or Vite fails to load the app.
- Extend `scripts/generate-guide-screenshots.mjs` so the image can be regenerated.
- Inspect the generated image. Revert unrelated images that the script rewrites.
- For a full-thread capture, scroll the thread to the top and keep the sticky day label from covering the first message.

## Docs

Every user-visible feature gets:

- a short section in the right `docs/guide/*.md` article;
- a screenshot when the UI matters;
- a clear statement of what triggers it, what it costs, and what it will not do;
- the limits and skip reasons;
- a link or mention in `AGENTS.md` if a new file or module is introduced;
- a row in the README script table when a new npm script is added.

Keep the guide practical: what the user does, what happens, and how to undo or recover. Avoid implementation jargon in the user guide; use tool names only where they appear in the UI or tool steps.

## Definition of done

- [ ] The behavior matches the explicit request; no hidden automation.
- [ ] Shared, main, tool, bridge, and renderer changes live in their owners.
- [ ] User draft/state is preserved or undoable.
- [ ] `npm run typecheck` passes.
- [ ] Unit and integration tests cover the new rules and wiring.
- [ ] The relevant live or deterministic e2e passes; blocked tests are reported.
- [ ] The help guide has a section and screenshot where the UI changed.
- [ ] `AGENTS.md` reflects any new file or module.
- [ ] Any `temp/` handoff note is marked implemented.
- [ ] No unrelated files or screenshots are changed.
- [ ] The final report names the files, the test counts, the artifacts, and anything not tested.

## Examples from this repo

- **Skills:** removed per-agent assignment; made skills global; explicit `/skills <id> <task>`; a library with upload, read, versions, and Use; a compact used-skills list; on-demand `use_skill`; scoped `skill_read`; no catalog in every prompt.
- **Dates:** reused `createdAt` and `lastActivityAt`; visible day dividers; sidebar day labels; full timestamps in tooltips. No schema change.
- **Enhance Prompt:** backend handoff → review → simplification (send guard, last-four query) → UI (one button, read-only composer, inline status, Undo) → help docs/screenshot → unit, integration, and live e2e.
- **Command draft bug:** reproduced the flow before changing code; found that selecting a dialog command cleared the draft; fixed the smallest cause and added two regression checks.
- **Skill selection:** kept the typed message as the task instead of replacing it with `/skills <id> `; replacing an existing skill keeps its task. Added regression checks for both cases.
- **Ask mode and architecture review:** added a read-only tool set, a composer switch, starter prompts, a cached project map, path:line file previews, full-screen diagrams, and the architecture-review skill. Deterministic e2e covers the cached map, citation preview, and diagram overlay; integration tests cover the tool boundary and map builder; the live `test:map` builds a real map and checks that the workspace is unchanged.
