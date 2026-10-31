// Tests the one-line summaries shown for tool results in the chat thread.
const assert = require("node:assert/strict");
const test = require("node:test");
const { summarizeTool } = require("../../dist/shared/summary.js");

test("summarizeTool keeps one line", () => {
  assert.equal(summarizeTool("search_text", true, "src/app.ts:1:run\nnext\nlast"), "search_text: src/app.ts:1:run (+2 more lines)");
  assert.equal(summarizeTool("git_status", false, "not a repository"), "git_status: failed: not a repository");
});
