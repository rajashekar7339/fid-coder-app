import assert from "node:assert/strict";
import test from "node:test";
import {
  COPILOT_USAGE_UNAVAILABLE,
  formatUsageCount,
  formatUsageReset,
  normalizeCopilotUsage,
  usageFailureMessage,
} from "../src/shared/copilot-usage.ts";

test("premium requests win over a finite chat snapshot", () => {
  const usage = normalizeCopilotUsage({
    chat: {
      isUnlimitedEntitlement: false,
      entitlementRequests: 10,
      usedRequests: 1,
      usageAllowedWithExhaustedQuota: true,
    },
    premium_interactions: {
      isUnlimitedEntitlement: false,
      entitlementRequests: 300,
      usedRequests: 142,
      remainingPercentage: 52.7,
      overage: 0,
      usageAllowedWithExhaustedQuota: true,
      resetDate: "2026-11-01",
    },
  });
  assert.ok(usage);
  assert.equal(usage.label, "Premium requests");
  assert.equal(usage.unlimited, false);
  assert.equal(usage.used, 142);
  assert.equal(usage.included, 300);
  assert.equal(usage.remaining, 158);
  assert.equal(usage.remainingPercent, 52.7);
  assert.equal(usage.overage, 0);
  assert.equal(usage.blocked, false);
  assert.equal(usage.resetsAt, "2026-11-01");
});

test("an unlimited premium snapshot stays the primary view", () => {
  const usage = normalizeCopilotUsage({
    premium_interactions: {
      isUnlimitedEntitlement: true,
      entitlementRequests: -1,
      usedRequests: 4,
      remainingPercentage: 100,
    },
    chat: {
      isUnlimitedEntitlement: false,
      entitlementRequests: 50,
      usedRequests: 10,
      usageAllowedWithExhaustedQuota: true,
    },
  });
  assert.ok(usage);
  assert.equal(usage.unlimited, true);
  assert.equal(usage.included, null);
  assert.equal(usage.remaining, null);
  assert.equal(usage.remainingPercent, null);
  assert.equal(usage.used, 4);
  assert.equal(usage.blocked, false);
});

test("entitlement of -1 is unlimited without the flag", () => {
  const usage = normalizeCopilotUsage({
    premiumInteractions: { entitlementRequests: -1, usedRequests: 0 },
  });
  assert.ok(usage);
  assert.equal(usage.label, "Premium requests");
  assert.equal(usage.unlimited, true);
  assert.equal(usage.included, null);
});

test("reports remaining, overage, and a blocked allowance", () => {
  const usage = normalizeCopilotUsage({
    premium_interactions: {
      isUnlimitedEntitlement: false,
      entitlementRequests: 300,
      usedRequests: 300,
      remainingPercentage: 0,
      overage: 12,
      usageAllowedWithExhaustedQuota: false,
      resetDate: "2026-11-01T00:00:00.000Z",
    },
  });
  assert.ok(usage);
  assert.equal(usage.remaining, 0);
  assert.equal(usage.overage, 12);
  assert.equal(usage.blocked, true);
  assert.equal(usage.resetsAt, "2026-11-01T00:00:00.000Z");
  assert.equal(formatUsageReset("2026-11-01"), "1 Nov 2026");
});

test("uses the first finite snapshot when premium requests are absent", () => {
  const usage = normalizeCopilotUsage({
    completions: { isUnlimitedEntitlement: true, entitlementRequests: -1, usedRequests: 8 },
    chat: {
      entitlementRequests: 20,
      usedRequests: 5,
      usageAllowedWithExhaustedQuota: true,
    },
  });
  assert.ok(usage);
  assert.equal(usage.label, "Chat");
  assert.equal(usage.included, 20);
  assert.equal(usage.remaining, 15);
});

test("empty and unusable snapshots return null", () => {
  assert.equal(normalizeCopilotUsage({}), null);
  assert.equal(normalizeCopilotUsage(null), null);
  assert.equal(normalizeCopilotUsage({ chat: null, completions: "nope" }), null);
});

test("keeps one decimal on fractional usage", () => {
  const usage = normalizeCopilotUsage({
    premium_interactions: {
      entitlementRequests: 10,
      usedRequests: 1.26,
      overage: 0.24,
      usageAllowedWithExhaustedQuota: true,
    },
  });
  assert.ok(usage);
  assert.equal(usage.used, 1.3);
  assert.equal(usage.remaining, 8.7);
  assert.equal(usage.overage, 0.2);
  assert.equal(formatUsageCount(usage.used), "1.3");
  assert.equal(formatUsageCount(2), "2");
  assert.equal(formatUsageCount(2.04), "2");
});

test("reads snake_case quota fields and ignores a bad reset date", () => {
  const usage = normalizeCopilotUsage({
    premium_interactions: {
      unlimited: false,
      entitlement: 100,
      used: 40,
      percent_remaining: 60,
      overage_count: 1,
      usage_allowed_with_exhausted_quota: true,
      reset_date: "next month",
    },
  });
  assert.ok(usage);
  assert.equal(usage.used, 40);
  assert.equal(usage.included, 100);
  assert.equal(usage.remainingPercent, 60);
  assert.equal(usage.overage, 1);
  assert.equal(usage.resetsAt, null);
  assert.equal(formatUsageReset("not-a-date"), null);
});

test("hides secrets and missing quota methods", () => {
  assert.equal(usageFailureMessage(new Error("bad ghp_exampletoken")), "Copilot usage could not be read.");
  assert.equal(usageFailureMessage(new Error("Method not found")), COPILOT_USAGE_UNAVAILABLE);
  assert.equal(usageFailureMessage(new Error("quota service timed out")), "quota service timed out");
});
