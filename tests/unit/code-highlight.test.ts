// Tests the language lookup and per-line highlighting used by the code reader.

import assert from "node:assert/strict";
import test from "node:test";
import { highlightLines, languageForPath } from "../../src/renderer/lib/code-highlight.ts";

test("maps workspace files to highlight languages", () => {
  assert.equal(languageForPath("src/runner.ts"), "typescript");
  assert.equal(languageForPath("bench.ps1"), "powershell");
  assert.equal(languageForPath("README.md"), "markdown");
  assert.equal(languageForPath("Dockerfile"), "");
  assert.equal(languageForPath(".gitignore"), "");
});

test("splits highlighted code into balanced lines", () => {
  const source = "/* one\n   two */\nexport const value = 1;";
  const lines = highlightLines(source, "typescript");
  assert.ok(lines);
  assert.equal(lines.length, 3);
  for (const line of lines) {
    assert.equal((line.match(/<span/g) ?? []).length, (line.match(/<\/span>/g) ?? []).length);
  }
  assert.match(lines[0] ?? "", /hljs-comment/);
  assert.match(lines[1] ?? "", /hljs-comment/);
  assert.match(lines[2] ?? "", /hljs-keyword/);
});

test("returns null for an unknown language", () => {
  assert.equal(highlightLines("x", "not-a-language"), null);
});
