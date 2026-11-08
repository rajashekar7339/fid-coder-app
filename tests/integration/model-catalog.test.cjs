// Tests model ID normalization and the model catalog shown in the picker.
const assert = require("node:assert/strict");
const test = require("node:test");
const { AUTO_MODEL_ID, catalogModels, isListedModelId, normalizeModelId } = require("../../dist/shared/model.js");

test("Auto is the default model id", () => {
  assert.equal(normalizeModelId(undefined), AUTO_MODEL_ID);
  assert.equal(normalizeModelId(""), AUTO_MODEL_ID);
  assert.equal(normalizeModelId(" AUTO "), AUTO_MODEL_ID);
  assert.equal(normalizeModelId("claude-sonnet-4.5"), "claude-sonnet-4.5");
  assert.equal(isListedModelId("auto"), false);
  assert.equal(isListedModelId("gpt-5.4"), true);
  assert.throws(() => normalizeModelId("not a model"), /available model/);
});

test("model menu uses only session models, with a client fallback when the session catalog is unavailable", () => {
  const session = catalogModels({
    sessionCatalogAvailable: true,
    sessionModels: [
      { id: "gpt-5.4", name: "GPT-5.4" },
      { id: "old", name: "Old", policy: { state: "disabled" } },
    ],
    clientModels: [{ id: "claude-haiku-4.5", name: "Claude Haiku" }],
  });
  assert.deepEqual(
    session.map((model) => model.id),
    ["gpt-5.4"],
  );

  const empty = catalogModels({
    sessionCatalogAvailable: true,
    sessionModels: [],
    clientModels: [{ id: "claude-haiku-4.5", name: "Claude Haiku" }],
  });
  assert.deepEqual(empty, []);

  const fallback = catalogModels({
    sessionCatalogAvailable: false,
    clientModels: [{ id: "claude-haiku-4.5", name: "Claude Haiku" }],
  });
  assert.deepEqual(
    fallback.map((model) => model.id),
    ["claude-haiku-4.5"],
  );
});
