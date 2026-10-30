import assert from "node:assert/strict";
import test from "node:test";
import {
  formatJiraIssue,
  formatJiraIssues,
  formatJiraMyself,
  jiraBaseUrl,
  jiraConfigError,
  jiraSearchBody,
  jiraToolsReady,
} from "../src/tools/jira/jira-format.ts";

test("uses the site origin and caps a search at 20 issues", () => {
  assert.equal(jiraBaseUrl("https://fid.atlassian.net/jira/software").origin, "https://fid.atlassian.net");
  const body = jiraSearchBody("  assignee = currentUser()  ");
  assert.equal(body.maxResults, 20);
  assert.equal(body.jql, "assignee = currentUser()");
  assert.deepEqual(body.fields, ["summary", "status", "assignee"]);
  assert.throws(() => jiraSearchBody("x".repeat(2001)), /JQL is too long/);
});

test("shapes search, issue, and account fixtures", () => {
  const search = formatJiraIssues({
    issues: [
      {
        key: "PROJ-4",
        fields: { summary: "Login fails", status: { name: "In Progress" }, assignee: { displayName: "Ada" } },
      },
      { key: "PROJ-5", fields: { summary: "Empty owner", status: { name: "Open" }, assignee: null } },
    ],
  });
  assert.equal(search, "PROJ-4 [In Progress] Login fails — Ada\nPROJ-5 [Open] Empty owner — Unassigned");
  assert.equal(formatJiraIssues({ issues: [] }), "No issues matched.");

  const issue = formatJiraIssue({
    key: "proj-9",
    fields: {
      summary: "Write the notes",
      status: { name: "Done" },
      assignee: { displayName: "Grace" },
      description: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ship it." }] }] },
      comment: {
        comments: [
          { author: { displayName: "Ada" }, body: "First" },
          { author: { displayName: "Grace" }, body: { type: "doc", content: [{ type: "paragraph", content: [{ text: "Second" }] }] } },
        ],
      },
    },
  });
  assert.match(issue, /^PROJ-9: Write the notes/);
  assert.match(issue, /Status: Done/);
  assert.match(issue, /Description:\nShip it\./);
  assert.match(issue, /- Grace: Second/);

  assert.equal(formatJiraMyself({ displayName: "Ada Lovelace", emailAddress: "ada@example.com", accountId: "abc" }), "Ada Lovelace — ada@example.com — abc");
});

test("names Settings when Jira is not configured", () => {
  assert.match(jiraConfigError(null, null) ?? "", /Settings → Jira/);
  assert.equal(jiraConfigError("https://fid.atlassian.net", "token"), null);
});

test("Jira tools need both the site and a token", () => {
  assert.equal(jiraToolsReady("https://fid.atlassian.net", true), true);
  assert.equal(jiraToolsReady("", true), false);
  assert.equal(jiraToolsReady("https://fid.atlassian.net", false), false);
});
