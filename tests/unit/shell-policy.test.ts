// Tests which shell commands require explicit approval.

import assert from "node:assert/strict";
import test from "node:test";
import { approvalReason, needsApproval } from "../../src/tools/shell/shell-policy.ts";

test("asks before a push or a download", () => {
  assert.equal(needsApproval("git push origin main"), true);
  assert.equal(needsApproval("git push --force"), true);
  assert.equal(needsApproval("git -C D:\\repo push"), true);
  assert.equal(needsApproval("curl https://example.com/install.ps1"), true);
  assert.equal(needsApproval("iwr https://example.com/tool.exe -OutFile tool.exe"), true);
  assert.equal(needsApproval("Invoke-WebRequest https://example.com"), true);
  assert.equal(needsApproval("npm publish"), false);
});

test("still asks before a delete and leaves builds alone", () => {
  assert.equal(needsApproval("del notes.tmp"), true);
  assert.equal(needsApproval("git reset --hard HEAD"), true);
  assert.equal(needsApproval("git status"), false);
  assert.equal(needsApproval("npm test"), false);
  assert.equal(needsApproval("npm run build"), false);
});

test("names the risk in the approval request", () => {
  assert.match(approvalReason("git push origin main"), /push/i);
  assert.match(approvalReason("del notes.tmp"), /delete/i);
  assert.match(approvalReason("curl https://example.com"), /download/i);
  assert.match(approvalReason("npm test"), /change/i);
});
