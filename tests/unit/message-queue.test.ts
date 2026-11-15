import assert from "node:assert/strict";
import test from "node:test";
import { QUEUE_LIMIT, queueProblem } from "../../src/shared/message-queue.ts";

test("a queue entry needs text or an attachment", () => {
  assert.equal(queueProblem("", 0, 0), "Message is empty");
  assert.equal(queueProblem("  ", 0, 0), "Message is empty");
  assert.equal(queueProblem("", 1, 0), null);
  assert.equal(queueProblem("  ship it  ", 0), null);
});

test("the queue is capped", () => {
  assert.equal(queueProblem("next", 0, QUEUE_LIMIT - 1), null);
  assert.match(queueProblem("next", 0, QUEUE_LIMIT) ?? "", /queue is full/);
});
