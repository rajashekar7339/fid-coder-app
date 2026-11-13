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
    assert.match(detail, new RegExp(`http://127\\.0\\.0\\.1:${port}/rest/api/2/myself`));
    assert.match(detail, /Sign in to continue/);
    assert.doesNotMatch(detail, /<html>|<title>|<body>/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("uses a Jira context path before the origin", async () => {
  const server = http.createServer((request, response) => {
    if (request.url?.startsWith("/jira/rest/api/3/myself")) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ displayName: "Ada Lovelace", emailAddress: "ada@example.com" }));
      return;
    }
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end("<html>root</html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const tool = jiraTools.find((item) => item.name === "jira_myself");
    assert.ok(tool);
    const result = await tool.handler(
      {},
      {
        jiraSite: `http://127.0.0.1:${port}/jira`,
        jiraToken: "test-token",
        log: () => undefined,
      },
    );
    assert.match(result, /Ada Lovelace/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("uses a saved browser session cookie", async () => {
  const cookies = [];
  const server = http.createServer((request, response) => {
    cookies.push(request.headers.cookie);
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ displayName: "Ada Lovelace", accountId: "abc" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const tool = jiraTools.find((item) => item.name === "jira_myself");
    assert.ok(tool);
    const result = await tool.handler(
      {},
      {
        jiraSite: `http://127.0.0.1:${port}`,
        jiraToken: null,
        jiraCookie: "JSESSIONID=test-session; atl-xsrf-token=test",
        log: () => undefined,
      },
    );
    assert.match(result, /Ada Lovelace/);
    assert.equal(cookies[0], "JSESSIONID=test-session; atl-xsrf-token=test");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("falls back to the token when the browser session is rejected", async () => {
  const server = http.createServer((request, response) => {
    if (request.headers.cookie) {
      response.writeHead(401, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ errorMessages: ["session expired"] }));
      return;
    }
    if (request.headers.authorization === "Bearer test-token") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ displayName: "Grace Hopper" }));
      return;
    }
    response.writeHead(401, { "Content-Type": "application/json" });
    response.end("{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const tool = jiraTools.find((item) => item.name === "jira_myself");
    assert.ok(tool);
    const logged = [];
    const result = await tool.handler(
      {},
      {
        jiraSite: `http://127.0.0.1:${port}`,
        jiraToken: "test-token",
        jiraCookie: "JSESSIONID=expired",
        log: (message) => logged.push(message),
      },
    );
    assert.match(result, /Grace Hopper/);
    assert.match(logged.join("\n"), /Jira rejected the browser session/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
