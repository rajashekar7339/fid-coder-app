// Tests the pure helpers behind Jira browser sign-in.

import assert from "node:assert/strict";
import test from "node:test";
import { jiraCookieHeader, jiraSessionName } from "../../src/shared/jira-auth.ts";

test("joins browser cookies into a Cookie header", () => {
  assert.equal(
    jiraCookieHeader([
      { name: "JSESSIONID", value: "abc" },
      { name: "atl-xsrf-token", value: "def" },
      { name: "JSESSIONID", value: "abc" },
      { name: " ", value: "ignored" },
    ]),
    "JSESSIONID=abc; atl-xsrf-token=def",
  );
  assert.equal(jiraCookieHeader([]), "");
});

test("reads the signed-in user from a /myself response", () => {
  assert.equal(jiraSessionName({ displayName: "Ada Lovelace", name: "ada" }), "Ada Lovelace");
  assert.equal(jiraSessionName({ name: "ada" }), "ada");
  assert.equal(jiraSessionName({ accountId: "abc-123" }), "abc-123");
  assert.equal(jiraSessionName({ key: "ada" }), "ada");
  assert.equal(jiraSessionName({ displayName: "  " }), null);
  assert.equal(jiraSessionName([]), null);
  assert.equal(jiraSessionName(null), null);
});
