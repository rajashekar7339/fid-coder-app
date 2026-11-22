import assert from "node:assert/strict";
import test from "node:test";
import {
  DEEPSEEK_DEFAULT_MODEL,
  defaultModelForProvider,
  isDeepseekModel,
  modelsForProvider,
  normalizeAgentProvider,
  normalizeProvider,
  providerModel,
  providerSupportsVision,
  readProvider,
  readProviderModel,
} from "../../src/shared/providers.ts";
import { AUTO_MODEL_ID } from "../../src/shared/model.ts";

test("the provider defaults to Copilot and rejects an unknown explicit value", () => {
  assert.equal(normalizeProvider(undefined), "copilot");
  assert.equal(normalizeProvider(""), "copilot");
  assert.equal(normalizeProvider("deepseek"), "deepseek");
  assert.throws(() => normalizeProvider("openai"), /Copilot or DeepSeek/);
  assert.equal(readProvider("damaged"), "copilot");
});

test("DeepSeek models are explicit and listed", () => {
  assert.equal(providerModel("deepseek", undefined), DEEPSEEK_DEFAULT_MODEL);
  assert.equal(providerModel("deepseek", "auto"), DEEPSEEK_DEFAULT_MODEL);
  assert.equal(providerModel("deepseek", "deepseek-reasoner"), "deepseek-reasoner");
  assert.throws(() => providerModel("deepseek", "gpt-5"), /Choose a DeepSeek model/);
  assert.equal(providerModel("copilot", "claude-haiku-4.5"), "claude-haiku-4.5");
  assert.equal(providerModel("copilot", undefined), AUTO_MODEL_ID);
  assert.equal(isDeepseekModel("deepseek-chat"), true);
  assert.equal(isDeepseekModel("gpt-5"), false);
});

test("stored values fall back safely and a DeepSeek model implies its provider", () => {
  assert.equal(readProviderModel("deepseek", "gpt-5"), DEEPSEEK_DEFAULT_MODEL);
  assert.equal(readProviderModel("deepseek", "deepseek-reasoner"), "deepseek-reasoner");
  assert.equal(readProviderModel("copilot", "auto"), AUTO_MODEL_ID);
  assert.equal(readProviderModel("copilot", "claude-sonnet-4.5"), "claude-sonnet-4.5");
  assert.equal(normalizeAgentProvider(undefined, "deepseek-chat"), "deepseek");
  assert.equal(normalizeAgentProvider(undefined, "auto"), "copilot");
  assert.equal(normalizeAgentProvider("deepseek", "auto"), "deepseek");
  assert.throws(() => normalizeAgentProvider("openai", "auto"), /Copilot or DeepSeek/);
});

test("provider defaults and model filtering follow the provider", () => {
  assert.equal(defaultModelForProvider("copilot"), AUTO_MODEL_ID);
  assert.equal(defaultModelForProvider("deepseek"), DEEPSEEK_DEFAULT_MODEL);
  assert.equal(providerSupportsVision("copilot"), true);
  assert.equal(providerSupportsVision("deepseek"), false);
  assert.equal(providerSupportsVision("deepseek", "deepseek-flash"), true);
  assert.equal(providerSupportsVision("deepseek", "deepseek-v4-pro"), false);
  assert.equal(providerSupportsVision("deepseek", "deepseek-chat"), false);
  const models = [
    { id: "auto", name: "Auto", provider: "copilot" as const },
    { id: "deepseek-chat", name: "DeepSeek Chat", provider: "deepseek" as const },
    { id: "legacy", name: "Legacy" },
  ];
  assert.deepEqual(
    modelsForProvider(models, "deepseek").map((model) => model.id),
    ["deepseek-chat"],
  );
  assert.deepEqual(
    modelsForProvider(models, "copilot").map((model) => model.id),
    ["auto", "legacy"],
  );
});
