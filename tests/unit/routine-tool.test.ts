// Tests how agent tool arguments become a scheduled routine.

import assert from "node:assert/strict";
import test from "node:test";
import {
  ROUTINE_COMMAND_HINT,
  buildRoutineDraft,
  localDateTimeIso,
  routineCreatedText,
  routineListText,
} from "../../src/shared/routine-schedule.ts";
import type { Routine } from "../../src/shared/types.ts";

const NOW = new Date(2026, 10, 11, 12, 0, 0);

function routine(overrides: Partial<Routine> = {}): Routine {
  return {
    id: "routine-1",
    agentId: "agent-1",
    name: "Run tests",
    prompt: "Run the tests and report the failures.",
    cron: "0 16 * * *",
    once: false,
    runAt: null,
    enabled: true,
    notify: true,
    lastRunAt: null,
    nextRunAt: localDateTimeIso("2026-11-11", "16:00"),
    lastStatus: null,
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

test("a bare time becomes one one-time run at the next occurrence", () => {
  const draft = buildRoutineDraft({ instruction: "Run the tests", time: "16:00" }, NOW);
  assert.equal(draft.once, true);
  assert.equal(draft.runAt, localDateTimeIso("2026-11-11", "16:00"));
  assert.equal(draft.cron, "0 16 11 11 *");
  assert.equal(draft.name, "Run the tests");
  assert.equal(draft.notify, true);
});

test("a past time without a date moves to tomorrow", () => {
  const now = new Date(2026, 10, 11, 17, 0, 0);
  const draft = buildRoutineDraft({ instruction: "Standup reminder", time: "16:00" }, now);
  assert.equal(draft.runAt, localDateTimeIso("2026-11-12", "16:00"));
});

test("an explicit past date is rejected", () => {
  assert.throws(
    () => buildRoutineDraft({ instruction: "Too late", time: "10:00", date: "2026-11-11" }, NOW),
    /already passed/,
  );
  assert.throws(
    () => buildRoutineDraft({ instruction: "Bad date", time: "16:00", date: "2026-02-30" }, NOW),
    /real local date/,
  );
});

test("repeating schedules use the shared cron conversion", () => {
  const daily = buildRoutineDraft({ instruction: "Check tickets", frequency: "daily", time: "09:00" }, NOW);
  assert.equal(daily.once, false);
  assert.equal(daily.cron, "0 9 * * *");
  assert.equal(daily.runAt, null);

  const weekdays = buildRoutineDraft(
    { instruction: "Check tickets", frequency: "weekdays", time: "09:00" },
    NOW,
  );
  assert.equal(weekdays.cron, "0 9 * * 1-5");

  const weekly = buildRoutineDraft(
    { instruction: "Weekly report", frequency: "weekly", time: "16:00", weekday: "5" },
    NOW,
  );
  assert.equal(weekly.cron, "0 16 * * 5");

  assert.throws(
    () => buildRoutineDraft({ instruction: "Weekly report", frequency: "weekly", time: "16:00", weekday: "9" }, NOW),
    /weekday/,
  );
});

test("custom cron needs an expression and skips the time fields", () => {
  const custom = buildRoutineDraft(
    { instruction: "Nightly sweep", frequency: "custom", cron: "0 2 * * *" },
    NOW,
  );
  assert.equal(custom.cron, "0 2 * * *");
  assert.equal(custom.once, false);
  assert.throws(
    () => buildRoutineDraft({ instruction: "Nightly sweep", frequency: "custom" }, NOW),
    /cron expression/,
  );
});

test("derives a short name, honors notification settings, and caps the prompt", () => {
  const draft = buildRoutineDraft(
    { instruction: "**Run `mvn clean install`** and report the result.", time: "16:00", notify: false },
    NOW,
  );
  assert.equal(draft.name, "Run mvn clean install and report the result.");
  assert.equal(draft.notify, false);
  assert.throws(
    () => buildRoutineDraft({ instruction: "x".repeat(4_001), time: "16:00" }, NOW),
    /longer than/,
  );
});

test("the routine command tells the agent to create, not run, the task", () => {
  assert.match(ROUTINE_COMMAND_HINT, /\/routine/);
  assert.match(ROUTINE_COMMAND_HINT, /routine_create/);
  assert.match(ROUTINE_COMMAND_HINT, /Do not perform the task now/);
  assert.match(ROUTINE_COMMAND_HINT, /ask when to run it/);
});

test("the created and listed text carries the schedule, id, and instruction", () => {
  const created = routineCreatedText(routine(), NOW);
  assert.match(created, /Created routine "Run tests"/);
  assert.match(created, /routine-1/);
  assert.match(created, /Next run: Today, 4:00/);
  assert.match(created, /Run the tests/);

  const list = routineListText([routine()], NOW);
  assert.match(list, /Routines \(1\)/);
  assert.match(list, /id routine-1/);
  assert.match(list, /Instruction: Run the tests/);
  assert.match(list, /next Today, 4:00/);
});
