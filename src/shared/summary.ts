export function summarizeTool(name: string, ok: boolean, text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const head = (lines[0] ?? (ok ? "done" : "failed")).slice(0, 160);
  const extra = lines.length > 1 ? ` (+${lines.length - 1} more lines)` : "";
  const body = `${head}${extra}`.slice(0, 220);
  return `${name}: ${ok ? body : `failed: ${body}`}`;
}

export type ToolSummaryItem = {
  name: string;
  /** The human label already shown for this tool, used for tools with no count phrase. */
  label: string;
};

type ToolGroupKind =
  | "files-read"
  | "tables-read"
  | "code-search"
  | "files-looked"
  | "commands"
  | "files-changed"
  | "pages-opened"
  | "pages-read"
  | "browser"
  | "git"
  | "pull-requests"
  | "jira"
  | "confluence-pages";

const GROUP_ORDER: ToolGroupKind[] = [
  "files-read",
  "tables-read",
  "code-search",
  "files-looked",
  "commands",
  "files-changed",
  "pages-opened",
  "pages-read",
  "browser",
  "git",
  "pull-requests",
  "jira",
  "confluence-pages",
];

function toolGroupKind(name: string): ToolGroupKind | null {
  if (name === "file_read") return "files-read";
  if (name === "table_read") return "tables-read";
  if (name === "confluence_page") return "confluence-pages";
  if (name === "search_text" || name === "explore_code") return "code-search";
  if (name === "glob_files" || name === "list_dir") return "files-looked";
  if (name === "shell_run") return "commands";
  if (name === "file_write" || name === "apply_patch") return "files-changed";
  if (name === "browser_navigate") return "pages-opened";
  if (name === "browser_snapshot") return "pages-read";
  if (name === "browser_click" || name === "browser_type") return "browser";
  if (name.startsWith("git_")) return "git";
  if (name.startsWith("gh_pr_")) return "pull-requests";
  if (name.startsWith("jira_")) return "jira";
  if (name.startsWith("browser_") && name !== "browser_needs_you") return "browser";
  return null;
}

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function groupPhrase(kind: ToolGroupKind, count: number): string {
  switch (kind) {
    case "files-read":
      return `Read ${plural(count, "file", "files")}`;
    case "tables-read":
      return `Read ${plural(count, "table", "tables")}`;
    case "confluence-pages":
      return `Read ${plural(count, "Confluence page", "Confluence pages")}`;
    case "code-search":
      return count === 1 ? "Searched the code" : `Searched the code ${count} times`;
    case "files-looked":
      return "Looked through files";
    case "commands":
      return `Ran ${plural(count, "command", "commands")}`;
    case "files-changed":
      return `Changed ${plural(count, "file", "files")}`;
    case "pages-opened":
      return `Opened ${plural(count, "page", "pages")}`;
    case "pages-read":
      return `Read ${plural(count, "page", "pages")}`;
    case "browser":
      return count === 1 ? "Used the browser" : `Used the browser ${count} times`;
    case "git":
      return count === 1 ? "Checked git" : `Checked git ${count} times`;
    case "pull-requests":
      return `Read ${plural(count, "pull request", "pull requests")}`;
    case "jira":
      return count === 1 ? "Checked Jira" : `Checked Jira ${count} times`;
  }
}

/**
 * One line for a run of tool calls, counted by what the calls did rather than
 * listing the tool names. Tools with no useful count (a routine, a question, a
 * skill) keep their human label.
 */
export function toolGroupSummary(items: readonly ToolSummaryItem[]): string {
  const counts = new Map<ToolGroupKind, number>();
  const labels: string[] = [];
  const seenLabels = new Set<string>();
  for (const item of items) {
    const kind = toolGroupKind(item.name);
    if (kind) {
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
      continue;
    }
    if (item.label && !seenLabels.has(item.label)) {
      seenLabels.add(item.label);
      labels.push(item.label);
    }
  }
  const phrases = GROUP_ORDER.flatMap((kind) => {
    const count = counts.get(kind);
    return count ? [groupPhrase(kind, count)] : [];
  });
  return [...phrases, ...labels].join(" · ");
}

/**
 * How long a turn has run, for the line under its reply. An ended turn says
 * "Worked for"; a live one says "Working for". Waiting on an approval counts as
 * part of the turn, so treat this as elapsed turn time, not model time.
 */
export function workDurationLabel(
  startedAt: string | null | undefined,
  endedAt: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!startedAt) return null;
  const started = Date.parse(startedAt);
  const ended = endedAt ? Date.parse(endedAt) : now;
  if (!Number.isFinite(started) || !Number.isFinite(ended) || ended < started) return null;
  const seconds = Math.max(1, Math.round((ended - started) / 1000));
  const prefix = endedAt ? "Worked for" : "Working for";
  if (seconds < 60) return `${prefix} ${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${prefix} ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${prefix} ${hours}h${rest ? ` ${rest}m` : ""}`;
}
