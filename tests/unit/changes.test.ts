// Tests summary totals and the newest-change lookup used by citations.

import assert from "node:assert/strict";
import test from "node:test";
import { changeTotals, findChangedFile } from "../../src/shared/changes.ts";
import type { ChangeSet, FileChangeSummary } from "../../src/shared/types.ts";

function file(path: string, additions = 1, deletions = 0): FileChangeSummary {
  return {
    id: path,
    path,
    kind: "update",
    additions,
    deletions,
    revertible: true,
    note: null,
  };
}

test("sums a change set", () => {
  const change: ChangeSet = {
    turnId: "newer",
    startedAt: "2026-11-10T11:00:00.000Z",
    source: "chat",
    status: "success",
    files: [file("src/main/a.ts", 4, 1), file("README.md", 1, 0)],
  };
  assert.deepEqual(changeTotals(change), { additions: 5, deletions: 1 });
  assert.deepEqual(changeTotals(null), { additions: 0, deletions: 0 });
});

test("finds the newest file match through path normalization", () => {
  const older: ChangeSet = {
    turnId: "older",
    startedAt: "2026-11-10T10:00:00.000Z",
    source: "chat",
    status: "success",
    files: [file("src/main/a.ts", 2, 1)],
  };
  const newer: ChangeSet = {
    turnId: "newer",
    startedAt: "2026-11-10T11:00:00.000Z",
    source: "chat",
    status: "success",
    files: [file("src/main/a.ts", 4, 1), file("README.md", 1, 0)],
  };
  assert.deepEqual(findChangedFile([newer, older], "./src/main/a.ts"), {
    turnId: "newer",
    file: newer.files[0]!,
  });
  assert.equal(findChangedFile([newer, older], "missing.ts"), null);
});
