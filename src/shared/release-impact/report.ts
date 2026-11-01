import type { SelectedTest, SelectedTests, SelectionFormat } from "./types";

export function renderReport(selection: SelectedTests): string {
  const lines = ["# Release impact", "", "## Full regression", ""];
  if (selection.fullRegression) {
    lines.push("Yes. Run the full suite.");
    for (const reason of selection.fullRegressionReasons) lines.push(`- ${reason}`);
  } else {
    lines.push("No. The selected tests cover this diff.");
  }
  lines.push("", "## Refs", "");
  for (const id of Object.keys(selection.release.candidate).sort()) {
    lines.push(`- ${id}: prod ${selection.release.prod[id] ?? "missing"} → candidate ${selection.release.candidate[id]}`);
  }
  pushTests(lines, "Must run", selection.mustRun);
  pushTests(lines, "Should run", selection.shouldRun);
  lines.push("", "## New scenarios", "");
  if (selection.newScenarios.length === 0) lines.push("None from ticket keys in the diff.");
  for (const scenario of selection.newScenarios) {
    lines.push(`- ${scenario.title} (${scenario.source}): ${scenario.reason}`);
  }
  lines.push("", "## Risks", "");
  if (selection.risks.length === 0) lines.push("None detected from selectors in the diff.");
  for (const risk of selection.risks) {
    lines.push(`- ${risk.severity} ${risk.category}: ${risk.action}`);
    lines.push(`  - source ${risk.source}`);
    lines.push(`  - automation ${risk.automation}`);
  }
  lines.push("", "## Unknowns", "");
  if (selection.unknowns.length === 0) lines.push("None.");
  for (const unknown of selection.unknowns) lines.push(`- ${unknown}`);
  lines.push(
    "",
    "This draft is deterministic. Confirm, downgrade, or add gaps before treating it as the final report.",
    "",
  );
  return lines.join("\n");
}

export function renderSelection(tests: SelectedTest[], format: SelectionFormat): string {
  if (format === "json") return `${JSON.stringify(tests, null, 2)}\n`;
  if (format === "file-list") return `${unique(tests.map((test) => test.file)).join("\n")}\n`;
  if (format === "playwright-grep") {
    const parts = tests.map((test) => escapeRegExp(test.id || test.name)).filter(Boolean);
    return parts.join("|");
  }
  if (format === "cucumber-tags") {
    const tags = tests.map((test) => test.id).filter((id) => id.startsWith("@"));
    return tags.join(" or ");
  }
  if (format === "junit") {
    return `${tests.map((test) => `${test.suite}#${test.name}`).join("\n")}\n`;
  }
  const classes = unique(tests.map((test) => test.suite || test.file));
  const body = classes.map((name) => `      <class name="${escapeXml(name)}"/>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<suite name="release-impact">\n  <test name="selected">\n    <classes>\n${body}\n    </classes>\n  </test>\n</suite>\n`;
}

function pushTests(lines: string[], title: string, tests: SelectedTest[]): void {
  lines.push("", `## ${title}`, "");
  if (tests.length === 0) {
    lines.push("None.");
    return;
  }
  for (const test of tests) {
    lines.push(`- ${test.id}: ${test.name}`);
    lines.push(`  - ${test.file}`);
    lines.push(`  - ${test.reason}`);
    for (const cite of test.evidence) lines.push(`  - ${cite}`);
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
