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
    fullRegressionGlobs: ["**/auth/**"],
    minMappingCoverage: null,
    maxChangedFiles: 400,
  });
  assert.equal(auth.fullRegression, true);
  assert.match(auth.fullRegressionReasons.join(" "), /auth/);

  const ordinary = scoreRelease({
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
  assert.equal(ordinary.fullRegression, false);
});

test("a large diff keeps the matched tests and does not force the full suite", () => {
  const changes: ScoreChange[] = [];
  for (let index = 0; index < 100; index += 1) {
    changes.push({
      idPath: `service/src/billing/File${index}.java`,
      workspacePath: `repos/service/src/billing/File${index}.java`,
      role: "source",
      status: "M",
      line: 1,
      signals: signals(index === 0 ? { endpoints: ["/api/billing/invoice"] } : {}),
    });
  }
  const tests: ScoreTest[] = [];
  for (let index = 0; index < 60; index += 1) {
    tests.push({
      id: `TC-${index}`,
      name: `case ${index}`,
      idPath: `automation/tests/case${index}.spec.ts`,
      workspacePath: `repos/automation/tests/case${index}.spec.ts`,
      suite: "billing",
      line: 1,
      skipped: false,
      signals: signals(index === 3 ? { endpoints: ["/api/billing/invoice"] } : {}),
    });
  }
  const selected = scoreRelease({
    changes,
    changedFileCount: changes.length,
    tests,
    explicit: [{ match: "service/src/**", tests: ["automation/tests/**"] }],
    contractPaths: [],
    commitTickets: [],
    fullRegressionGlobs: null,
    minMappingCoverage: 0.7,
    maxChangedFiles: 40,
  });
  assert.equal(selected.fullRegression, false);
  assert.equal(selected.mustRun.length, 1);
  assert.equal(selected.mustRun[0]?.id, "TC-3");
  const notes = selected.unknowns.join(" ");
  assert.match(notes, /matches 60 of 60/);
  assert.match(notes, /review limit of 40/);
  assert.match(notes, /Mapping coverage 0\.01 is below 0\.70/);
  assert.match(notes, /Uncovered source folders: repos\/service\/src\/billing \(99\)/);
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
  assert.match(report, /Also run the full suite/);
  assert.ok(report.indexOf("## Must run") > report.indexOf("Also run the full suite"));
  assert.equal(renderSelection(selection.mustRun, "playwright-grep"), "TC-1042");
});
