import type { ProviderId } from "./types";

const AUTO_MODEL_ID = "auto";
const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,119}$/;

export const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
export const DEEPSEEK_DEFAULT_MODEL = "deepseek-flash";

export type DeepseekModel = { id: string; name: string; vision: boolean };

/** Static fallback; the key's /models list is used when it is reachable. */
export const DEEPSEEK_MODELS: ReadonlyArray<DeepseekModel> = [
  { id: "deepseek-flash", name: "DeepSeek Flash", vision: true },
  { id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", vision: false },
];

export type ProviderInfo = {
  id: ProviderId;
  label: string;
  note: string;
  auto: boolean;
  auth: "copilot" | "api-key";
  models: ReadonlyArray<{ id: string; name: string }>;
};

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: "copilot",
    label: "GitHub Copilot",
    note: "Your Copilot account and quota.",
    auto: true,
    auth: "copilot",
    models: [],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    note: "Your own DeepSeek API key. Prompts leave this PC.",
    auto: false,
    auth: "api-key",
    models: DEEPSEEK_MODELS,
  },
];

export function isProviderId(value: unknown): value is ProviderId {
  return value === "copilot" || value === "deepseek";
}

export function normalizeProvider(value: unknown): ProviderId {
  if (value === undefined || value === null || value === "") return "copilot";
  if (!isProviderId(value)) throw new Error("Choose Copilot or DeepSeek.");
  return value;
}

/** Read a stored provider; old or damaged rows fall back to Copilot. */
export function readProvider(value: unknown): ProviderId {
  return isProviderId(value) ? value : "copilot";
}

export function providerInfo(id: ProviderId): ProviderInfo {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0]!;
}

export function providerLabel(id: ProviderId): string {
  return providerInfo(id).label;
}

export function providerHasAuto(id: ProviderId): boolean {
  return providerInfo(id).auto;
}

export function providerSupportsVision(id: ProviderId, model?: unknown): boolean {
  if (id !== "deepseek") return true;
  return DEEPSEEK_MODELS.find((entry) => entry.id === model)?.vision === true;
}

export function defaultModelForProvider(id: ProviderId): string {
  return id === "deepseek" ? DEEPSEEK_DEFAULT_MODEL : AUTO_MODEL_ID;
}

const DEEPSEEK_MODEL_ID = /^deepseek-[a-z0-9][a-z0-9._-]{0,100}$/i;

/** Accept the current models and legacy aliases; the API validates the ID. */
export function isDeepseekModel(value: unknown): boolean {
  return typeof value === "string" && DEEPSEEK_MODEL_ID.test(value.trim());
}

export function modelsForProvider<T extends { provider?: ProviderId }>(
  models: readonly T[],
  provider: ProviderId,
): T[] {
  return models.filter((model) => (model.provider ?? "copilot") === provider);
}

/** Validate a model for a provider. DeepSeek needs an explicit listed model. */
export function providerModel(provider: ProviderId, model: unknown): string {
  if (provider === "deepseek") {
    const id = typeof model === "string" ? model.trim() : "";
    if (!id || id.toLowerCase() === AUTO_MODEL_ID) return DEEPSEEK_DEFAULT_MODEL;
    if (!isDeepseekModel(id)) {
      throw new Error("Choose a DeepSeek model.");
    }
    return id;
  }
  return copilotModel(model);
}

function copilotModel(value: unknown): string {
  if (typeof value !== "string") return AUTO_MODEL_ID;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === AUTO_MODEL_ID) return AUTO_MODEL_ID;
  if (!MODEL_ID.test(trimmed)) throw new Error("Choose Auto or an available model");
  return trimmed;
}

/** Read a stored model without throwing; used by the database row mapper. */
export function readProviderModel(provider: ProviderId, model: unknown): string {
  if (provider === "deepseek") {
    return isDeepseekModel(model) ? String(model).trim() : DEEPSEEK_DEFAULT_MODEL;
  }
  if (typeof model !== "string") return AUTO_MODEL_ID;
  const trimmed = model.trim();
  if (!trimmed || trimmed.toLowerCase() === AUTO_MODEL_ID) return AUTO_MODEL_ID;
  return trimmed;
}

/**
 * Older clients send only a model. A DeepSeek model implies the DeepSeek
 * provider; everything else keeps the existing Copilot default.
 */
export function normalizeAgentProvider(provider: unknown, model: unknown): ProviderId {
  if (provider === undefined || provider === null || provider === "") {
    return isDeepseekModel(model) ? "deepseek" : "copilot";
  }
  return normalizeProvider(provider);
}
