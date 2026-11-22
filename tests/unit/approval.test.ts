import assert from "node:assert/strict";
import test from "node:test";
import {
  approvalActionDecision,
  approvalActionRemembers,
  approvalRuleMatches,
  BUILT_IN_APPROVAL_RULES,
  builtInApprovalRule,
  isApprovalAction,
  isApprovalMatcher,
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

test("saved rules match exactly or at a word boundary", () => {
  assert.equal(approvalRuleMatches({ match: "npm test", matcher: "exact" }, "  NPM   test "), true);
  assert.equal(approvalRuleMatches({ match: "npm test", matcher: "exact" }, "npm test --watch"), false);
  assert.equal(approvalRuleMatches({ match: "npm test", matcher: "prefix" }, "npm test --watch"), true);
  assert.equal(approvalRuleMatches({ match: "npm test", matcher: "prefix" }, "npm testing"), false);
  assert.equal(isApprovalMatcher("exact"), true);
  assert.equal(isApprovalMatcher("regex"), false);
});

test("built-in denies cover disk and root deletion commands", () => {
  assert.equal(BUILT_IN_APPROVAL_RULES.length, 3);
  assert.equal(builtInApprovalRule("format D: /q")?.id, "format");
  assert.equal(builtInApprovalRule("format")?.id, "format");
  assert.equal(builtInApprovalRule("  DISKPART  ")?.id, "diskpart");
  assert.equal(builtInApprovalRule("diskpart /s script.txt")?.id, "diskpart");
  assert.equal(builtInApprovalRule("rm -rf /")?.id, "rm-root");
  assert.equal(builtInApprovalRule("rm -rf /*")?.id, "rm-root");
  assert.equal(builtInApprovalRule("rm -rf --no-preserve-root /")?.id, "rm-root");
  assert.equal(builtInApprovalRule("rm -rf /tmp/build"), null);
  assert.equal(builtInApprovalRule("git status"), null);
  assert.equal(builtInApprovalRule("format D: /q", "tool"), null);
});
