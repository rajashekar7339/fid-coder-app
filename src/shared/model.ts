import type { CopilotModel } from "./types";

export const AUTO_MODEL_ID = "auto";

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,119}$/;

export function normalizeModelId(value: unknown): string {
  if (typeof value !== "string") return AUTO_MODEL_ID;
  const trimmed = value.trim();
  if (!trimmed || trimmed.toLowerCase() === AUTO_MODEL_ID) return AUTO_MODEL_ID;
  if (!MODEL_ID.test(trimmed)) throw new Error("Choose Auto or an available model");
  return trimmed;
}

export function isListedModelId(value: string): boolean {
  return value.toLowerCase() !== AUTO_MODEL_ID && MODEL_ID.test(value);
}

export type CatalogModel = {
  id?: unknown;
  name?: unknown;
  policy?: { state?: unknown };
  provider?: { id?: unknown };
};

export function catalogModels(input: {
  clientModels?: CatalogModel[];
  sessionModels?: CatalogModel[];
  sessionCatalogAvailable?: boolean;
}): CopilotModel[] {
  const source =
    input.sessionCatalogAvailable === false ? (input.clientModels ?? []) : (input.sessionModels ?? []);
  return labelDuplicateNames(namedModels(source));
}

function namedModels(items: CatalogModel[]): CopilotModel[] {
  const models: CopilotModel[] = [];
  for (const item of items) {
    const id = listedId(item?.id);
    if (!id || item.policy?.state === "disabled") continue;
    const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : id;
    models.push({ id, name });
  }
  return models;
}

function listedId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!isListedModelId(id) || id.toLowerCase().includes("free-auto")) return null;
  return id;
}

function labelDuplicateNames(models: CopilotModel[]): CopilotModel[] {
  const counts = new Map<string, number>();
  for (const model of models) counts.set(model.name, (counts.get(model.name) ?? 0) + 1);
  return models.map((model) => ((counts.get(model.name) ?? 0) > 1 ? { ...model, name: `${model.name} (${model.id})` } : model));
}
