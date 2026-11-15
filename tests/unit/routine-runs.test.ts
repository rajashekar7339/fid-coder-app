// Tests run excerpts, due checks, status labels, and the inbox list.

import assert from "node:assert/strict";
import test from "node:test";
import { assertInboxAction, buildInbox, type StoredInboxRow } from "../../src/shared/inbox.ts";
import {
  isRoutineDue,
  pruneBeforeIso,
  routineStatusLabel,
  routineStatusTone,
  runDurationLabel,
  runExcerpt,
  snoozeUntilIso,
} from "../../src/shared/routine-runs.ts";
import type { ApprovalRequest } from "../../src/shared/types.ts";

const NOW = Date.parse("2026-11-15T12:00:00.000Z");

function approval(): ApprovalRequest {
  return {
    id: "ap-1",
    agentId: "agent-1",
    agentName: "Ada",
    turnId: "turn-1",
    kind: "shell",
    title: "Delete the build",
    command: "rm -rf dist",
    cwd: "D:\\work",
    reason: "Deletes a folder.",
    createdAt: "2026-11-15T11:00:00.000Z",
    expiresAt: "2026-11-15T11:02:00.000Z",
  };
}

function row(patch: Partial<StoredInboxRow> = {}): StoredInboxRow {
  return {
    id: "row-1",
    agentId: "agent-1",
    agentName: "Ada",
    kind: "routine",
    title: "Weekday sweep",
    body: "Completed.",
    createdAt: "2026-11-15T10:00:00.000Z",
    snoozeUntil: null,
    ...patch,
  };
}

test("a due check accepts a past time and rejects a future, empty, or invalid one", () => {
  assert.equal(isRoutineDue(new Date(NOW - 1000).toISOString(), NOW), true);
  assert.equal(isRoutineDue(new Date(NOW + 1000).toISOString(), NOW), false);
  assert.equal(isRoutineDue(new Date(NOW).toISOString(), NOW), true);
  assert.equal(isRoutineDue(null, NOW), false);
  assert.equal(isRoutineDue("not-a-time", NOW), false);
});

test("an excerpt collapses whitespace and keeps a 500 character cap", () => {
  assert.equal(runExcerpt("  three\n\n tickets\tare waiting  "), "three tickets are waiting");
  const long = "a".repeat(600);
  const excerpt = runExcerpt(long);
  assert.equal(excerpt.length, 500);
  assert.equal(excerpt.endsWith("…"), true);
});

test("prune and snooze use the 90 day and 4 hour windows", () => {
  assert.equal(pruneBeforeIso(NOW), new Date(NOW - 90 * 24 * 60 * 60 * 1000).toISOString());
  assert.equal(snoozeUntilIso(NOW), new Date(NOW + 4 * 60 * 60 * 1000).toISOString());
});

test("status labels and duration stay short", () => {
  assert.equal(routineStatusLabel("ok"), "Completed");
  assert.equal(routineStatusLabel("running"), "Running");
  assert.equal(routineStatusLabel("stopped"), "Stopped");
  assert.equal(routineStatusLabel("error: interrupted"), "Interrupted");
  assert.equal(routineStatusLabel("missed: app was closed"), "Missed");
  assert.equal(routineStatusLabel("skipped: agent busy"), "Skipped");
  assert.equal(routineStatusLabel("error: boom"), "Failed");
  assert.equal(routineStatusLabel(null), "Unknown");
  assert.equal(routineStatusTone("ok"), "is-success");
  assert.equal(routineStatusTone("error: interrupted"), "is-error");
  assert.equal(routineStatusTone("missed: app was closed"), "is-error");
  assert.equal(routineStatusTone("error: boom"), "is-error");
  assert.equal(routineStatusTone("skipped: agent busy"), "");
  assert.equal(routineStatusTone("stopped"), "");
  const start = new Date(NOW).toISOString();
  assert.equal(runDurationLabel(start, new Date(NOW + 45_000).toISOString()), "45s");
  assert.equal(runDurationLabel(start, new Date(NOW + 125_000).toISOString()), "2m");
  assert.equal(runDurationLabel(start, new Date(NOW + 3_600_000).toISOString()), "1h");
  assert.equal(runDurationLabel(start, new Date(NOW + 5_400_000).toISOString()), "1h 30m");
  assert.equal(runDurationLabel("nope", start), "");
});

test("a snoozed routine stays hidden and an approval cannot be snoozed", () => {
  const view = buildInbox(
    [row({ snoozeUntil: new Date(NOW + 60_000).toISOString() }), row({ id: "row-2", kind: "turn", title: "A turn failed", snoozeUntil: new Date(NOW - 1000).toISOString() })],
    [approval()],
    NOW,
  );
  assert.equal(view.unread, 2);
  assert.equal(view.items[0]?.id, "approval:ap-1");
  assert.equal(view.items[0]?.snoozeable, false);
  assert.equal(view.items[1]?.id, "row-2");
  assert.equal(view.items[1]?.snoozeable, true);
  assert.throws(() => assertInboxAction("approval:ap-1"), /stays until you answer/);
  assert.doesNotThrow(() => assertInboxAction("row-2"));
});
