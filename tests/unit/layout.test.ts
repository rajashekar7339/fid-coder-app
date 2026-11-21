import assert from "node:assert/strict";
import test from "node:test";
import {
  clampWorkspaceWidth,
  maxWorkspaceWidth,
  MIN_WORKSPACE_WIDTH,
} from "../../src/renderer/lib/layout.ts";

test("the workspace width keeps room for the chat and a usable panel", () => {
  assert.equal(maxWorkspaceWidth(1400), 704);
  assert.equal(clampWorkspaceWidth(200, 1400), MIN_WORKSPACE_WIDTH);
  assert.equal(clampWorkspaceWidth(9999, 1400), 704);
  assert.equal(clampWorkspaceWidth(600, 1400), 600);
  assert.equal(clampWorkspaceWidth(600.6, 1400), 601);
});

test("a narrow window keeps the panel floor and a missing value is safe", () => {
  assert.equal(maxWorkspaceWidth(900), MIN_WORKSPACE_WIDTH);
  assert.equal(clampWorkspaceWidth(Number.NaN, 1400), MIN_WORKSPACE_WIDTH);
  assert.equal(clampWorkspaceWidth(Number.POSITIVE_INFINITY, 1400), MIN_WORKSPACE_WIDTH);
});
