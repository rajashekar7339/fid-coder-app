# Future enhancements

Features that were removed or deferred. Revisit only when the underlying problem is worth another attempt.

## Agent plan status

**Status:** Removed on 31 October 2026. Revisit later.
**Previous pieces:** `set_plan` tool, plan strip under the chat, `plans` table, `plan` chat event, and `plans:get` IPC channel.

### What it did

The agent could call `set_plan` with an ordered list of steps and mark each one `pending`, `in_progress`, or `done`. A plan strip above the composer showed the current step and progress. The latest plan was saved per agent in SQLite and restored on reload.

### Why it was removed

- Whether a plan appeared depended on the model choosing to call `set_plan`. Some turns used it, others ignored it, so the strip was inconsistent.
- The saved plan was scoped to the agent, not the turn. An old plan stayed visible on later messages that had nothing to do with it.
- The collapsed tool card already shows the running step and the tools the agent used. That is enough to follow the work, and it is host-generated rather than model-generated.

### If we revisit it

- Make progress host-driven: derive steps from tool start and end events, or from a plan the host builds after reading the first user message. Do not rely on the model calling a plan tool.
- Scope progress to one turn. Clear it when the turn ends and never show a previous turn's plan.
- Keep the tool card as the source of truth and treat the plan strip as an optional summary.
- Store only the current turn's steps, or store the turn id with the steps and load the plan by turn.
- Cover the behavior with a live test that sends two unrelated messages and checks that the second turn does not show the first turn's steps.

### What to restore

- `src/tools/plan.ts` and the `planTools` entries in `src/tools/registry.ts`
- `PlanStep`, `PlanStepStatus`, and `PlanView` in `src/shared/types.ts`
- the `plan` variant on `ChatEvent`
- `plans:get` in `src/shared/channels.ts`, the preload API, and `src/main/ipc/index.ts`
- the `plans` table and its read/write methods in `src/main/db/index.ts`
- `PlanStrip.tsx` and the `.plan-strip` styles
- the `onPlan` hook in `ToolContext` and the wiring in `Runner`
