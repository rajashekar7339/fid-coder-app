// Tests the persistent Jira diagnostics log and token redaction.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

test("writes clear Jira warnings without printing the token", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-jira-log-"));
  const previous = process.env.FID_CODER_USER_DATA;
  process.env.FID_CODER_USER_DATA = dir;
  try {
    const {
      logJiraStatus,
      logJiraToolFailure,
      logJiraSettingsChange,
    } = require("../../dist/main/log.js");

    logJiraStatus({ site: null, hasToken: false, agentName: "JIRA Agent" }, { force: true });
    logJiraStatus(
      { site: "https://jira.example.com", hasToken: false, hasCookie: true },
      { force: true },
    );
    logJiraToolFailure(
      "JIRA Agent",
      "jira_search",
      "Jira rejected the token. Bearer super-secret-token. Use the browser tools instead.",
      { site: "https://example.atlassian.net", hasToken: true, hasCookie: false },
    );
    logJiraSettingsChange("token saved", null, true);

    const file = path.join(dir, "logs", "fid-coder.log");
    assert.equal(fs.existsSync(file), true);
    const text = fs.readFileSync(file, "utf8");
    assert.match(
      text,
      /Jira tools disabled for "JIRA Agent": the site URL is missing and no personal access token or browser session is saved/,
    );
    assert.match(text, /Jira tools enabled: site=https:\/\/jira\.example\.com token=missing cookie=present/);
    assert.match(text, /Jira tool jira_search failed for "JIRA Agent"/);
    assert.match(text, /site=https:\/\/example\.atlassian\.net token=present cookie=missing/);
    assert.match(text, /Jira settings token saved: site=missing token=present cookie=missing/);
    assert.match(text, /Token file: .*secrets\.bin\.json \(missing\)/);
    assert.match(text, /\[redacted\]/);
    assert.doesNotMatch(text, /super-secret-token/);
  } finally {
    if (previous === undefined) delete process.env.FID_CODER_USER_DATA;
    else process.env.FID_CODER_USER_DATA = previous;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
