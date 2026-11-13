// Pure helpers shared by the Jira tools and the browser sign-in probe.

export type JiraBrowserCookie = { name: string; value: string };

/** Join Playwright cookies into a Cookie request header. */
export function jiraCookieHeader(cookies: readonly JiraBrowserCookie[]): string {
  const parts: string[] = [];
  const seen = new Set<string>();
  for (const cookie of cookies) {
    const name = typeof cookie?.name === "string" ? cookie.name.trim() : "";
    if (!name || typeof cookie.value !== "string") continue;
    const part = `${name}=${cookie.value}`;
    if (seen.has(part)) continue;
    seen.add(part);
    parts.push(part);
  }
  return parts.join("; ");
}

/** Read the signed-in user from a /myself response, or null when it is not a session. */
export function jiraSessionName(payload: unknown): string | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["displayName", "name", "accountId", "key"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}
