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
