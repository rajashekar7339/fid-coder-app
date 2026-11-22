import { DEEPSEEK_BASE_URL, DEEPSEEK_MODELS, providerSupportsVision } from "../../shared/providers";
import type { CopilotModel } from "../../shared/types";
import { getSecret, hasSecret, secretKeys } from "../secrets";

const ENV_KEYS = ["FID_CODER_DEEPSEEK_API_KEY", "DEEP_SEEK_API_KEY", "DEEPSEEK_API_KEY"] as const;
const TEST_TIMEOUT_MS = 15_000;
const MODELS_TIMEOUT_MS = 5_000;
const MODELS_TTL_MS = 60_000;

let modelsCache: { at: number; key: string; models: CopilotModel[] } | null = null;

export type DeepseekKeySource = "saved" | "environment" | null;

export function deepseekBaseUrl(): string {
  const override = process.env.FID_CODER_DEEPSEEK_BASE_URL?.trim();
  return (override || DEEPSEEK_BASE_URL).replace(/\/+$/, "");
}

function environmentKey(): string | null {
  for (const key of ENV_KEYS) {
    const value = process.env[key]?.trim();
    if (value) return value;
  }
  return null;
}

export function deepseekKeySource(): DeepseekKeySource {
  try {
    if (hasSecret(secretKeys.deepseek)) {
      const saved = getSecret(secretKeys.deepseek);
      if (saved?.trim()) return "saved";
    }
  } catch {
    // A broken secrets file falls through to the environment.
  }
  return environmentKey() ? "environment" : null;
}

export function deepseekKey(): string | null {
  try {
    if (hasSecret(secretKeys.deepseek)) {
      const saved = getSecret(secretKeys.deepseek);
      if (saved?.trim()) return saved.trim();
    }
  } catch {
    // Fall through to the environment for tests and local development.
  }
  return environmentKey();
}

export function hasDeepseekKey(): boolean {
  return Boolean(deepseekKey());
}

/**
 * The Copilot runtime's BYOK shape for DeepSeek. The key stays in the main
 * process and is only handed to the runtime for this session.
 */
export function deepseekProviderConfig(model: string): Record<string, unknown> {
  const apiKey = deepseekKey();
  if (!apiKey) throw new Error("Add a DeepSeek API key in Settings → DeepSeek.");
  return {
    type: "openai",
    baseUrl: deepseekBaseUrl(),
    apiKey,
    modelCapabilities: {
      supports: { toolCalls: true, vision: providerSupportsVision("deepseek", model) },
    },
  };
}

function fallbackModels(): CopilotModel[] {
  return DEEPSEEK_MODELS.map((model) => ({
    id: model.id,
    name: model.name,
    provider: "deepseek",
  }));
}

/** Prefer the models the key reports; fall back to the static catalog. */
export async function listDeepseekModels(): Promise<CopilotModel[]> {
  const fallback = fallbackModels();
  const apiKey = deepseekKey();
  if (!apiKey) return fallback;
  if (modelsCache && modelsCache.key === apiKey && Date.now() - modelsCache.at < MODELS_TTL_MS) {
    return modelsCache.models;
  }
  try {
    const response = await fetch(`${deepseekBaseUrl()}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
    if (!response.ok) return fallback;
    const body = (await response.json().catch(() => null)) as {
      data?: Array<{ id?: unknown; name?: unknown }>;
    } | null;
    const models: CopilotModel[] = [];
    for (const item of body?.data ?? []) {
      if (typeof item?.id !== "string" || !item.id.trim()) continue;
      const id = item.id.trim();
      const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : id;
      models.push({ id, name, provider: "deepseek" });
    }
    const result = models.length > 0 ? models : fallback;
    modelsCache = { at: Date.now(), key: apiKey, models: result };
    return result;
  } catch {
    return fallback;
  }
}

export async function testDeepseekKey(): Promise<{ ok: boolean; message: string }> {
  const apiKey = deepseekKey();
  if (!apiKey) throw new Error("Add a DeepSeek API key first.");
  let response: Response;
  try {
    response = await fetch(`${deepseekBaseUrl()}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TEST_TIMEOUT_MS),
    });
  } catch {
    throw new Error("DeepSeek could not be reached. Check the network and try again.");
  }
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as { data?: unknown[] } | null;
    const count = Array.isArray(body?.data) ? body.data.length : 0;
    return { ok: true, message: count > 0 ? `DeepSeek key works. ${count} models available.` : "DeepSeek key works." };
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("DeepSeek rejected the API key. Save a valid key and try again.");
  }
  if (response.status === 402) {
    throw new Error("DeepSeek says the account has no balance.");
  }
  if (response.status === 429) {
    throw new Error("DeepSeek is rate-limiting requests. Try again later.");
  }
  throw new Error(`DeepSeek returned HTTP ${response.status}.`);
}
