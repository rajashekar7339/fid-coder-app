// Native Confluence read/update tools against a local fake REST server.
const assert = require("node:assert/strict");
const http = require("node:http");
const test = require("node:test");
const { confluenceTools } = require("../../dist/tools/confluence/confluence.js");

const search = confluenceTools.find((tool) => tool.name === "confluence_search");
const pageTool = confluenceTools.find((tool) => tool.name === "confluence_page");
const update = confluenceTools.find((tool) => tool.name === "confluence_update_page");

function page(state) {
  return {
    id: "p1",
    type: "page",
    title: "Release notes",
    space: { key: "DOCS", name: "Docs" },
    version: { number: state.version },
    body: {
      storage: { value: state.storage },
      view: { value: state.storage },
    },
    _links: { webui: "/spaces/DOCS/pages/p1" },
  };
}

async function startServer() {
  const state = {
    version: 3,
    storage: "<h1>Release</h1><p>Alpha &amp; beta</p>",
    requests: [],
    authorization: null,
  };
  const server = http.createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    const route = url.pathname.replace(/^\/wiki(?=\/rest\/)/, "");
    let body = "";
    for await (const chunk of request) body += chunk;
    state.requests.push({ method: request.method, path: url.pathname, query: url.search, body });
    state.authorization = request.headers.authorization ?? null;
    response.setHeader("content-type", "application/json");
    if (request.method === "GET" && route === "/x/live") {
      response.statusCode = 302;
      response.setHeader("location", "/spaces/DOCS/pages/p1");
      response.end();
      return;
    }
    if (request.method === "GET" && route === "/rest/api/content/search") {
      response.end(
        JSON.stringify({
          results: [
            {
              ...page(state),
              id: "p1",
            },
          ],
        }),
      );
      return;
    }
    if (request.method === "GET" && route === "/rest/api/content") {
      response.end(JSON.stringify({ results: [page(state)] }));
      return;
    }
    if (request.method === "GET" && route === "/rest/api/content/p1") {
      response.end(JSON.stringify(page(state)));
      return;
    }
    if (request.method === "PUT" && route === "/rest/api/content/p1") {
      const parsed = JSON.parse(body);
      state.version = parsed.version.number;
      state.storage = parsed.body.storage.value;
      response.end(JSON.stringify({ ...page(state), version: { number: state.version } }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ message: "not found" }));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  return {
    state,
    port: address.port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function context(port, extra = {}) {
  return {
    workspaceDir: null,
    confluenceSite: `http://127.0.0.1:${port}`,
    confluenceEmail: null,
    confluenceMode: "data-center",
    confluenceToken: "secret-token",
    requestApproval: async () => ({
      approved: true,
      decision: "allow",
      source: "user",
      reason: "",
    }),
    log: () => undefined,
    ...extra,
  };
}

test("confluence_search returns page metadata", async () => {
  const server = await startServer();
  try {
    const output = await search.handler(
      { cql: "space = DOCS AND title ~ release", limit: 5 },
      context(server.port),
    );
    assert.match(output, /\[DOCS\] Release notes/);
    assert.match(output, /id=p1/);
    assert.match(output, /v3/);
    assert.match(server.state.requests[0].query, /cql=space%20%3D%20DOCS/);
    assert.equal(server.state.authorization, "Bearer secret-token");
  } finally {
    await server.close();
  }
});

test("confluence_page returns readable text and storage", async () => {
  const server = await startServer();
  try {
    const text = await pageTool.handler({ id: "p1" }, context(server.port));
    assert.match(text, /# Release notes/);
    assert.match(text, /version: 3/);
    assert.match(text, /Alpha & beta/);
    const storage = await pageTool.handler({ id: "p1", format: "storage" }, context(server.port));
    assert.match(storage, /Storage:/);
    assert.match(storage, /<h1>Release<\/h1>/);
  } finally {
    await server.close();
  }
});

test("confluence_page resolves a pasted short link on the saved site", async () => {
  const server = await startServer();
  try {
    const url = `http://127.0.0.1:${server.port}/x/live`;
    const output = await pageTool.handler({ url }, context(server.port));
    assert.match(output, /# Release notes/);
    assert.match(output, /version: 3/);
    assert.equal(
      server.state.requests.some((request) => request.path === "/x/live"),
      true,
    );
    assert.equal(server.state.authorization, "Bearer secret-token");
  } finally {
    await server.close();
  }
});

test("confluence_page reads a Data Center display link by space and title", async () => {
  const server = await startServer();
  try {
    const url = `http://127.0.0.1:${server.port}/display/DOCS/Release+notes`;
    const output = await pageTool.handler({ url }, context(server.port));
    assert.match(output, /# Release notes/);
    const lookup = server.state.requests.find(
      (request) => request.method === "GET" && request.path === "/rest/api/content",
    );
    assert.ok(lookup, "the title lookup was requested");
    assert.match(lookup.query, /spaceKey=DOCS/);
    assert.match(lookup.query, /title=Release\+notes|title=Release%20notes/);
  } finally {
    await server.close();
  }
});

test("a Confluence link outside the saved site is refused", async () => {
  const server = await startServer();
  try {
    await assert.rejects(
      () => pageTool.handler({ url: "https://other.example/wiki/spaces/DOC/pages/1" }, context(server.port)),
      /configured Confluence site/,
    );
    assert.equal(server.state.requests.length, 0);
  } finally {
    await server.close();
  }
});

test("an unknown same-site link is not fetched", async () => {
  const server = await startServer();
  try {
    await assert.rejects(
      () => pageTool.handler({ url: `http://127.0.0.1:${server.port}/not-a-page` }, context(server.port)),
      /did not resolve to a Confluence page/,
    );
    assert.equal(server.state.requests.length, 0);
  } finally {
    await server.close();
  }
});

test("confluence_update_page appends Markdown after approval", async () => {
  const server = await startServer();
  try {
    let approval = null;
    const ctx = context(server.port, {
      requestApproval: async (request) => {
        approval = request;
        return { approved: true, decision: "allow", source: "user", reason: "" };
      },
    });
    const output = await update.handler(
      {
        id: "p1",
        body: "**Added** after review.",
        expectedVersion: 3,
        format: "markdown",
        mode: "append",
      },
      ctx,
    );
    assert.match(output, /Updated "Release notes" in DOCS to version 4/);
    assert.match(approval.command, /Release notes/);
    assert.match(approval.command, /v3 → v4/);
    const put = server.state.requests.find((request) => request.method === "PUT");
    assert.ok(put, "the page was written");
    const payload = JSON.parse(put.body);
    assert.equal(payload.version.number, 4);
    assert.match(payload.body.storage.value, /<h1>Release<\/h1>/);
    assert.match(payload.body.storage.value, /<strong>Added<\/strong> after review\./);
  } finally {
    await server.close();
  }
});

test("a stale version is refused before approval or writing", async () => {
  const server = await startServer();
  try {
    let approvals = 0;
    const ctx = context(server.port, {
      requestApproval: async () => {
        approvals += 1;
        return { approved: true, decision: "allow", source: "user", reason: "" };
      },
    });
    await assert.rejects(
      () =>
        update.handler(
          { id: "p1", body: "new", expectedVersion: 2, mode: "append" },
          ctx,
        ),
      /now version 3/,
    );
    assert.equal(approvals, 0);
    assert.equal(server.state.requests.some((request) => request.method === "PUT"), false);
  } finally {
    await server.close();
  }
});

test("a macro page is not replaced through Markdown", async () => {
  const server = await startServer();
  try {
    server.state.storage =
      '<p>Intro</p><ac:structured-macro ac:name="toc"><ac:parameter ac:name="maxLevel">3</ac:parameter></ac:structured-macro>';
    let approvals = 0;
    const ctx = context(server.port, {
      requestApproval: async () => {
        approvals += 1;
        return { approved: true, decision: "allow", source: "user", reason: "" };
      },
    });
    await assert.rejects(
      () =>
        update.handler(
          { id: "p1", body: "# New", expectedVersion: 3, format: "markdown", mode: "replace" },
          ctx,
        ),
      /contains Confluence macros/,
    );
    assert.equal(approvals, 0);
    assert.equal(server.state.requests.some((request) => request.method === "PUT"), false);
  } finally {
    await server.close();
  }
});

test("a denied update writes nothing", async () => {
  const server = await startServer();
  try {
    const ctx = context(server.port, {
      requestApproval: async () => ({
        approved: false,
        decision: "deny",
        source: "user",
        reason: "not now",
      }),
    });
    const output = await update.handler(
      { id: "p1", body: "new", expectedVersion: 3, mode: "append" },
      ctx,
    );
    assert.match(output, /Not updated/);
    assert.equal(server.state.requests.some((request) => request.method === "PUT"), false);
  } finally {
    await server.close();
  }
});

test("Cloud Confluence uses Basic auth with the account email", async () => {
  const server = await startServer();
  try {
    await pageTool.handler(
      { id: "p1" },
      context(server.port, {
        confluenceMode: "cloud",
        confluenceEmail: "me@example.com",
      }),
    );
    const expected = `Basic ${Buffer.from("me@example.com:secret-token").toString("base64")}`;
    assert.equal(server.state.authorization, expected);
  } finally {
    await server.close();
  }
});
