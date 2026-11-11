// Tests the codebase starter prompts that fill the composer.

import assert from "node:assert/strict";
import test from "node:test";
import { WORKSPACE_STARTERS } from "../../src/shared/starters.ts";

test("workspace starters cover the four read-only starting points", () => {
  assert.deepEqual(
    WORKSPACE_STARTERS.map((starter) => starter.id),
    ["architecture", "flow", "review", "troubleshoot"],
  );
  for (const starter of WORKSPACE_STARTERS) {
    assert.ok(starter.label.trim(), starter.id);
    assert.ok(starter.hint.trim(), starter.id);
    assert.ok(starter.prompt.trim(), starter.id);
  }
});

test("the review starter invokes the built-in skill and troubleshooting leaves room for a log", () => {
  const review = WORKSPACE_STARTERS.find((starter) => starter.id === "review");
  assert.equal(review?.prompt, "/skills architecture-review review this repository");
  const troubleshoot = WORKSPACE_STARTERS.find((starter) => starter.id === "troubleshoot");
  assert.ok(troubleshoot?.prompt.endsWith("\n\n"));
  const flow = WORKSPACE_STARTERS.find((starter) => starter.id === "flow");
  assert.match(flow?.prompt ?? "", /flowchart/);
});
