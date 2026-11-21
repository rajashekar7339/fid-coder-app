import assert from "node:assert/strict";
import test from "node:test";
import { toolGroupSummary, workDurationLabel } from "../../src/shared/summary.ts";

function item(name: string, label = name) {
  return { name, label };
}

test("tool groups are counted by what they did", () => {
  assert.equal(
    toolGroupSummary([
      item("file_read", "Read a file"),
      item("file_read", "Read a file"),
      item("search_text", "Searched the code"),
      item("shell_run", "Ran a shell command"),
    ]),
    "Read 2 files · Searched the code · Ran 1 command",
  );
  assert.equal(
    toolGroupSummary([
      item("file_write", "Wrote a file"),
      item("apply_patch", "Patched a file"),
    ]),
    "Changed 2 files",
  );
});

test("browser, git, pull request, and Jira work have their own words", () => {
  assert.equal(
    toolGroupSummary([
      item("browser_navigate", "Opened a page"),
      item("browser_snapshot", "Read the page"),
      item("browser_click", "Clicked an element"),
      item("git_diff", "Read the diff"),
      item("gh_pr_view", "Read a pull request"),
      item("jira_issue", "Read a Jira issue"),
    ]),
    "Opened 1 page · Read 1 page · Used the browser · Checked git · Read 1 pull request · Checked Jira",
  );
});

test("tools without a count keep their label once", () => {
  assert.equal(
    toolGroupSummary([
      item("ask_user", "Asked a question"),
      item("ask_user", "Asked a question"),
      item("read_many", "Read files"),
      item("save_skill", "Saved a skill"),
    ]),
    "Asked a question · Read files · Saved a skill",
  );
  assert.equal(toolGroupSummary([]), "");
});

test("tables and Confluence pages are counted too", () => {
  assert.equal(
    toolGroupSummary([
      item("table_read", "Read a table"),
      item("confluence_page", "Read a Confluence page"),
      item("confluence_page", "Read a Confluence page"),
    ]),
    "Read 1 table · Read 2 Confluence pages",
  );
});

test("a worked duration uses seconds, minutes, and hours", () => {
  assert.equal(
    workDurationLabel("2026-11-20T10:00:00.000Z", "2026-11-20T10:00:05.000Z"),
    "Worked for 5s",
  );
  assert.equal(
    workDurationLabel("2026-11-20T10:00:00.000Z", "2026-11-20T10:02:05.000Z"),
    "Worked for 2m",
  );
  assert.equal(
    workDurationLabel("2026-11-20T10:00:00.000Z", "2026-11-20T11:05:00.000Z"),
    "Worked for 1h 5m",
  );
});

test("a live duration says Working for", () => {
  assert.equal(
    workDurationLabel("2026-11-20T10:00:00.000Z", null, Date.parse("2026-11-20T10:00:12.000Z")),
    "Working for 12s",
  );
  assert.equal(
    workDurationLabel("2026-11-20T10:00:00.000Z", null, Date.parse("2026-11-20T10:03:00.000Z")),
    "Working for 3m",
  );
});

test("a bad duration is left out", () => {
  assert.equal(workDurationLabel(null, "2026-11-20T10:00:00.000Z"), null);
  assert.equal(workDurationLabel("not a date", "2026-11-20T10:00:00.000Z"), null);
  assert.equal(
    workDurationLabel("2026-11-20T10:05:00.000Z", "2026-11-20T10:00:00.000Z"),
    null,
  );
});
