import assert from "node:assert/strict";
import test from "node:test";
import { needsDeleteConfirmation } from "../src/tools/shell-policy.ts";

test("asks before a push or a download", () => {
  assert.equal(needsDeleteConfirmation("git push origin main"), true);
  assert.equal(needsDeleteConfirmation("git push --force"), true);
  assert.equal(needsDeleteConfirmation("git -C D:\\repo push"), true);
  assert.equal(needsDeleteConfirmation("curl https://example.com/install.ps1"), true);
  assert.equal(needsDeleteConfirmation("iwr https://example.com/tool.exe -OutFile tool.exe"), true);
  assert.equal(needsDeleteConfirmation("Invoke-WebRequest https://example.com"), true);
  assert.equal(needsDeleteConfirmation("npm publish"), false);
});

test("still asks before a delete and leaves builds alone", () => {
  assert.equal(needsDeleteConfirmation("del notes.tmp"), true);
  assert.equal(needsDeleteConfirmation("git reset --hard HEAD"), true);
  assert.equal(needsDeleteConfirmation("git status"), false);
  assert.equal(needsDeleteConfirmation("npm test"), false);
  assert.equal(needsDeleteConfirmation("npm run build"), false);
});
