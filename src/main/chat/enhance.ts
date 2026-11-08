import { ENHANCE_MODEL_TTL_MS, cheapModelId } from "../../shared/enhance-prompt";

type NamedModel = {
  id: string;
  name: string;
};

let cachedModel: { id: string; at: number } | null = null;

export async function selectEnhanceModel(
  listModels: () => Promise<NamedModel[]>,
  now = Date.now(),
): Promise<string> {
  if (cachedModel && now - cachedModel.at < ENHANCE_MODEL_TTL_MS) return cachedModel.id;
  let models: NamedModel[] = [];
  let listed = false;
  try {
    models = await listModels();
    listed = true;
  } catch {
    listed = false;
  }
  const id = cheapModelId(models);
  if (listed) cachedModel = { id, at: now };
  return id;
}
