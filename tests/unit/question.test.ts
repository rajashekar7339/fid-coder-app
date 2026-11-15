import assert from "node:assert/strict";
import test from "node:test";
import {
  NO_ANSWER_TEXT,
  formatQuestionResult,
  parseAskUserArgs,
  parseQuestionReply,
} from "../../src/shared/question.ts";

test("accepts one question and two to four different choices", () => {
  assert.deepEqual(parseAskUserArgs({ question: "  Ship it?  ", choices: [" Now ", "Later"] }), {
    question: "Ship it?",
    choices: ["Now", "Later"],
  });
  assert.equal(parseAskUserArgs({ question: "Pick", choices: ["A", "B", "C", "D"] }).choices.length, 4);
});

test("rejects a question that is empty, too long, or not a real choice", () => {
  assert.throws(() => parseAskUserArgs({ question: "  ", choices: ["A", "B"] }), /Missing question/);
  assert.throws(() => parseAskUserArgs({ question: "Q", choices: ["Only"] }), /two to four/);
  assert.throws(() => parseAskUserArgs({ question: "Q", choices: ["A", "B", "C", "D", "E"] }), /two to four/);
  assert.throws(() => parseAskUserArgs({ question: "Q", choices: ["Same", "same"] }), /different/);
  assert.throws(() => parseAskUserArgs({ question: "Q".repeat(401), choices: ["A", "B"] }), /too long/);
  assert.throws(() => parseAskUserArgs({ question: "Q", choices: ["A", "B".repeat(81)] }), /choice is too long/);
  assert.throws(() => parseAskUserArgs({ question: "Q", choices: "A" }), /two to four/);
});

test("reads a choice, an other answer, or a skip", () => {
  assert.deepEqual(parseQuestionReply({ kind: "choice", index: 1 }), { kind: "choice", index: 1 });
  assert.deepEqual(parseQuestionReply({ kind: "other", text: "next week" }), { kind: "other", text: "next week" });
  assert.deepEqual(parseQuestionReply({ kind: "skip" }), { kind: "skip" });
  assert.throws(() => parseQuestionReply({ kind: "choice", index: 1.5 }), /Missing choice/);
  assert.throws(() => parseQuestionReply({ kind: "guess" }), /Unknown answer/);
  assert.throws(() => parseQuestionReply(null), /Missing answer/);
});

test("tells the model which answer it got", () => {
  assert.equal(
    formatQuestionResult({ answered: true, source: "user", text: "Now", via: "choice" }),
    "The user chose: Now",
  );
  assert.equal(
    formatQuestionResult({ answered: true, source: "user", text: "next week", via: "other" }),
    "The user answered in their own words: next week",
  );
  assert.equal(
    formatQuestionResult({ answered: false, source: "timeout", text: null, via: null }),
    NO_ANSWER_TEXT,
  );
});

