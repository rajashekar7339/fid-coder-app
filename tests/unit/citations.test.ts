// Tests path:line citation parsing used by inline answers and the file preview.

import assert from "node:assert/strict";
import test from "node:test";
import { citationPattern, parseCitation } from "../../src/shared/citations.ts";

test("parses relative, absolute, and range citations", () => {
  assert.deepEqual(parseCitation("src/main/chat/runner.ts:420"), {
    path: "src/main/chat/runner.ts",
    line: 420,
    endLine: null,
  });
  assert.deepEqual(parseCitation("src/main/chat/runner.ts:420-438"), {
    path: "src/main/chat/runner.ts",
    line: 420,
    endLine: 438,
  });
  assert.deepEqual(parseCitation("C:\\repo\\src\\foo.ts:12"), {
    path: "C:\\repo\\src\\foo.ts",
    line: 12,
    endLine: null,
  });
  assert.equal(parseCitation("README.md:1")?.path, "README.md");
});

test("rejects non-citations and malformed line ranges", () => {
  assert.equal(parseCitation("https://example.com/a.ts:12"), null);
  assert.equal(parseCitation("package.json"), null);
  assert.equal(parseCitation("v1.2.3"), null);
  assert.equal(parseCitation("src/foo.ts:0"), null);
  assert.equal(parseCitation("src/foo.ts:12-8")?.endLine, null);
});

test("finds citations without matching a URL path", () => {
  const text =
    "See src/main/chat/runner.ts:420 and README.md:1, not https://github.com/org/repo/src/foo.ts:12.";
  const found = [...text.matchAll(citationPattern())].map((match) => match[0]);
  assert.deepEqual(found, ["src/main/chat/runner.ts:420", "README.md:1"]);
});
