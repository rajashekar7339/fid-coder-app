// Tests how nano-AI units become a readable AI-credit amount.

import assert from "node:assert/strict";
import test from "node:test";
import { formatCredits } from "../../src/renderer/lib/format.ts";

test("formats nano-AI units as AI credits", () => {
  assert.equal(formatCredits(0), "0");
  assert.equal(formatCredits(500_000), "<0.001");
  assert.equal(formatCredits(4_200_000), "0.0042");
  assert.equal(formatCredits(42_000_000), "0.042");
  assert.equal(formatCredits(1_234_000_000), "1.23");
});
