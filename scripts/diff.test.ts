import assert from "node:assert/strict";
import test from "node:test";
import { diffLines } from "../src/shared/diff.ts";

test("keeps common lines and reports replacements", () => {
  const result = diffLines("a\nb\nc", "a\nB\nc\nd");
  assert.equal(result.additions, 2);
  assert.equal(result.deletions, 1);
  assert.equal(result.truncated, false);
  assert.deepEqual(
    result.lines.map((line) => line.kind),
    ["same", "remove", "add", "same", "add"],
  );
  assert.deepEqual(
    result.lines.map((line) => line.text),
    ["a", "b", "B", "c", "d"],
  );
});

test("treats an empty original as a new file", () => {
  const result = diffLines("", "one\ntwo");
  assert.equal(result.additions, 2);
  assert.equal(result.deletions, 0);
  assert.deepEqual(
    result.lines.map((line) => [line.kind, line.oldLine, line.newLine]),
    [
      ["add", null, 1],
      ["add", null, 2],
    ],
  );
});

test("numbers old and new lines across an edit", () => {
  const result = diffLines("x\ny", "x\nY\nz");
  assert.deepEqual(
    result.lines.map((line) => [line.kind, line.oldLine, line.newLine]),
    [
      ["same", 1, 1],
      ["remove", 2, null],
      ["add", null, 2],
      ["add", null, 3],
    ],
  );
});

test("normalizes CRLF before comparing", () => {
  const result = diffLines("a\r\nb", "a\nb");
  assert.equal(result.additions, 0);
  assert.equal(result.deletions, 0);
});

test("marks output truncated when line caps are exceeded", () => {
  const result = diffLines("a\nb\nc", "a\nb", 2);
  assert.equal(result.truncated, true);
});

test("removes every line of a deleted file", () => {
  const result = diffLines("one\ntwo", "");
  assert.equal(result.additions, 0);
  assert.equal(result.deletions, 2);
  assert.deepEqual(
    result.lines.map((line) => line.kind),
    ["remove", "remove"],
  );
});
