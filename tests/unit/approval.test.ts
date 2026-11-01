import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalActionDecision,
  approvalActionRemembers,
  isApprovalAction,
  normalizeApprovalMatch,
} from "../../src/shared/approval.ts";

test("normalizes a command for rule matching", () => {
  assert.equal(normalizeApprovalMatch("  GIT   push   origin main  "), "git push origin main");
  assert.equal(normalizeApprovalMatch("del\tnotes.tmp\r\n"), "del notes.tmp");
});

test("maps approval actions to decisions and saved rules", () => {
  assert.equal(approvalActionDecision("approve"), "allow");
  assert.equal(approvalActionDecision("always-allow"), "allow");
  assert.equal(approvalActionDecision("reject"), "deny");
  assert.equal(approvalActionDecision("always-deny"), "deny");
  assert.equal(approvalActionRemembers("approve"), false);
  assert.equal(approvalActionRemembers("always-allow"), true);
  assert.equal(approvalActionRemembers("always-deny"), true);
});

test("rejects unknown approval actions", () => {
  assert.equal(isApprovalAction("approve"), true);
  assert.equal(isApprovalAction("maybe"), false);
  assert.equal(isApprovalAction(null), false);
});
