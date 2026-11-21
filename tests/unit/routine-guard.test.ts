// Tests the failure streak and the 15-minute gap rule. Cron parsing stays in the service.

import assert from "node:assert/strict";
import test from "node:test";
import {
  MIN_ROUTINE_INTERVAL_MS,
  intervalTooShort,
  isCountedRoutineFailure,
  nextRoutineFailures,
  routineFailureNotice,
} from "../../src/shared/routine-guard.ts";

test("a gap under 15 minutes is too short and an exact 15-minute gap is allowed", () => {
  assert.equal(intervalTooShort([]), false);
  assert.equal(intervalTooShort([MIN_ROUTINE_INTERVAL_MS]), false);
  assert.equal(intervalTooShort([MIN_ROUTINE_INTERVAL_MS - 1]), true);
  assert.equal(intervalTooShort([MIN_ROUTINE_INTERVAL_MS, MIN_ROUTINE_INTERVAL_MS - 1]), true);
});

test("only a real error counts toward the failure streak", () => {
  assert.equal(isCountedRoutineFailure("error: ticket API down"), true);
  assert.equal(isCountedRoutineFailure("error: interrupted"), false);
  assert.equal(isCountedRoutineFailure("stopped"), false);
  assert.equal(isCountedRoutineFailure("skipped: agent busy"), false);
  assert.equal(isCountedRoutineFailure("ok"), false);
  assert.equal(isCountedRoutineFailure("missed: app was closed"), false);
});

test("success resets the streak and the tenth counted error disables the routine", () => {
  assert.deepEqual(nextRoutineFailures("ok", 0, false), {
    count: 0,
    changed: false,
    disable: false,
    notice: null,
  });
  assert.deepEqual(nextRoutineFailures("ok", 4, false), {
    count: 0,
    changed: true,
    disable: false,
    notice: null,
  });
  assert.deepEqual(nextRoutineFailures("error: down", 0, false), {
    count: 1,
    changed: true,
    disable: false,
    notice: "first",
  });
  assert.deepEqual(nextRoutineFailures("error: down", 1, false), {
    count: 2,
    changed: true,
    disable: false,
    notice: null,
  });
  assert.deepEqual(nextRoutineFailures("error: down", 9, false), {
    count: 10,
    changed: true,
    disable: true,
    notice: "limit",
  });
  assert.deepEqual(nextRoutineFailures("skipped: agent busy", 4, false).count, 4);
  assert.deepEqual(nextRoutineFailures("stopped", 4, false).changed, false);
  assert.deepEqual(nextRoutineFailures("error: interrupted", 4, false).changed, false);
});

test("a manual error does not advance the streak and a manual success clears it", () => {
  assert.deepEqual(nextRoutineFailures("error: down", 2, true), {
    count: 2,
    changed: false,
    disable: false,
    notice: null,
  });
  assert.deepEqual(nextRoutineFailures("ok", 2, true).count, 0);
  assert.equal(nextRoutineFailures("ok", 2, true).changed, true);
});

test("failure notices name the first error and the pause", () => {
  assert.equal(
    routineFailureNotice("first", "ticket API down"),
    "Failed. ticket API down It stays scheduled until 10 failures in a row.",
  );
  assert.equal(
    routineFailureNotice("first", ""),
    "Failed. It stays scheduled until 10 failures in a row.",
  );
  assert.equal(routineFailureNotice("first", "x".repeat(400)).length < 220, true);
  assert.equal(
    routineFailureNotice("limit", "ignored"),
    "Paused after 10 failures in a row. Enable it to try again.",
  );
});
