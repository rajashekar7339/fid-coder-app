// Tests that a Jira network failure explains the cause instead of only "fetch failed".

const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { jiraTools } = require("../../dist/tools/jira/jira.js");

test("a Jira fetch failure names the host and the underlying cause", async () => {
  const server = http.createServer((_request, response) => response.end("{}"));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise((resolve) => server.close(resolve));

  const tool = jiraTools.find((item) => item.name === "jira_myself");
  assert.ok(tool);
  const logged = [];
  await assert.rejects(
    () =>
      tool.handler(
        {},
        {
          jiraSite: `http://127.0.0.1:${port}`,
          jiraToken: "test-token",
          log: (message) => logged.push(message),
        },
      ),
    (error) => {
      const text = String(error);
      assert.match(text, /Jira is unavailable/);
      assert.doesNotMatch(text, /127\.0\.0\.1|ECONNREFUSED|fetch failed/);
      return true;
    },
  );
  const detail = logged.join("\n");
  assert.match(detail, new RegExp(`Jira could not reach http://127\\.0\\.0\\.1:${port}`));
  assert.match(detail, /fetch failed|ECONNREFUSED/);
});

test("a non-JSON Jira response logs the status, type, URL, and body snippet", async () => {
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end("<html><head><title>Log in</title></head><body>Sign in to continue</body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const tool = jiraTools.find((item) => item.name === "jira_myself");
    assert.ok(tool);
    const logged = [];
    await assert.rejects(
      () =>
        tool.handler(
          {},
          {
            jiraSite: `http://127.0.0.1:${port}`,
            jiraToken: "test-token",
            log: (message) => logged.push(message),
          },
        ),
      (error) => {
        const text = String(error);
        assert.match(text, /Jira is unavailable/);
        assert.doesNotMatch(text, /HTTP 200|text\/html|Sign in/);
        return true;
      },
    );
    const detail = logged.join("\n");
    assert.match(detail, /HTTP 200/);
    assert.match(detail, /text\/html/);
    assert.match(detail, new RegExp(`http://127\\.0\\.0\\.1:${port}/rest/api/3/myself`));
    assert.match(detail, /Sign in to continue/);
    assert.doesNotMatch(detail, /<html>|<title>|<body>/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
