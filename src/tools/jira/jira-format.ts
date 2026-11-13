const SEARCH_FIELDS = ["summary", "status", "assignee"];
const MAX_ISSUES = 20;
const MAX_COMMENTS = 5;

export function jiraToolsReady(site: string | null, hasToken: boolean, hasCookie = false): boolean {
  return Boolean(site) && (hasToken || hasCookie);
}

export function jiraConfigError(
  site: string | null,
  token: string | null,
  cookie: string | null = null,
): string | null {
  if (!site && !token && !cookie) {
    return "Open Settings → Jira and save the site URL and either a personal access token or a browser sign-in.";
  }
  if (!site) return "Open Settings → Jira and save the site URL.";
  if (!token && !cookie) {
    return "Open Settings → Jira and save a personal access token, or sign in with the browser.";
  }
  return null;
}

export function jiraBaseUrls(site: string): URL[] {
  let parsed: URL;
  try {
    parsed = new URL(site);
  } catch {
    throw new Error("Open Settings → Jira and save an http or https site URL.");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Open Settings → Jira and save an http or https site URL.");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const withPath = new URL(`${parsed.origin}${pathname}/`);
  const origin = new URL(`${parsed.origin}/`);
  return withPath.href === origin.href ? [origin] : [withPath, origin];
}

/** Describe a fetch failure and its nested cause. */
export function jiraFetchError(error: unknown): string {
  const parts: string[] = [];
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; name?: unknown; cause?: unknown };
    const message = textOf(record.message) || textOf(record.name);
    if (message) parts.push(message);
    appendCause(parts, record.cause);
  } else if (typeof error === "string" && error.trim()) {
    parts.push(error.trim());
  }
  return parts.length > 0 ? parts.join(": ") : "Jira could not be reached.";
}

/** Describe a response that was not the JSON the caller expected. */
export function jiraResponseDetail(response: {
  status: number;
  contentType: string | null;
  url: string;
  requestedUrl?: string;
  body: string;
}): string {
  const type = response.contentType || "unknown content type";
  const requestUrl = response.requestedUrl || response.url || "the Jira API";
  const redirected =
    response.url && response.url !== requestUrl ? ` (redirected to ${response.url})` : "";
  return `Jira returned HTTP ${response.status} (${type}) for ${requestUrl}${redirected}: ${summarizeBody(response.body, response.contentType)}`;
}

function summarizeBody(body: string, contentType: string | null): string {
  let text = body;
  if (/html/i.test(contentType ?? "")) {
    text = text
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ");
  }
  const clean = redactBody(text.replace(/\s+/g, " ").trim()).slice(0, 360);
  return clean || "(empty body)";
}

