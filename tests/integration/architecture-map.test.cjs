// Checks the read-only project-map builder without spending Copilot quota.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const copilot = require("../../dist/main/copilot/index.js");
let opened = null;
copilot.openSession = async (input) => {
  opened = input;
  return {
    session: {
      sendAndWait: async () => ({ data: { content: "## Overview\nMapped." } }),
      on: () => () => {},
      disconnect: async () => undefined,
    },
    unsubscribe: () => {},
  };
};

const { architectureMapKey, buildArchitectureMap } = require("../../dist/main/workspace/architecture-map.js");

test("the project map uses read-only evidence and a bounded prompt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-architecture-map-"));
  try {
    fs.writeFileSync(path.join(root, "index.ts"), "export const app = true;\n");
    const context = {
      agentId: "agent-1",
      workspaceDir: root,
      model: "auto",
      browser: {},
      githubPat: null,
      jiraToken: null,
      jiraSite: null,
    };

    const map = await buildArchitectureMap(context);
    assert.match(map, /## Overview/);
    assert.ok(opened, "a Copilot session was opened");
    assert.match(opened.systemMessage, /## Suggested reading order/);
    assert.match(opened.systemMessage, /flowchart/);
    assert.match(opened.systemMessage, /at most 14 tool calls/);
    assert.equal(opened.tools.some((tool) => tool.name === "file_read"), true);
    assert.equal(opened.tools.some((tool) => tool.name === "apply_patch"), false);
    assert.equal(opened.tools.some((tool) => tool.name === "shell_run"), false);
    assert.equal(opened.tools.some((tool) => tool.name === "browser_navigate"), false);
    assert.equal(opened.getContext().review, undefined);
    assert.equal(opened.getContext().explore, undefined);

    assert.equal(await architectureMapKey(root), "no-git");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
