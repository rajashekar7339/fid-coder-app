// Tests the DeepSeek provider without a live model call:
// stored provider/model migration, environment key resolution, and the
// provider config passed to the Copilot runtime.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-deepseek-provider-"));
process.env.FID_CODER_USER_DATA = path.join(root, "userdata");
delete process.env.FID_CODER_DEEPSEEK_API_KEY;
delete process.env.DEEP_SEEK_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.FID_CODER_DEEPSEEK_BASE_URL;

const { AppDatabase } = require("../../dist/main/db/index.js");
const {
  DEEPSEEK_DEFAULT_MODEL,
  normalizeAgentProvider,
  providerModel,
  readProvider,
} = require("../../dist/shared/providers.js");
const {
  deepseekBaseUrl,
  deepseekKeySource,
  deepseekProviderConfig,
  listDeepseekModels,
  testDeepseekKey,
} = require("../../dist/main/providers/deepseek.js");

function tempDb(name) {
  return path.join(root, `${name}.sqlite`);
}

function agentInput(overrides = {}) {
  return {
    name: "DeepSeek test",
    description: "",
    systemPrompt: "Test agent",
    workspaceDir: null,
    model: DEEPSEEK_DEFAULT_MODEL,
    toolProfile: "developer",
    readOnly: true,
    memoryEnabled: false,
    ...overrides,
  };
}

test("a new agent stores its provider and defaults a DeepSeek model", () => {
  const file = tempDb("new");
  const db = new AppDatabase(file);
  const deepseek = db.createAgent(agentInput({ provider: "deepseek", model: "auto" }));
  assert.equal(deepseek.provider, "deepseek");
  assert.equal(deepseek.model, DEEPSEEK_DEFAULT_MODEL);

  const copilot = db.createAgent(agentInput({ name: "Copilot test", model: "auto" }));
  assert.equal(copilot.provider, "copilot");
  assert.equal(copilot.model, "auto");

  const updated = db.updateAgent(copilot.id, agentInput({
    name: copilot.name,
    provider: "deepseek",
    model: "deepseek-reasoner",
  }));
  assert.equal(updated.provider, "deepseek");
  assert.equal(updated.model, "deepseek-reasoner");
  db.close();
});

test("an old agents table gains the provider column with a Copilot default", () => {
  const file = tempDb("old");
  const { DatabaseSync } = require("node:sqlite");
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      system_prompt TEXT NOT NULL,
      workspace_dir TEXT,
      model TEXT NOT NULL DEFAULT 'auto',
      tool_profile TEXT NOT NULL DEFAULT 'all',
      read_only INTEGER NOT NULL DEFAULT 0,
      memory_summary TEXT NOT NULL DEFAULT '',
      memory_turn_count INTEGER NOT NULL DEFAULT 0,
      memory_enabled INTEGER NOT NULL DEFAULT 1,
      pinned INTEGER NOT NULL DEFAULT 0,
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  raw.close();

  const db = new AppDatabase(file);
  const columns = db.listAgents();
  assert.ok(columns.length > 0);
  assert.ok(columns.every((agent) => agent.provider === "copilot"));
  assert.equal(readProvider("deepseek"), "deepseek");
  db.close();
});

test("provider and model validation rejects a mismatched pair", () => {
  assert.equal(normalizeAgentProvider(undefined, "deepseek-chat"), "deepseek");
  assert.throws(() => providerModel("deepseek", "gpt-5"), /Choose a DeepSeek model/);
  assert.throws(() => normalizeAgentProvider("openai", "auto"), /Copilot or DeepSeek/);
});

test("the environment key builds the BYOK provider config", () => {
  process.env.FID_CODER_DEEPSEEK_API_KEY = "sk-test-deepseek-key";
  assert.equal(deepseekKeySource(), "environment");
  assert.equal(deepseekBaseUrl(), "https://api.deepseek.com");
  const config = deepseekProviderConfig(DEEPSEEK_DEFAULT_MODEL);
  assert.equal(config.type, "openai");
  assert.equal(config.baseUrl, "https://api.deepseek.com");
  assert.equal(config.apiKey, "sk-test-deepseek-key");
  assert.equal(config.modelCapabilities.supports.toolCalls, true);
  assert.equal(config.modelCapabilities.supports.vision, true);
  const textOnly = deepseekProviderConfig("deepseek-v4-pro");
  assert.equal(textOnly.modelCapabilities.supports.vision, false);
  delete process.env.FID_CODER_DEEPSEEK_API_KEY;
});

test("the base URL can be overridden for a local gateway", () => {
  process.env.FID_CODER_DEEPSEEK_BASE_URL = "http://127.0.0.1:4000/v1/";
  assert.equal(deepseekBaseUrl(), "http://127.0.0.1:4000/v1");
  delete process.env.FID_CODER_DEEPSEEK_BASE_URL;
});

test("the key test reports success and a rejected key", async () => {
  let status = 200;
  const server = http.createServer((request, response) => {
    assert.equal(request.headers.authorization, "Bearer sk-test-key");
    response.statusCode = status;
    response.setHeader("content-type", "application/json");
    response.end(status === 200 ? JSON.stringify({ data: [{ id: "deepseek-chat" }] }) : "{}");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  process.env.FID_CODER_DEEPSEEK_API_KEY = "sk-test-key";
  process.env.FID_CODER_DEEPSEEK_BASE_URL = `http://127.0.0.1:${address.port}`;
  try {
    const ok = await testDeepseekKey();
    assert.equal(ok.ok, true);
    assert.match(ok.message, /1 models available/);
    const models = await listDeepseekModels();
    assert.deepEqual(models.map((model) => model.id), ["deepseek-chat"]);
    assert.equal(models[0].provider, "deepseek");

    status = 401;
    await assert.rejects(() => testDeepseekKey(), /rejected the API key/);
  } finally {
    delete process.env.FID_CODER_DEEPSEEK_API_KEY;
    delete process.env.FID_CODER_DEEPSEEK_BASE_URL;
    await new Promise((resolve) => server.close(resolve));
  }
});

process.on("exit", () => {
  fs.rmSync(root, { recursive: true, force: true });
});
