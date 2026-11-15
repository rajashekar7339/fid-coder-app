import assert from "node:assert/strict";
import test from "node:test";
import { isEditableUserMessage } from "../../src/shared/message-actions.ts";

test("only a user message from a chat turn is editable", () => {
  assert.equal(isEditableUserMessage({ role: "user", turnId: "t1", turnSource: "chat" }), true);
  assert.equal(isEditableUserMessage({ role: "user", turnId: "t1", turnSource: "routine" }), false);
  assert.equal(isEditableUserMessage({ role: "assistant", turnId: "t1", turnSource: "chat" }), false);
  assert.equal(isEditableUserMessage({ role: "user", turnId: null, turnSource: "chat" }), false);
  assert.equal(isEditableUserMessage({ role: "user", turnId: "t1" }), false);
});
