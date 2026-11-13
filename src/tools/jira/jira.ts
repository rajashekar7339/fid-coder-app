import { net } from "electron";
import { asRecord, requiredString } from "../args";
import {
  formatJiraIssue,
  formatJiraIssues,
  formatJiraMyself,
  jiraBaseUrls,
  jiraConfigError,
  jiraFetchError,
  jiraResponseDetail,
  jiraSearchBody,
} from "./jira-format";
import type { AppTool, ToolContext } from "../types";

const ISSUE_FIELDS = ["summary", "status", "assignee", "description", "comment"];

// Use Chromium's network stack in Electron so requests follow the Windows
// proxy and certificate store. Tests in plain Node fall back to global fetch.
const jiraFetch: typeof fetch =
  typeof net?.fetch === "function" ? (net.fetch.bind(net) as unknown as typeof fetch) : fetch;

export const jiraTools: AppTool[] = [
  {
    name: "jira_myself",
    description: "Read the Jira account for the saved token.",
    parameters: { type: "object", properties: {} },
    handler: async (_args, ctx) => {
      const payload = await jiraSend(ctx, ["/rest/api/3/myself", "/rest/api/2/myself"], { method: "GET" });
      return formatJiraMyself(payload);
    },
  },
  {
    name: "jira_search",
    description:
      "Search the saved Jira site with JQL. Returns up to 20 issues with key, summary, status, and assignee. Read-only.",
    parameters: {
      type: "object",
      properties: {
        jql: { type: "string", description: "Jira query, such as assignee = currentUser() AND resolution = Unresolved" },
      },
      required: ["jql"],
    },
    handler: async (args, ctx) => {
      const body = jiraSearchBody(requiredString(asRecord(args), "jql"));
      const payload = await jiraSend(ctx, ["/rest/api/3/search/jql", "/rest/api/2/search"], {
        method: "POST",
        body: JSON.stringify(body),
      });
      return formatJiraIssues(payload);
    },
  },
  {
    name: "jira_issue",
    description: "Read one Jira issue by key, including the description and the latest comments. Read-only.",
    parameters: {
      type: "object",
      properties: {
        key: { type: "string", description: "Issue key, such as PROJ-123" },
      },
      required: ["key"],
    },
    handler: async (args, ctx) => {
      const key = issueKey(requiredString(asRecord(args), "key"));
      const query = `?fields=${ISSUE_FIELDS.join(",")}`;
      const payload = await jiraSend(
        ctx,
        [`/rest/api/3/issue/${encodeURIComponent(key)}${query}`, `/rest/api/2/issue/${encodeURIComponent(key)}${query}`],
        { method: "GET" },
      );
      return formatJiraIssue(payload);
    },
  },
];

async function jiraSend(ctx: ToolContext, paths: string[], init: { method: string; body?: string }): Promise<unknown> {
  const problem = jiraConfigError(ctx.jiraSite, ctx.jiraToken, ctx.jiraCookie);
  if (problem || !ctx.jiraSite) {
    const detail = problem ?? "Open Settings → Jira and save a personal access token, or sign in with the browser.";
    ctx.log?.(`Jira tool failed: ${detail}`);
    jiraFail(detail);
  }
  let bases: URL[];
  try {
    bases = jiraBaseUrls(ctx.jiraSite);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Open Settings → Jira and save an http or https site URL.";
    ctx.log?.(`Jira tool failed: ${detail}`);
    jiraFail(detail);
  }
  const fail = (detail: string): never => {
    ctx.log?.(`Jira tool failed: ${detail}`);
    return jiraFail(detail);
  };
  const auths: Array<{ label: string; headers: Record<string, string> }> = [];
  const cookie = ctx.jiraCookie?.trim();
  if (cookie) auths.push({ label: "browser session", headers: { Cookie: cookie } });
  const token = ctx.jiraToken?.trim();
  if (token) auths.push({ label: "personal access token", headers: { Authorization: `Bearer ${token}` } });
  if (auths.length === 0) {
    fail("Open Settings → Jira and save a personal access token, or sign in with the browser.");
  }

  let sawNotFound = false;
  let lastDetail = "Jira could not be reached.";
  let lastRejected: string | null = null;
  for (const base of bases) {
    for (const path of paths) {
      const requested = `${base.toString().replace(/\/+$/, "")}${path}`;
      for (const auth of auths) {
        let response: Response;
        try {
          response = await jiraFetch(requested, {
            method: init.method,
            headers: {
              Accept: "application/json",
              ...auth.headers,
              ...(init.body ? { "Content-Type": "application/json" } : {}),
            },
            body: init.body,
            signal: AbortSignal.timeout(20_000),
          });
        } catch (error) {
          lastDetail = `Jira could not reach ${requested}: ${jiraFetchError(error)}`;
          ctx.log?.(`Jira attempt with the ${auth.label} failed (will retry): ${lastDetail}`);
          continue;
        }
        if (response.status === 404) {
          sawNotFound = true;
          ctx.log?.(`Jira attempt with the ${auth.label} returned 404 for ${requested}.`);
          continue;
        }
        const text = await response.text();
        const contentType = response.headers.get("content-type");
        const finalUrl = response.url;
        if (response.status === 401 || response.status === 403) {
          lastRejected = `Jira rejected the ${auth.label}. ${jiraResponseDetail({
            status: response.status,
            contentType,
            url: finalUrl,
            requestedUrl: requested,
            body: text,
          })}`;
          ctx.log?.(`Jira attempt failed (will retry): ${lastRejected}`);
          continue;
        }
        if (!response.ok) {
          lastDetail = jiraResponseDetail({
            status: response.status,
            contentType,
            url: finalUrl,
            requestedUrl: requested,
            body: text,
          });
          ctx.log?.(`Jira attempt with the ${auth.label} failed (will retry): ${lastDetail}`);
          continue;
        }
        if (!text.trim()) {
          lastDetail = `Jira returned an empty response for ${requested}.`;
          ctx.log?.(`Jira attempt with the ${auth.label} failed (will retry): ${lastDetail}`);
          continue;
        }
        try {
          return JSON.parse(text) as unknown;
        } catch {
          lastDetail = jiraResponseDetail({
            status: response.status,
            contentType,
            url: finalUrl,
            requestedUrl: requested,
            body: text,
          });
          ctx.log?.(`Jira attempt with the ${auth.label} failed (will retry): ${lastDetail}`);
        }
      }
    }
  }
  if (lastRejected && lastDetail === "Jira could not be reached.") lastDetail = lastRejected;
  fail(
    sawNotFound && lastDetail === "Jira could not be reached."
      ? "Jira could not find that API on the saved site."
      : lastDetail,
  );
}

function jiraFail(detail: string): never {
  const safe = detail.replace(/\s+/g, " ").replace(/bearer\s+\S+|basic\s+\S+/gi, "[redacted]").trim().slice(0, 1_200);
  console.error(`Jira tool failed: ${safe}`);
  throw new Error("Jira is unavailable.");
}

function issueKey(value: string): string {
  if (!/^[A-Za-z][A-Za-z0-9]+-\d+$/.test(value)) throw new Error("Issue key must look like PROJ-123");
  return value.toUpperCase();
}
