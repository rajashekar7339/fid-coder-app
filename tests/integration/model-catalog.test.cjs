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

test("model menu uses the session list, or price categories when that list is empty", () => {
  const priced = catalogModels({
    clientModels: [{ id: "auto", name: "Auto" }],
    sessionModels: [],
    priceCategories: [
      { id: "gpt-4o", priceCategory: "medium" },
      { id: "gpt-5.6-luna-free-auto", priceCategory: "low" },
      { id: "claude-haiku-4.5", priceCategory: "low" },
    ],
  });
  assert.deepEqual(
    priced.map((model) => model.id),
    ["gpt-4o", "claude-haiku-4.5"],
  );
  assert.equal(priced[0].name, "gpt-4o · Medium cost");

  const named = catalogModels({
    sessionModels: [
      { id: "gpt-5.4", name: "GPT-5.4" },
      { id: "old", name: "Old", policy: { state: "disabled" } },
    ],
    priceCategories: [{ id: "gpt-4o", priceCategory: "medium" }],
  });
  assert.deepEqual(
    named.map((model) => model.id),
    ["gpt-5.4"],
  );
});
