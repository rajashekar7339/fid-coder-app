// Tests the shared attachment rules used by the composer and the workspace reader.

import assert from "node:assert/strict";
import test from "node:test";
import {
  addAttachments,
  attachmentKey,
  attachmentLabel,
  attachmentsForSend,
  normalizeLineRange,
  parseMessageAttachments,
} from "../../src/shared/attachments.ts";
import type { MessageAttachment } from "../../src/shared/types.ts";

function upload(name: string): MessageAttachment {
  return { kind: "upload", path: `C:\\tmp\\${name}`, name };
}

test("labels selections with their line range", () => {
  assert.equal(
    attachmentLabel({ kind: "selection", path: "src/a.ts", name: "a.ts", startLine: 12, endLine: 12 }),
    "a.ts:12",
  );
  assert.equal(
    attachmentLabel({ kind: "selection", path: "src/a.ts", name: "a.ts", startLine: 12, endLine: 18 }),
    "a.ts:12–18",
  );
  assert.equal(attachmentLabel({ kind: "workspace", path: "README.md", name: "README.md" }), "README.md");
  assert.equal(attachmentLabel(upload("notes.csv")), "notes.csv");
});

test("adds attachments and replaces duplicates", () => {
  const first = addAttachments([], [upload("a.txt"), upload("b.txt")]);
  assert.deepEqual(first.map((item) => item.name), ["a.txt", "b.txt"]);

  const replaced = addAttachments(first, [{ ...upload("a.txt"), name: "renamed.txt" }]);
  assert.equal(replaced.length, 2);
  assert.equal(replaced[0]?.name, "renamed.txt");
  assert.notEqual(attachmentKey(replaced[0]!), attachmentKey(replaced[1]!));
});

test("adds the active context to the message unless it is already pinned", () => {
  const pinned = [upload("a.txt")];
  const active: MessageAttachment = {
    kind: "selection",
    path: "src/a.ts",
    name: "a.ts",
    startLine: 2,
    endLine: 4,
  };
  assert.deepEqual(attachmentsForSend(pinned, active), [...pinned, active]);
  assert.deepEqual(attachmentsForSend([...pinned, active], active), [...pinned, active]);
  assert.deepEqual(attachmentsForSend(pinned, null), pinned);
});

test("normalizes line ranges against the file length", () => {
  assert.deepEqual(normalizeLineRange(4, 9, 10), { startLine: 4, endLine: 9 });
  assert.deepEqual(normalizeLineRange(9, 4, 10), { startLine: 4, endLine: 9 });
  assert.deepEqual(normalizeLineRange(0, 99, 10), { startLine: 1, endLine: 10 });
  assert.deepEqual(normalizeLineRange(null, null, 3), { startLine: 1, endLine: 1 });
  assert.equal(normalizeLineRange(1, 1, 0), null);
});

test("parses stored attachments and drops malformed rows", () => {
  const valid: MessageAttachment = {
    kind: "selection",
    path: "src/a.ts",
    name: "a.ts",
    startLine: 1,
    endLine: 2,
  };
  assert.deepEqual(parseMessageAttachments(JSON.stringify([valid])), [valid]);
  assert.equal(parseMessageAttachments(null), null);
  assert.equal(parseMessageAttachments("not json"), null);
  assert.equal(parseMessageAttachments(JSON.stringify({ kind: "upload" })), null);
  assert.deepEqual(
    parseMessageAttachments(JSON.stringify([valid, { kind: "nope" }, { path: 3 }])),
    [valid],
  );
});
