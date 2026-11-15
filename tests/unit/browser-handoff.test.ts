import assert from "node:assert/strict";
import test from "node:test";
import {
  BROWSER_HELD_TEXT,
  HANDOFF_REASON_MAX,
  NEED_SNAPSHOT_TEXT,
  browserActError,
  parseHandoffReason,
} from "../../src/shared/browser-handoff.ts";

test("a held browser wins over the snapshot requirement", () => {
  assert.equal(browserActError({ held: true, needsSnapshot: true }), BROWSER_HELD_TEXT);
  assert.equal(browserActError({ held: true, needsSnapshot: false }), BROWSER_HELD_TEXT);
  assert.equal(browserActError({ held: false, needsSnapshot: true }), NEED_SNAPSHOT_TEXT);
  assert.equal(browserActError({ held: false, needsSnapshot: false }), null);
});

test("a handoff reason is trimmed and capped", () => {
  assert.equal(parseHandoffReason({ reason: "  Sign in  " }), "Sign in");
  assert.equal(parseHandoffReason({ reason: "a".repeat(HANDOFF_REASON_MAX) }).length, HANDOFF_REASON_MAX);
  assert.throws(() => parseHandoffReason({ reason: "   " }), /Missing reason/);
  assert.throws(() => parseHandoffReason({ reason: "a".repeat(HANDOFF_REASON_MAX + 1) }), /too long/);
  assert.throws(() => parseHandoffReason(null), /object/);
});
