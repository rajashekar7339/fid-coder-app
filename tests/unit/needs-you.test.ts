import assert from "node:assert/strict";
import test from "node:test";
import { inboxBadgeCount, inboxUpdates, type InboxItem } from "../../src/shared/inbox.ts";
import { groupByAgent, groupRoutineBoard } from "../../src/shared/needs-you.ts";

function item(patch: Partial<InboxItem> = {}): InboxItem {
  return {
    id: "row-1",
    agentId: "agent-a",
    agentName: "Alpha",
    kind: "routine",
    title: "Sweep",
    body: "Done",
    createdAt: "2026-11-20T10:00:00.000Z",
    snoozeable: true,
    ...patch,
  };
}

test("waiting rows group by agent with the newest group first", () => {
  const groups = groupByAgent([
    { id: "1", agentId: "a", agentName: "Alpha", createdAt: "2026-11-20T09:00:00.000Z" },
    { id: "2", agentId: "b", agentName: "Beta", createdAt: "2026-11-20T11:00:00.000Z" },
    { id: "3", agentId: "a", agentName: "Alpha", createdAt: "2026-11-20T10:00:00.000Z" },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.agentName, group.count, group.items.map((row) => row.id)]),
    [
      ["Beta", 1, ["2"]],
      ["Alpha", 2, ["3", "1"]],
    ],
  );
});

test("routines group by agent name with enabled rows first", () => {
  const groups = groupRoutineBoard([
    { agentId: "b", agentName: "Beta", name: "Zebra", enabled: true },
    { agentId: "a", agentName: "Alpha", name: "Nightly", enabled: false },
    { agentId: "a", agentName: "Alpha", name: "Morning", enabled: true },
    { agentId: "a", agentName: "Alpha", name: "Afternoon", enabled: true },
  ]);
  assert.deepEqual(
    groups.map((group) => [group.agentId, group.items.map((row) => row.name)]),
    [
      ["a", ["Afternoon", "Morning", "Nightly"]],
      ["b", ["Zebra"]],
    ],
  );
});

test("stored approvals stay out of updates and the badge adds live cards", () => {
  const updates = inboxUpdates([
    item({ id: "approval:1", kind: "approval", snoozeable: false }),
    item({ id: "turn-1", kind: "turn", title: "Build failed" }),
  ]);
  assert.deepEqual(updates.map((row) => row.id), ["turn-1"]);
  assert.equal(inboxBadgeCount(2, 3), 5);
  assert.equal(inboxBadgeCount(0, 0), 0);
});
