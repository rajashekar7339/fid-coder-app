// Tests the Enhance Prompt skip rules, cheap-model pick, and reply cleanup.

import assert from "node:assert/strict";
import test from "node:test";
import { parseCommand } from "../../src/shared/commands.ts";
import {
  ENHANCE_CONTEXT_CHARS,
  ENHANCE_DRAFT_CHARS,
  ENHANCE_OUTPUT_CHARS,
  cheapModelId,
  finishEnhance,
  prepareEnhance,
} from "../../src/shared/enhance-prompt.ts";
import { AUTO_MODEL_ID } from "../../src/shared/model.ts";

const longDraft = "The login redirect loops after the session cookie expires. Trace it and name the file.";
const isCommand = (text: string) => parseCommand(text) !== null;

test("an empty draft is rejected", () => {
  assert.throws(() => prepareEnhance({ text: "  \n", running: false, messages: [] }), /Message is empty/);
});

test("a running agent skips the rewrite", () => {
  const plan = prepareEnhance({ text: longDraft, running: true, messages: [], isCommand });
  assert.deepEqual(plan, {
    status: "skipped",
    text: longDraft,
    reason: "Wait until the agent finishes.",
  });
});

test("a composer command is sent as written", () => {
  const plan = prepareEnhance({
    text: "/skills write-lean " + longDraft,
    running: false,
    messages: [],
    isCommand,
  });
  assert.equal(plan.status, "skipped");
  if (plan.status === "skipped") assert.equal(plan.reason, "Commands are sent as written.");
});

test("a short draft is enhanced", () => {
  const plan = prepareEnhance({ text: "fix the login bug", running: false, messages: [], isCommand });
  assert.equal(plan.status, "ready");
  if (plan.status !== "ready") return;
  assert.match(plan.prompt, /Draft:\nfix the login bug$/);
});

test("a long draft includes the recent user and assistant lines only", () => {
  const plan = prepareEnhance({
    text: `  ${longDraft}  `,
    running: false,
    isCommand,
    messages: [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "tool", content: "tool dump that must stay out" },
      { role: "user", content: "three" },
      { role: "assistant", content: "four" },
      { role: "user", content: "five" },
    ],
  });
  assert.equal(plan.status, "ready");
  if (plan.status !== "ready") return;
  assert.match(plan.prompt, /user: three\nassistant: four\nuser: five/);
  assert.doesNotMatch(plan.prompt, /tool dump/);
  assert.doesNotMatch(plan.prompt, /user: one/);
  assert.match(plan.prompt, new RegExp(`Draft:\\n${longDraft}$`));
});

test("the draft and context lines are clipped", () => {
  const plan = prepareEnhance({
    text: "x".repeat(ENHANCE_DRAFT_CHARS + 20),
    running: false,
    isCommand,
    messages: [{ role: "assistant", content: "y".repeat(ENHANCE_CONTEXT_CHARS + 20) }],
  });
  assert.equal(plan.status, "ready");
  if (plan.status !== "ready") return;
  assert.match(plan.prompt, new RegExp(`assistant: ${"y".repeat(ENHANCE_CONTEXT_CHARS)}…`));
  assert.match(plan.prompt, new RegExp(`Draft:\\n${"x".repeat(ENHANCE_DRAFT_CHARS)}…$`));
});

test("mini wins over flash and haiku, and Auto is the fallback", () => {
  assert.equal(
    cheapModelId([
      { id: "claude-haiku", name: "Haiku" },
      { id: "gemini-flash", name: "Flash" },
      { id: "gpt-4.1-mini", name: "GPT-4.1 mini" },
    ]),
    "gpt-4.1-mini",
  );
  assert.equal(cheapModelId([{ id: "gpt-4o", name: "GPT-4o" }]), AUTO_MODEL_ID);
  assert.equal(cheapModelId([]), AUTO_MODEL_ID);
});

test("a fenced rewrite is unwrapped and capped", () => {
  const raw = "```text\n" + "z".repeat(ENHANCE_OUTPUT_CHARS + 30) + "\n```";
  const result = finishEnhance(longDraft, raw);
  assert.equal(result.status, "enhanced");
  if (result.status === "enhanced") assert.equal(result.text.length, ENHANCE_OUTPUT_CHARS);
});

test("an unchanged rewrite is already clear", () => {
  assert.deepEqual(finishEnhance(`  ${longDraft}\n`, `Prompt:\n${longDraft}`), {
    status: "skipped",
    text: longDraft,
    reason: "Already clear.",
  });
});

test("an empty rewrite fails", () => {
  assert.throws(() => finishEnhance(longDraft, "```\n\n```"), /empty rewrite/);
});
