export const IMPACT_OUTPUT_ROOT = "artifacts";

export function normalizeImpactPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

export function isImpactOutputPath(value: string): boolean {
  return normalizeImpactPath(value).startsWith(`${IMPACT_OUTPUT_ROOT}/`);
}

export function isDeprecatedPath(value: string): boolean {
  return value.split(/[\\/]+/).some((part) => part.toLowerCase() === "deprecated");
}
