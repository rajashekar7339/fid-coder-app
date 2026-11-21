import { datadogLogsUrl, normalizeDatadogUrl, parseDatadogWindow } from "../../shared/datadog";
import { asRecord, optionalNumber, optionalString, requiredString } from "../args";
import type {
  AppTool,
  BrowserCaptureResult,
  CapturedBrowserResponse,
  ToolContext,
} from "../types";
import {
  clip,
  formatLogs,
  formatPatterns,
  OUTPUT_MAX,
  record,
  stringValue,
  type DatadogLogItem,
} from "./format";

const BROWSER_ROWS_DEFAULT = 25;
const BROWSER_ROWS_MAX = 100;
const BROWSER_PATTERN_DEFAULT = 200;
const BROWSER_PATTERN_MAX = 500;
const CAPTURE_SETTLE_MS = 7_000;
const CAPTURE_MAX_BODIES = 16;
const CAPTURE_MAX_BODY_CHARS = 500_000;

/**
 * Browser-mode Datadog tools. They use the agent's logged-in headed browser,
 * not an API key. The page response is captured in the main process and only
 * the compact log summary reaches the model.
 */
export const datadogBrowserTools: AppTool[] = [
  {
    name: "datadog_browser_logs",
    description:
      "Search Datadog logs with no API key. Opens the logged-in Datadog Log Explorer in the local headed browser, captures the page's JSON log response, and returns compact rows with service, env, version, host, status, trace id, message, and stack. Browser results are a page sample, not the full index. If the page needs a sign-in, call browser_needs_you, wait for the user, call browser_snapshot, then retry. Read-only.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Datadog log query, such as service:checkout-api status:error",
        },
        from: {
          type: "string",
          description: "Start time: 15m, 2h, an ISO time, or now. Default 15m.",
        },
        to: {
          type: "string",
          description: "End time: now, an ISO time, or a relative time. Default now.",
        },
        limit: {
          type: "number",
          description: `Rows to return. Default ${BROWSER_ROWS_DEFAULT}, maximum ${BROWSER_ROWS_MAX}.`,
        },
      },
      required: ["query"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const config = browserConfig(ctx);
      const query = requiredString(record, "query");
      const window = parseDatadogWindow(optionalString(record, "from"), optionalString(record, "to"));
      const limit = bounded(optionalNumber(record, "limit", BROWSER_ROWS_DEFAULT), 1, BROWSER_ROWS_MAX);
      const sample = await captureSample(ctx, config, query, window, limit);
      if (sample.items.length === 0) {
        return missingPayload(sample.url, sample.result.pageUrl, sample.result.responses);
      }
      return clip(
        [
          "Source: Datadog browser page (captured JSON; page sample, not the full index).",
          formatLogs(
            sample.items as DatadogLogItem[],
            config.appBase,
            query,
            window,
            "page sample, newest first",
          ),
        ].join("\n"),
        OUTPUT_MAX,
      );
    },
  },
  {
    name: "datadog_browser_error_summary",
    description:
      "Group Datadog error logs with no API key. Opens the logged-in Log Explorer, captures the page's JSON log response, and clusters the sampled messages into patterns with first/last seen, service, version, and a sample frame. Browser results are a page sample. If the page needs a sign-in, call browser_needs_you, wait for the user, call browser_snapshot, then retry. Read-only.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Datadog log query. Default status:error.",
        },
        from: {
          type: "string",
          description: "Start time. Default 30m.",
        },
        to: {
          type: "string",
          description: "End time. Default now.",
        },
        limit: {
          type: "number",
          description: `Log samples to cluster. Default ${BROWSER_PATTERN_DEFAULT}, maximum ${BROWSER_PATTERN_MAX}.`,
        },
      },
      required: [],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const config = browserConfig(ctx);
      const query = optionalString(record, "query") ?? "status:error";
      const window = parseDatadogWindow(
        optionalString(record, "from") ?? "30m",
        optionalString(record, "to"),
        { maxMs: 24 * 3_600_000 },
      );
      const limit = bounded(
        optionalNumber(record, "limit", BROWSER_PATTERN_DEFAULT),
        10,
        BROWSER_PATTERN_MAX,
      );
      const sample = await captureSample(ctx, config, query, window, limit);
      if (sample.items.length === 0) {
        return missingPayload(sample.url, sample.result.pageUrl, sample.result.responses);
      }
      return clip(
        [
          "Source: Datadog browser page (captured JSON; sampled patterns, not exact totals).",
          formatPatterns(sample.items as DatadogLogItem[], config.appBase, query, window),
        ].join("\n"),
        OUTPUT_MAX,
      );
    },
  },
];

type BrowserConfig = {
  appBase: string;
  origin: string;
};

type Sample = {
  url: string;
  result: BrowserCaptureResult;
  items: Record<string, unknown>[];
};

function browserConfig(ctx: ToolContext): BrowserConfig {
  if (!ctx.datadogUrl) throw new Error("Save your Datadog URL in Settings → Datadog.");
  const appBase = normalizeDatadogUrl(ctx.datadogUrl);
  return { appBase, origin: new URL(appBase).origin };
}

