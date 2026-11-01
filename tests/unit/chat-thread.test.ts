// Tests how the chat view merges saved messages, live text, and tool steps into one thread.

import assert from "node:assert/strict";
import test from "node:test";
import { groupToolCalls, liveTurnSettled, projectThread, userTurnAccepted, type LiveTurn } from "../../src/shared/chat-thread.ts";
import type { Message, MessageRole } from "../../src/shared/types.ts";

function message(id: string, role: MessageRole, content: string, createdAt: string): Message {
  return { id, agentId: "agent-1", role, content, createdAt };
}

const startedAt = Date.parse("2026-10-24T12:00:00.000Z");

function live(partial: Partial<LiveTurn> = {}): LiveTurn {
  return {
    userText: "Hello",
    assistant: "",
    tools: [],
    startedAt,
    ...partial,
  };
}

test("shows the user message before it is saved", () => {
  const projected = projectThread([], live(), "agent-1");
  assert.equal(projected.messages.length, 1);
  assert.equal(projected.messages[0]?.role, "user");
  assert.equal(projected.messages[0]?.content, "Hello");
  assert.equal(projected.thinking, true);
  assert.equal(projected.streaming, false);
});

test("does not duplicate a user message that is already stored", () => {
  const saved = [message("u1", "user", "Hello", "2026-10-24T12:00:00.100Z")];
  const projected = projectThread(saved, live(), "agent-1");
  assert.equal(projected.messages.length, 1);
  assert.equal(projected.messages[0]?.id, "u1");
  assert.equal(projected.thinking, true);
});

test("keeps a new send when an older identical turn is already complete", () => {
  const saved = [
    message("u1", "user", "Hello", "2026-10-24T11:00:00.000Z"),
    message("a1", "assistant", "Hi", "2026-10-24T11:00:02.000Z"),
  ];
  const projected = projectThread(saved, live(), "agent-1");
  assert.deepEqual(
    projected.messages.map((item) => item.id),
    ["u1", "a1", "pending-user"],
  );
  assert.equal(projected.thinking, true);
});

test("hides the live turn once the saved reply is present", () => {
  const saved = [
    message("u1", "user", "Hello", "2026-10-24T12:00:00.100Z"),
    message("a1", "assistant", "Done", "2026-10-24T12:00:03.000Z"),
  ];
  const projected = projectThread(saved, live({ assistant: "Done" }), "agent-1");
  assert.deepEqual(
    projected.messages.map((item) => item.id),
    ["u1", "a1"],
  );
  assert.equal(projected.thinking, false);
  assert.equal(projected.streaming, false);
  assert.equal(liveTurnSettled(saved, live()), true);
});

test("streams the assistant under the user message", () => {
  const saved = [message("u1", "user", "Hello", "2026-10-24T12:00:00.100Z")];
  const projected = projectThread(saved, live({ assistant: "Working" }), "agent-1");
  assert.equal(projected.messages.at(-1)?.content, "Working");
  assert.equal(projected.streaming, true);
  assert.equal(projected.thinking, false);
});

test("folds consecutive tool calls into one group", () => {
  const saved = [
    message("u1", "user", "weather", "2026-10-24T12:00:00.000Z"),
    message("t1", "tool", "browser_navigate: open", "2026-10-24T12:00:01.000Z"),
    message("t2", "tool", "browser_snapshot: page", "2026-10-24T12:00:02.000Z"),
    message("a1", "assistant", "Sunny", "2026-10-24T12:00:03.000Z"),
    message("t3", "tool", "shell_run: later", "2026-10-24T12:00:04.000Z"),
  ];
  const items = groupToolCalls(saved);
  assert.deepEqual(
    items.map((item) => (item.kind === "tools" ? item.calls.map((call) => call.id) : item.message.id)),
    ["u1", ["t1", "t2"], "a1", ["t3"]],
  );
});

test("shows a tool step as soon as it starts", () => {
  const saved = [message("u1", "user", "Hello", "2026-10-24T12:00:00.100Z")];
  const projected = projectThread(
    saved,
    live({
      tools: [
        { id: "live-tool-1", name: "git_status", content: "git_status: clean", pending: false },
        { id: "live-tool-2", name: "gh_pr_view", content: "gh_pr_view", pending: true },
      ],
    }),
    "agent-1",
  );
  assert.deepEqual(
    projected.messages.map((item) => item.id),
    ["u1", "live-tool-1", "live-tool-2"],
  );
  assert.equal(projected.pendingToolId, "live-tool-2");
  assert.equal(projected.thinking, false);
});

test("does not repeat tool steps already stored for this turn", () => {
  const saved = [
    message("u1", "user", "Hello", "2026-10-24T12:00:00.100Z"),
    message("t1", "tool", "git_status: clean", "2026-10-24T12:00:01.000Z"),
  ];
  const projected = projectThread(
    saved,
    live({
      tools: [
        { id: "live-tool-1", name: "git_status", content: "git_status: clean", pending: false },
        { id: "live-tool-2", name: "gh_pr_view", content: "gh_pr_view", pending: true },
      ],
    }),
    "agent-1",
  );
  assert.deepEqual(
    projected.messages.map((item) => item.id),
    ["u1", "t1", "live-tool-2"],
  );
  assert.equal(projected.pendingToolId, "live-tool-2");
});

test("keeps finished tool steps visible while the model is still thinking", () => {
  const projected = projectThread(
    [],
    live({
      tools: [{ id: "live-tool-1", name: "git_status", content: "git_status: clean", pending: false }],
    }),
    "agent-1",
  );
  assert.equal(projected.messages.at(-1)?.id, "live-tool-1");
  assert.equal(projected.pendingToolId, null);
  assert.equal(projected.thinking, true);
});

test("accepts a stored user row from this send", () => {
  const saved = [message("u1", "user", "Hello", "2026-10-24T12:00:00.100Z")];
  assert.equal(userTurnAccepted(saved, "Hello", startedAt), true);
  assert.equal(userTurnAccepted(saved, "Hello", Date.parse("2026-10-24T13:00:00.000Z")), false);
});
