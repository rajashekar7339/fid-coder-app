// Datadog browser-mode tools against a fake captured response.
const assert = require("node:assert/strict");
const test = require("node:test");
const { datadogBrowserTools } = require("../../dist/tools/datadog/browser.js");

const browserLogsTool = datadogBrowserTools.find((tool) => tool.name === "datadog_browser_logs");
const browserPatternsTool = datadogBrowserTools.find(
  (tool) => tool.name === "datadog_browser_error_summary",
);

function logItem(overrides = {}) {
  return {
    id: "log-1",
    type: "log",
    attributes: {
      timestamp: "2026-11-20T14:12:03.461Z",
      message: "TypeError: Cannot read properties of undefined (reading 'price')",
      service: "checkout-api",
      host: "checkout-7f9c",
      status: "error",
      tags: ["env:prod", "version:2.14.0"],
      attributes: {
        error: {
          kind: "TypeError",
          message: "Cannot read properties of undefined (reading 'price')",
          stack:
            "TypeError: Cannot read properties of undefined (reading 'price')\n    at applyDiscount (src/checkout.ts:42:18)\n    at handler (src/server.ts:88:5)",
        },
        http: { status_code: 500, method: "POST", url: "/api/v1/checkout" },
        trace_id: "trace-abc",
        "logger.name": "checkout.handler",
      },
      ...overrides,
    },
  };
}

function context(capture) {
  return {
    agentId: "agent-1",
    workspaceDir: null,
    browser: { capture },
    githubPat: null,
    jiraToken: null,
    jiraSite: null,
    confluenceToken: null,
    confluenceSite: null,
    confluenceEmail: null,
    confluenceMode: "data-center",
    datadogUrl: "http://127.0.0.1:9999",
    log: () => undefined,
  };
}

test("datadog_browser_logs captures a page response without keys", async () => {
  let captured = null;
  const ctx = context(async (agentId, url, options) => {
    captured = { agentId, url, options };
    return {
      pageUrl: url,
      responses: [
        {
          url: "http://127.0.0.1:9999/api/ui/logs",
          method: "POST",
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: [logItem()] }),
        },
      ],
    };
  });
  const output = await browserLogsTool.handler(
    { query: "service:checkout-api status:error", from: "30m" },
    ctx,
  );
  assert.match(output, /Source: Datadog browser page/);
  assert.match(output, /Returned 1 log/);
  assert.match(output, /checkout-api/);
  assert.match(output, /trace=trace-abc/);
  assert.match(output, /http=POST 500 \/api\/v1\/checkout/);
  assert.match(output, /applyDiscount \(src\/checkout\.ts:42:18\)/);
  assert.equal(captured.agentId, "agent-1");
  assert.match(captured.url, /\/logs\?/);
  assert.match(captured.url, /query=service%3Acheckout-api/);
  assert.match(captured.url, /from_ts=\d+/);
  assert.equal(captured.options.allowedOrigins[0], "http://127.0.0.1:9999");
});

test("datadog_browser_logs reads an internal content-shaped response", async () => {
  const ctx = context(async (url) => ({
    pageUrl: url,
    responses: [
      {
        url: "http://127.0.0.1:9999/api/ui/logs",
        method: "POST",
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          logs: [
            {
              id: "internal-1",
              content: {
                timestamp: "2026-11-20T14:12:03.461Z",
                message: "TypeError: Cannot read properties of undefined",
                service: "checkout-api",
                tags: ["env:prod"],
              },
            },
          ],
        }),
      },
    ],
  }));
  const output = await browserLogsTool.handler({ query: "service:checkout-api" }, ctx);
  assert.match(output, /Returned 1 log/);
  assert.match(output, /TypeError: Cannot read properties of undefined/);
});

test("datadog_browser_error_summary clusters the captured page", async () => {
  const ctx = context(async (url) => ({
    pageUrl: url,
    responses: [
      {
        url: "http://127.0.0.1:9999/api/ui/logs",
        method: "POST",
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          logs: [
            logItem(),
            logItem({
              timestamp: "2026-11-20T14:11:10.000Z",
              message: "order 456 failed: Cannot read properties of undefined (reading 'price')",
            }),
          ],
        }),
      },
    ],
  }));
  const output = await browserPatternsTool.handler({ from: "30m" }, ctx);
  assert.match(output, /Source: Datadog browser page/);
  assert.match(output, /Sampled 2 logs/);
  assert.match(output, /2x Cannot read properties of undefined/);
  assert.match(output, /src\/checkout\.ts:42:18/);
});

test("datadog_browser_logs explains a sign-in page", async () => {
  const ctx = context(async () => ({
    pageUrl: "https://login.microsoftonline.com/tenant/oauth2/authorize",
    responses: [],
  }));
  const output = await browserLogsTool.handler({ query: "service:checkout-api" }, ctx);
  assert.match(output, /sign-in page/);
  assert.match(output, /browser_needs_you/);
});

test("datadog_browser_logs lists captured endpoints when no rows are found", async () => {
  const ctx = context(async (url) => ({
    pageUrl: url,
    responses: [
      {
        url: "http://127.0.0.1:9999/api/ui/bootstrap",
        method: "GET",
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ user: "demo" }),
      },
    ],
  }));
  const output = await browserLogsTool.handler({ query: "service:checkout-api" }, ctx);
  assert.match(output, /No log rows were found/);
  assert.match(output, /GET http:\/\/127\.0\.0\.1:9999\/api\/ui\/bootstrap/);
  assert.match(output, /browser_snapshot/);
});

test("a capture failure is explained to the agent", async () => {
  const ctx = context(async () => {
    throw new Error("page.goto: Timeout 30000ms exceeded");
  });
  await assert.rejects(
    () => browserLogsTool.handler({ query: "service:checkout-api" }, ctx),
    /Datadog did not open: page\.goto: Timeout.*finish any sign-in/,
  );
});

test("a saved Datadog URL is required before browser capture", async () => {
  const ctx = { ...context(async () => ({ pageUrl: "", responses: [] })), datadogUrl: "" };
  await assert.rejects(
    () => browserLogsTool.handler({ query: "service:checkout-api" }, ctx),
    /Datadog URL/,
  );
});
