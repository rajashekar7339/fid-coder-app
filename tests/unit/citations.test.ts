// Tests path:line citation parsing used by inline answers and the file preview.

import assert from "node:assert/strict";
import test from "node:test";
import {
  citationPattern,
  collectCitations,
  parseCitation,
  stripCitations,
} from "../../src/shared/citations.ts";

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
  assert.deepEqual(parseCitation("bench.ps1:12–18"), {
    path: "bench.ps1",
    line: 12,
    endLine: 18,
  });
  assert.deepEqual(parseCitation("bench.ps1:12—18"), {
    path: "bench.ps1",
    line: 12,
    endLine: 18,
  });
  assert.deepEqual(parseCitation("C:\\repo\\src\\foo.ts:12"), {
    path: "C:\\repo\\src\\foo.ts",
    line: 12,
    endLine: null,
  });
  assert.equal(parseCitation("README.md:1")?.path, "README.md");
  assert.equal(parseCitation("ModelFile.opt:10-25")?.path, "ModelFile.opt");
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

test("collects unique citations in source order", () => {
  const text =
    "Use `src/a.ts:10-12`, `src/b.ts:4`, and `src/a.ts:10–12`, then `bench.ps1:34–42`.";
  assert.deepEqual(
    collectCitations(text).map((citation) => [
      citation.path,
      citation.line,
      citation.endLine,
    ]),
    [
      ["src/a.ts", 10, 12],
      ["src/b.ts", 4, null],
      ["bench.ps1", 34, 42],
    ],
  );
});

test("strips citations and their separators from diagram labels", () => {
  const source = [
    "flowchart TD",
    '  A["Setup instructions<br/>README-2.md:1–3"] -->|"run create command"| B["Model configuration<br/>Modelfile.opt:7–29"]',
    '  C["Base model<br/>Modelfile.opt:10"]',
    '  D["Metrics (bench.ps1:39–42)"]',
    '  E["bench.ps1:12–18"]',
  ].join("\n");
  const cleaned = stripCitations(source);
  assert.match(cleaned, /A\["Setup instructions"\]/);
  assert.match(cleaned, /B\["Model configuration"\]/);
  assert.match(cleaned, /C\["Base model"\]/);
  assert.match(cleaned, /D\["Metrics"\]/);
  assert.match(cleaned, /E\[" "\]/);
  assert.doesNotMatch(cleaned, /README-2|Modelfile|bench\.ps1/);
});
