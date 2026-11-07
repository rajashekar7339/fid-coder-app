// Tests how nano-AI units become a readable AI-credit amount.

import assert from "node:assert/strict";
import test from "node:test";
import {
  formatActivityDay,
  formatCredits,
  formatDay,
  formatFullTimestamp,
} from "../../src/renderer/lib/format.ts";

test("formats nano-AI units as AI credits", () => {
  assert.equal(formatCredits(0), "0");
  assert.equal(formatCredits(500_000), "<0.001");
  assert.equal(formatCredits(4_200_000), "0.0042");
  assert.equal(formatCredits(42_000_000), "0.042");
  assert.equal(formatCredits(1_234_000_000), "1.23");
});

test("formats day headings, activity days, and full timestamps", () => {
  const now = new Date();
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  assert.equal(formatDay(now.toISOString()), "Today");
  assert.equal(formatDay(yesterday.toISOString()), "Yesterday");
  assert.equal(formatActivityDay(now.toISOString()), "Today");
  assert.equal(formatActivityDay(yesterday.toISOString()), "Yesterday");

  const older = new Date(now);
  older.setDate(now.getDate() - 30);
  const olderDay = formatDay(older.toISOString());
  const olderActivity = formatActivityDay(older.toISOString());
  assert.ok(olderDay.length > 0 && !/^(Today|Yesterday)$/.test(olderDay));
  assert.ok(olderActivity.length > 0 && !/^(Today|Yesterday)$/.test(olderActivity));

  const full = formatFullTimestamp(now.toISOString());
  assert.match(full, /\d{4}/);
  assert.equal(formatFullTimestamp(""), "");
});