function redactBody(value: string): string {
  return value
    .replace(/\b(bearer|basic)\s+\S+/gi, "$1 [redacted]")
    .replace(
      /\b(atl_token|csrf|jsessionid|set-cookie|authorization|api[_ -]?token)\b\s*[:=]\s*["']?[^"'\s,;]+/gi,
      "$1=[redacted]",
    );
}

function appendCause(parts: string[], cause: unknown): void {
  if (!cause || typeof cause !== "object" || parts.length >= 5) return;
  const record = cause as {
    code?: unknown;
    message?: unknown;
    syscall?: unknown;
    hostname?: unknown;
    address?: unknown;
    port?: unknown;
    errors?: unknown;
  };
  const message = textOf(record.message);
  if (message && !parts.includes(message)) parts.push(message);
  const code = textOf(record.code);
  const host = textOf(record.hostname) || textOf(record.address);
  const port = typeof record.port === "number" || typeof record.port === "string" ? String(record.port) : "";
  const location = host && port ? `${host}:${port}` : host;
  const detail = [textOf(record.syscall), code, location].filter(Boolean).join(" ");
  const covered = Boolean(
    (code && message.toLowerCase().includes(code.toLowerCase())) ||
      (location && message.includes(location)),
  );
  if (detail && !covered && !parts.includes(detail)) parts.push(detail);
  if (!detail && port && !parts.includes(port)) parts.push(port);
  if (Array.isArray(record.errors)) {
    for (const child of record.errors) {
      appendCause(parts, child);
      if (parts.length >= 5) break;
    }
  }
}

export function jiraSearchBody(jql: string): { jql: string; maxResults: number; fields: string[] } {
  const trimmed = jql.trim();
  if (!trimmed) throw new Error("Missing jql");
  if (trimmed.length > 2_000) throw new Error("JQL is too long");
  return { jql: trimmed, maxResults: MAX_ISSUES, fields: SEARCH_FIELDS };
}

export function formatJiraIssues(payload: unknown): string {
  const issues = issuesOf(payload).slice(0, MAX_ISSUES);
  if (issues.length === 0) return "No issues matched.";
  return issues
    .map((issue) => {
      const fields = fieldsOf(issue);
      const key = textOf(issue.key) || "ISSUE";
      const summary = textOf(fields.summary) || "No summary";
      const status = textOf(recordOf(fields.status).name) || "Unknown";
      const assignee = textOf(recordOf(fields.assignee).displayName) || "Unassigned";
      return `${key} [${status}] ${summary} — ${assignee}`;
    })
    .join("\n");
}

export function formatJiraIssue(payload: unknown): string {
  const fields = fieldsOf(payload);
  const key = (textOf(recordOf(payload).key) || "ISSUE").toUpperCase();
  const summary = textOf(fields.summary) || "No summary";
  const status = textOf(recordOf(fields.status).name) || "Unknown";
  const assignee = textOf(recordOf(fields.assignee).displayName) || "Unassigned";
  const description = clip(plainText(fields.description), 4_000) || "No description.";
  const comments = commentsOf(fields.comment)
    .slice(-MAX_COMMENTS)
    .map((comment) => {
      const author = textOf(recordOf(comment.author).displayName) || "Someone";
      const body = clip(plainText(comment.body), 500) || "No comment text.";
      return `- ${author}: ${body}`;
    });
  return [
    `${key}: ${summary}`,
    `Status: ${status}`,
    `Assignee: ${assignee}`,
    `Description:\n${description}`,
    comments.length > 0 ? `Comments:\n${comments.join("\n")}` : "Comments:\nNone.",
  ].join("\n");
}

export function formatJiraMyself(payload: unknown): string {
  const record = recordOf(payload);
  const name = textOf(record.displayName) || "Unknown user";
  const email = textOf(record.emailAddress);
  const account = textOf(record.accountId) || textOf(record.name);
  return [name, email, account].filter(Boolean).join(" — ");
}

function issuesOf(payload: unknown): Record<string, unknown>[] {
  const issues = recordOf(payload).issues;
  if (!Array.isArray(issues)) return [];
  return issues.filter((issue) => issue && typeof issue === "object") as Record<string, unknown>[];
}

function commentsOf(value: unknown): Record<string, unknown>[] {
  const comments = recordOf(value).comments;
  if (!Array.isArray(comments)) return [];
  return comments.filter((comment) => comment && typeof comment === "object") as Record<string, unknown>[];
}

function fieldsOf(value: unknown): Record<string, unknown> {
  return recordOf(recordOf(value).fields);
}

function recordOf(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function plainText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  return adfText(value).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function adfText(value: unknown): string {
  if (!value || typeof value !== "object") return "";
  const record = value as { text?: unknown; type?: unknown; content?: unknown };
  const own = typeof record.text === "string" ? record.text : "";
  const children = Array.isArray(record.content) ? record.content.map((child) => adfText(child)).join("") : "";
  const block = record.type === "paragraph" || record.type === "heading" || record.type === "listItem";
  return `${own}${children}${block ? "\n" : ""}`;
}

function clip(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max).trimEnd()}…`;
}
