// Tests the shared fact rules: normalization, scope, and the prompt budget.

import assert from "node:assert/strict";
import test from "node:test";
import {
  FACT_BLOCK_CHARS,
  FACT_MAX_CONTENT,
  FACT_MAX_COUNT,
  FACTS_HEADING,
  assertFactBudget,
  factBlockFits,
  factLooksLikeSecret,
  formatKnownFacts,
  normalizeFactContent,
  promptContents,
  type FactScope,
} from "../../src/shared/facts.ts";

function fact(overrides: Partial<FactScope> = {}): FactScope {
  return {
    id: "fact-1",
    agentId: "agent-1",
    enabled: true,
    content: "The release branch is main.",
    ...overrides,
  };
}

test("normalizes a fact onto one line and rejects an empty or oversized fact", () => {
  assert.equal(normalizeFactContent("  The   release\nbranch is main.  "), "The release branch is main.");
  assert.throws(() => normalizeFactContent("   "), /needs text/);
  assert.throws(() => normalizeFactContent("x".repeat(FACT_MAX_CONTENT + 1)), /280 characters or fewer/);
});

test("rejects a token or a private key", () => {
  assert.equal(factLooksLikeSecret("The API lives under src/main."), false);
  assert.throws(() => normalizeFactContent(`token ${"ghp_"}${"a".repeat(20)}`), /cannot store a token or key/);
  assert.throws(() => normalizeFactContent(`key ${"github_pat_"}${"a".repeat(20)}`), /cannot store a token/);
  assert.throws(() => normalizeFactContent(`sk-${"a".repeat(20)}`), /cannot store a token/);
  assert.throws(() => normalizeFactContent("-----BEGIN PRIVATE KEY-----"), /cannot store a token/);
});

test("selects enabled facts for one agent, then facts shared with everyone", () => {
  const facts = [
    fact({ id: "off", enabled: false, content: "Hidden." }),
    fact({ id: "other", agentId: "agent-2", content: "Other agent." }),
    fact({ id: "own", content: "Own fact." }),
    fact({ id: "shared", agentId: null, content: "Shared fact." }),
  ];
  assert.deepEqual(promptContents(facts, "agent-1"), ["Own fact.", "Shared fact."]);
});

test("formats the facts block and stops when the budget is full", () => {
  assert.equal(formatKnownFacts([]), null);
  const block = formatKnownFacts(["Own fact.", "Shared fact."]);
  assert.equal(block, `${FACTS_HEADING}\n- Own fact.\n- Shared fact.`);

  const long = "y".repeat(FACT_MAX_CONTENT);
  const many = Array.from({ length: FACT_MAX_COUNT }, () => long);
  assert.equal(factBlockFits(many), false);
  const formatted = formatKnownFacts(many);
  assert.ok(formatted);
  assert.ok(formatted.length <= FACT_BLOCK_CHARS);
  assert.ok(formatted.split("\n").length < many.length + 1);
});

test("rejects an enabled fact that would pass 20 facts or 4 KB", () => {
  const existing = Array.from({ length: FACT_MAX_COUNT }, (_, index) =>
    fact({ id: `fact-${index}`, content: `Fact ${index}.` }),
  );
  assert.throws(
    () => assertFactBudget(existing, fact({ id: "extra", content: "One more." })),
    /20 facts, within 4 KB/,
  );
  assert.doesNotThrow(() =>
    assertFactBudget(existing, fact({ id: "extra", content: "Kept off.", enabled: false })),
  );

  const shared = Array.from({ length: 15 }, (_, index) =>
    fact({ id: `shared-${index}`, agentId: null, content: "z".repeat(FACT_MAX_CONTENT) }),
  );
  assert.throws(
    () => assertFactBudget(shared, fact({ id: "own", content: "y".repeat(FACT_MAX_CONTENT) })),
    /does not fit/,
  );
});