async function captureSample(
  ctx: ToolContext,
  config: BrowserConfig,
  query: string,
  window: ReturnType<typeof parseDatadogWindow>,
  limit: number,
): Promise<Sample> {
  const url = datadogLogsUrl(config.appBase, query, window);
  let result: BrowserCaptureResult;
  try {
    result = await ctx.browser.capture(ctx.agentId, url, {
      allowedOrigins: [config.origin],
      urlPattern: "\\/api\\/|\\/logs|\\/events|\\/analytics|\\/search|\\/query",
      settleMs: CAPTURE_SETTLE_MS,
      maxBodies: CAPTURE_MAX_BODIES,
      maxBodyChars: CAPTURE_MAX_BODY_CHARS,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Datadog did not open: ${message}. Check the visible browser, finish any sign-in, then try again.`,
    );
  }
  return { url, result, items: collectLogItems(result.responses).slice(0, limit) };
}

function collectLogItems(responses: CapturedBrowserResponse[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const items: Record<string, unknown>[] = [];
  for (const response of responses) {
    if (response.status >= 400) continue;
    let payload: unknown;
    try {
      payload = JSON.parse(response.body) as unknown;
    } catch {
      continue;
    }
    for (const item of findLogItems(payload)) {
      const row = record(item);
      if (!row) continue;
      const key = logKey(row);
      if (seen.has(key)) continue;
      seen.add(key);
      items.push(row);
      if (items.length >= 1_000) return items;
    }
  }
  return items;
}

function findLogItems(value: unknown, depth = 0): unknown[] {
  if (depth > 8 || value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    const logs = value.filter(isLogLike);
    if (logs.length) return logs.slice(0, 1_000);
    const nested: unknown[] = [];
    for (const item of value) {
      nested.push(...findLogItems(item, depth + 1));
      if (nested.length >= 1_000) break;
    }
    return nested;
  }
  if (typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  for (const key of ["data", "logs", "results", "events", "items", "rows"]) {
    const candidate = row[key];
    if (Array.isArray(candidate)) {
      const found = findLogItems(candidate, depth + 1);
      if (found.length) return found;
    }
  }
  const nested: unknown[] = [];
  for (const item of Object.values(row)) {
    nested.push(...findLogItems(item, depth + 1));
    if (nested.length >= 1_000) break;
  }
  return nested;
}

function isLogLike(value: unknown): boolean {
  const row = record(value);
  if (!row) return false;
  const attrs = record(row.attributes) ?? record(row.content);
  if (attrs) {
    const timestamp = attrs.timestamp;
    return (
      typeof attrs.message === "string" ||
      typeof timestamp === "string" ||
      typeof timestamp === "number"
    );
  }
  const timestamp = row.timestamp;
  return (
    typeof row.message === "string" &&
    (typeof timestamp === "string" || typeof timestamp === "number")
  );
}

function logKey(row: Record<string, unknown>): string {
  const attrs = record(row.attributes) ?? record(row.content) ?? row;
  const nested = record(attrs.attributes) ?? {};
  const key = [
    stringValue(attrs.timestamp) ?? "",
    stringValue(attrs.service) ?? "",
    stringValue(attrs.host) ?? "",
    stringValue(attrs.message) ?? "",
    stringValue(nested.trace_id) ?? "",
  ].join("|");
  return key.replace(/\|/g, "") ? key : JSON.stringify(row).slice(0, 300);
}

function missingPayload(
  url: string,
  pageUrl: string,
  responses: CapturedBrowserResponse[],
): string {
  if (signInPage(pageUrl)) {
    return clip(
      [
        "Datadog opened a sign-in page instead of the Log Explorer.",
        `Page: ${pageUrl}`,
        "Call browser_needs_you once, finish the sign-in in the visible browser, call browser_snapshot, then run this tool again.",
      ].join("\n"),
      OUTPUT_MAX,
    );
  }
  const lines = [
    "No log rows were found in the captured JSON.",
    `Page: ${pageUrl || "unknown"}`,
    `Open in Datadog: ${url}`,
  ];
  if (responses.length) {
    lines.push("", "Captured responses:");
    for (const response of responses.slice(0, 8)) {
      lines.push(
        `- ${response.method} ${clip(response.url, 300)} (${response.status}, ${Math.round(response.body.length / 1024)} KB)`,
      );
    }
    lines.push(
      "",
      "The page may still be loading or Datadog changed its response. Try again, widen the time window, or use browser_snapshot to read the visible page.",
    );
  } else {
    lines.push(
      "",
      "No JSON response was captured. The page may still be loading or Datadog changed its response. Wait a moment and retry, or use browser_snapshot to read the visible page.",
    );
  }
  return clip(lines.join("\n"), OUTPUT_MAX);
}

function signInPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (/(okta|microsoftonline|onelogin|pingidentity|pingone|adfs|auth0|duosecurity)/i.test(parsed.hostname)) {
      return true;
    }
    return /(login|sign-?in|sso|auth|saml|oauth)/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function bounded(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.floor(value)));
}

