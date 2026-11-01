import assert from "node:assert/strict";
import test from "node:test";
import { renderReport, renderSelection } from "../../src/shared/release-impact/report.ts";
import { matchGlob, scoreRelease, type ChangeSignals, type ScoreChange, type ScoreTest } from "../../src/shared/release-impact/score.ts";
import type { SelectedTests } from "../../src/shared/release-impact/types.ts";

function signals(partial: Partial<ChangeSignals> = {}): ChangeSignals {
  return {
    endpoints: [],
    selectors: [],
    symbols: [],
    tickets: [],
    removedSelectors: [],
    addedSelectors: [],
    ...partial,
  };
}

test("scoring prefers an explicit map, drops a skipped test, and flags auth changes", () => {
  assert.equal(matchGlob("service/src/**/orders/**", "service/src/orders/Price.java"), true);
  assert.equal(matchGlob("**/auth/**", "service/src/auth/Login.java"), true);
  const change: ScoreChange = {
    idPath: "service/src/orders/Price.java",
    workspacePath: "repos/service/src/orders/Price.java",
    role: "source",
    status: "M",
    line: 8,
    signals: signals({ endpoints: ["/api/orders/discount"] }),
  };
  const found: ScoreTest = {
    id: "TC-1042",
    name: "Checkout applies a discount",
    idPath: "automation/tests/orders/discount.spec.ts",
    workspacePath: "repos/automation/tests/orders/discount.spec.ts",
    suite: "checkout",
    line: 4,
    skipped: false,
    signals: signals({ endpoints: ["/api/orders/discount"] }),
  };
  const selected = scoreRelease({
    changes: [change],
    changedFileCount: 1,
    tests: [found],
    explicit: [{ match: "service/src/**/orders/**", tests: ["automation/tests/orders/**"] }],
    contractPaths: [],
    commitTickets: ["PAY-812"],
    fullRegressionGlobs: [],
    minMappingCoverage: null,
    maxChangedFiles: 400,
  });
  assert.equal(selected.fullRegression, false);
  assert.equal(selected.mustRun[0]?.id, "TC-1042");
  assert.match(selected.mustRun[0]?.reason ?? "", /Explicit map/);
  assert.equal(selected.newScenarios[0]?.source, "PAY-812");

  const skipped = scoreRelease({
    changes: [change],
    changedFileCount: 1,
    tests: [{ ...found, skipped: true }],
    explicit: [],
    contractPaths: [],
    commitTickets: [],
    fullRegressionGlobs: [],
    minMappingCoverage: null,
    maxChangedFiles: 400,
  });
  assert.equal(skipped.mustRun.length, 0);
  assert.equal(skipped.shouldRun[0]?.id, "TC-1042");

  const auth = scoreRelease({
    changes: [{ ...change, idPath: "service/src/auth/Login.java", workspacePath: "repos/service/src/auth/Login.java" }],
    changedFileCount: 1,
    tests: [],
    explicit: [],
    contractPaths: [],
    commitTickets: [],
    fullRegressionGlobs: null,
    minMappingCoverage: null,
    maxChangedFiles: 400,
  });
  assert.equal(auth.fullRegression, true);
  assert.match(auth.fullRegressionReasons.join(" "), /auth/);
});

test("the report leads with full regression and the grep lists test ids", () => {
  const selection: SelectedTests = {
    release: { prod: { service: "aaa" }, candidate: { service: "bbb" } },
    mustRun: [
      {
        id: "TC-1042",
        name: "Checkout applies a discount",
        file: "repos/automation/tests/orders/discount.spec.ts",
        suite: "checkout",
        reason: "The pricing endpoint changed.",
        evidence: ["repos/service/src/orders/Price.java:8"],
      },
    ],
    shouldRun: [],
    optionalRun: [],
    newScenarios: [],
    risks: [],
    fullRegression: true,
    fullRegressionReasons: ["Changed files exceed the limit."],
    unknowns: [],
    selectionFormat: "playwright-grep",
    selectionText: "TC-1042",
  };
  const report = renderReport(selection);
  assert.ok(report.indexOf("## Full regression") < report.indexOf("## Must run"));
  assert.match(report, /Yes\. Run the full suite/);
  assert.equal(renderSelection(selection.mustRun, "playwright-grep"), "TC-1042");
});
