import { net } from "electron";
import MarkdownIt from "markdown-it";
import {
  confluenceBaseUrl,
  confluenceLinkTarget,
  confluencePageUrl,
  confluenceText,
  isConfluenceMode,
  storageHasMacros,
  type ConfluenceLinkTarget,
} from "../../shared/confluence";
import { asRecord, optionalNumber, optionalString, requiredString } from "../args";
import type { AppTool, ToolContext } from "../types";

const PART_DEFAULT = 10;
const PART_MAX = 20;
const BODY_MAX = 24_000;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

const markdown = new MarkdownIt({ html: false, linkify: true, breaks: false });

const confluenceFetch: typeof fetch =
  typeof net?.fetch === "function" ? (net.fetch.bind(net) as unknown as typeof fetch) : fetch;

type ConfluencePage = {
  id?: string;
  title?: string;
  type?: string;
  space?: { key?: string; name?: string };
  version?: { number?: number };
  body?: {
    storage?: { value?: string };
    view?: { value?: string };
  };
  _links?: { webui?: string };
};

type ApprovalView = {
  command: string;
  cwd: string;
  reason: string;
};

export const confluenceTools: AppTool[] = [
  {
    name: "confluence_search",
    description:
      "Search Confluence with CQL. Returns up to 20 pages with id, title, space, version, and URL. Read-only. Use confluence_page to read a result before updating it.",
    parameters: {
      type: "object",
      properties: {
        cql: {
          type: "string",
          description: "Confluence CQL, such as space = DOCS AND title ~ \"release notes\"",
        },
        limit: {
          type: "number",
          description: `Results to return. Default ${PART_DEFAULT}, maximum ${PART_MAX}.`,
        },
      },
      required: ["cql"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const cql = requiredString(record, "cql");
      const limit = Math.max(
        1,
        Math.min(PART_MAX, Math.floor(optionalNumber(record, "limit", PART_DEFAULT))),
      );
      const base = await confluenceBase(ctx);
      const payload = await confluenceSend(
        ctx,
        base,
        `/rest/api/content/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=space,version`,
        { method: "GET" },
      );
      const results = Array.isArray(asRecord(payload).results)
        ? (asRecord(payload).results as ConfluencePage[])
        : [];
      if (results.length === 0) return "No Confluence pages matched.";
      return results.map((page) => searchRow(page, base)).join("\n");
    },
  },
  {
    name: "confluence_page",
    description:
      "Read one Confluence page by URL, id, or spaceKey and title. A pasted URL may be a short /x/ link; the tool follows same-site redirects to find the page. Returns title, space, version, URL, and body. Use format=storage before an update when the page has macros or rich formatting. Read-only.",
    parameters: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description:
            "A full Confluence page URL from the configured site, including a short /x/ link.",
        },
        id: { type: "string", description: "Confluence page id" },
        spaceKey: { type: "string", description: "Space key when looking up by title" },
        title: { type: "string", description: "Exact page title when looking up by title" },
        format: {
          type: "string",
          enum: ["text", "storage", "both"],
          description:
            "text returns readable text (default); storage returns the Confluence storage XHTML; both returns both.",
        },
      },
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const base = await confluenceBase(ctx);
      const link = optionalString(record, "url");
      const page = link ? await findPageByUrl(ctx, base, link) : await findPage(ctx, base, record);
      return formatPage(page, base, optionalString(record, "format") ?? "text");
    },
  },
  {
    name: "confluence_update_page",
    description:
      "Update an existing Confluence page. Read the page first and pass its current version as expectedVersion. The update asks the user for approval. mode=append keeps the existing storage body and adds the new content; mode=replace replaces it. format=markdown converts basic Markdown to Confluence storage; format=storage passes storage XHTML unchanged.",
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "Confluence page id" },
        title: { type: "string", description: "New title. Omit to keep the current title." },
        body: { type: "string", description: "Markdown or Confluence storage XHTML to write." },
        expectedVersion: {
          type: "number",
          description: "The version.number from confluence_page. The update refuses if the page changed.",
        },
        format: {
          type: "string",
          enum: ["markdown", "storage"],
          description: "markdown (default) converts basic Markdown; storage passes XHTML unchanged.",
        },
        mode: {
          type: "string",
          enum: ["append", "replace"],
          description: "append keeps the current body; replace replaces it.",
        },
        versionMessage: {
          type: "string",
          description: "Optional short version comment shown in Confluence history.",
        },
      },
      required: ["id", "body", "expectedVersion", "mode"],
    },
    handler: async (args, ctx) => updatePage(args, ctx),
  },
];

async function confluenceBase(ctx: ToolContext): Promise<string> {
  if (!ctx.confluenceSite || !ctx.confluenceToken) {
    throw new Error("Confluence is not configured. Save the site and token in Settings → Confluence.");
  }
  if (!isConfluenceMode(ctx.confluenceMode)) {
    throw new Error("Choose Cloud or Data Center in Settings → Confluence.");
  }
  if (ctx.confluenceMode === "cloud" && !ctx.confluenceEmail) {
    throw new Error("Cloud Confluence needs the account email in Settings → Confluence.");
  }
  return confluenceBaseUrl(ctx.confluenceSite, ctx.confluenceMode);
}

async function findPage(
  ctx: ToolContext,
  base: string,
  record: Record<string, unknown>,
): Promise<ConfluencePage> {
  const id = optionalString(record, "id");
  const spaceKey = optionalString(record, "spaceKey");
  const title = optionalString(record, "title");
  if (id) {
    const payload = await confluenceSend(
      ctx,
      base,
      `/rest/api/content/${encodeURIComponent(id)}?expand=space,version,body.storage,body.view`,
      { method: "GET" },
    );
    return asRecord(payload) as ConfluencePage;
  }
  if (!spaceKey || !title) {
    throw new Error("Pass id, or pass spaceKey and title.");
  }
  const payload = await confluenceSend(
    ctx,
    base,
    `/rest/api/content?type=page&spaceKey=${encodeURIComponent(spaceKey)}&title=${encodeURIComponent(
      title,
    )}&expand=space,version,body.storage,body.view`,
    { method: "GET" },
  );
  const results = Array.isArray(asRecord(payload).results)
    ? (asRecord(payload).results as ConfluencePage[])
    : [];
  const page = results[0];
  if (!page) throw new Error(`No Confluence page titled "${title}" in ${spaceKey}.`);
  return page;
}

async function findPageByUrl(
  ctx: ToolContext,
  base: string,
  link: string,
): Promise<ConfluencePage> {
  let target = confluenceLinkTarget(base, link);
  if (target.unresolved) {
    target = confluenceLinkTarget(base, await resolveConfluenceLink(ctx, base, target.url));
  }
  if (target.unresolved) {
    throw new Error(
      "That link did not resolve to a Confluence page. Open it in the browser, or paste the canonical page URL.",
    );
  }
  if (target.id) return findPage(ctx, base, { id: target.id });
  if (target.spaceKey && target.title) {
    return findPage(ctx, base, { spaceKey: target.spaceKey, title: target.title });
  }
  throw new Error("That link does not identify a Confluence page.");
}

function isConfluenceShortLink(base: string, link: string): boolean {
  const baseUrl = new URL(base);
  const target = new URL(link);
  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  const relative = basePath ? target.pathname.slice(basePath.length) : target.pathname;
  return /^\/x\/[^/]+\/?$/.test(relative);
}

/**
 * Follow a short Confluence link only while it stays inside the configured
 * site. The token is never sent to another origin, and a canonical URL ends
 * the resolution before another page request is made.
 */
async function resolveConfluenceLink(
  ctx: ToolContext,
  base: string,
  start: string,
): Promise<string> {
  let current = new URL(start);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    let target: ConfluenceLinkTarget;
    try {
      target = confluenceLinkTarget(base, current.toString());
    } catch {
      throw new Error(
        "That Confluence link redirected away from the configured site. Open it in the browser if it needs a sign-in.",
      );
    }
    if (!target.unresolved) return target.url;
    if (!isConfluenceShortLink(base, current.toString())) {
      throw new Error(
        "That link did not resolve to a Confluence page. Open it in the browser, or paste the canonical page URL.",
      );
    }

    let step: { location: string | null; status: number };
    try {
      step = await confluenceRedirectStep(current.toString(), confluenceAuthorization(ctx));
    } catch (error) {
      ctx.log?.(
        `Confluence link resolution failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new Error("Confluence could not resolve that link. Try the canonical page URL.");
    }
    if (step.location) {
      current = new URL(step.location, current);
      continue;
    }
    if (step.status === 401 || step.status === 403) {
      throw new Error(
        "That Confluence link needs a sign-in. Open it in the browser, or paste the canonical page URL.",
      );
    }
    if (step.status === 404) throw new Error("That Confluence link was not found.");
    if (step.status >= 400) {
      ctx.log?.(`Confluence link resolution returned HTTP ${step.status}.`);
      throw new Error(`Confluence returned HTTP ${step.status} for that link.`);
    }
    throw new Error(
      "That link did not resolve to a Confluence page. Open it in the browser, or paste the canonical page URL.",
    );
  }
  throw new Error(
    "That Confluence link redirected too many times. Open it in the browser, or paste the canonical page URL.",
  );
}

/**
 * Electron's net.fetch cancels manual redirects, so the desktop path uses
 * net.request and reads the Location before following. Tests fall back to
 * Node's fetch with the same no-follow rule.
 */
async function confluenceRedirectStep(
  url: string,
  authorization: string,
): Promise<{ location: string | null; status: number }> {
  if (typeof net?.request === "function") {
    return netRedirectStep(url, authorization);
  }
  const response = await confluenceFetch(url, {
    method: "GET",
    headers: {
      Accept: "text/html,application/xhtml+xml",
      Authorization: authorization,
    },
    redirect: "manual",
    signal: AbortSignal.timeout(20_000),
  });
  const location = REDIRECT_STATUS.has(response.status)
    ? response.headers.get("location")
    : null;
  try {
    await response.body?.cancel();
  } catch {
    // The response is discarded; a failed cancel is harmless.
  }
  return { location, status: response.status };
}

function netRedirectStep(
  url: string,
  authorization: string,
): Promise<{ location: string | null; status: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const request = net.request({ method: "GET", url, redirect: "manual" });
    const finish = (
      action: (value: { location: string | null; status: number }) => void,
      value: { location: string | null; status: number },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        request.abort();
      } catch {
        // The request may already be complete.
      }
      action(value);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        request.abort();
      } catch {
        // The request may already be complete.
      }
      reject(new Error("Timed out while resolving the Confluence link."));
    }, 20_000);
    request.setHeader("Accept", "text/html,application/xhtml+xml");
    request.setHeader("Authorization", authorization);
    request.on("redirect", (_statusCode, _method, redirectUrl) => {
      finish(resolve, { location: redirectUrl, status: 302 });
    });
    request.on("response", (response) => {
      const status = response.statusCode ?? 0;
      response.on("data", () => undefined);
      response.on("end", () => finish(resolve, { location: null, status }));
      response.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
    request.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    request.end();
  });
}

async function updatePage(args: unknown, ctx: ToolContext): Promise<string> {
  const record = asRecord(args);
  const id = requiredString(record, "id");
  const body = requiredString(record, "body");
  const expectedVersion = Math.floor(optionalNumber(record, "expectedVersion", 0));
  if (expectedVersion < 1) throw new Error("expectedVersion must be the current page version.");
  const mode = optionalString(record, "mode");
  if (mode !== "append" && mode !== "replace") throw new Error("mode must be append or replace.");
  const format = optionalString(record, "format") ?? "markdown";
  if (format !== "markdown" && format !== "storage") {
    throw new Error("format must be markdown or storage.");
  }
  if (!ctx.requestApproval) throw new Error("Confluence updates need the approval card.");
  const base = await confluenceBase(ctx);
  const current = await findPage(ctx, base, { id });
  const currentVersion = Number(current.version?.number ?? 0);
  if (currentVersion !== expectedVersion) {
    throw new Error(
      `The page changed: it is now version ${currentVersion}. Read it again and use the new expectedVersion.`,
    );
  }
  const currentStorage = current.body?.storage?.value ?? "";
  const nextStorage = format === "markdown" ? markdownToStorage(body) : body;
  if (
    mode === "replace" &&
    format === "markdown" &&
    storageHasMacros(currentStorage)
  ) {
    throw new Error(
      "This page contains Confluence macros. Use format=storage, or use mode=append, so the macros are not dropped.",
    );
  }
  const combined =
    mode === "append" ? `${currentStorage}\n${nextStorage}`.trim() : nextStorage.trim();
  if (!combined) throw new Error("The updated page body is empty.");
  const title = optionalString(record, "title") ?? current.title;
  if (!title) throw new Error("The page has no title; pass title explicitly.");
  const pageUrl = confluencePageUrl(base, current._links) ?? base;
  const space = current.space?.key ? ` in ${current.space.key}` : "";
  const preview = confluenceText(nextStorage).replace(/\s+/g, " ").slice(0, 300);
  const approval: ApprovalView = {
    command: `Update "${title}"${space} (v${currentVersion} → v${currentVersion + 1}, ${mode})`,
    cwd: pageUrl,
    reason: `This changes a shared Confluence page. ${preview || "No readable text preview."}`,
  };
  const outcome = await ctx.requestApproval({
    kind: "tool",
    title: "Update a Confluence page",
    command: approval.command,
    cwd: approval.cwd,
    reason: approval.reason,
  });
  if (!outcome.approved) return "Not updated: the user declined the Confluence update.";

  const payload = await confluenceSend(ctx, base, `/rest/api/content/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify({
      id,
      type: "page",
      title,
      ...(current.space?.key ? { space: { key: current.space.key } } : {}),
      version: {
        number: currentVersion + 1,
        ...(optionalString(record, "versionMessage")
          ? { message: optionalString(record, "versionMessage") }
          : {}),
      },
      body: {
        storage: {
          value: combined,
          representation: "storage",
        },
      },
    }),
  });
  const updated = asRecord(payload) as ConfluencePage;
  const version = updated.version?.number ?? currentVersion + 1;
  const url = confluencePageUrl(base, updated._links) ?? pageUrl;
  return `Updated "${title}"${space} to version ${version}.\n${url}`;
}

function searchRow(page: ConfluencePage, base: string): string {
  const space = page.space?.key ? `[${page.space.key}] ` : "";
  const version = page.version?.number ? ` · v${page.version.number}` : "";
  const url = confluencePageUrl(base, page._links);
  return `- ${space}${page.title ?? "(untitled)"} · id=${page.id ?? "?"}${version}${url ? `\n  ${url}` : ""}`;
}

function formatPage(page: ConfluencePage, base: string, format: string): string {
  const title = page.title ?? "(untitled)";
  const space = page.space?.key ?? page.space?.name ?? "unknown space";
  const version = page.version?.number ?? "?";
  const url = confluencePageUrl(base, page._links);
  const storage = page.body?.storage?.value ?? "";
  const view = page.body?.view?.value ?? "";
  const text = confluenceText(view || storage);
  const lines = [
    `# ${title}`,
    `id: ${page.id ?? "?"}`,
    `space: ${space}`,
    `version: ${version}`,
    ...(url ? [`url: ${url}`] : []),
  ];
  if (format === "storage") {
    lines.push("", "Storage:", clip(storage, BODY_MAX));
  } else if (format === "both") {
    lines.push("", "Text:", clip(text, BODY_MAX), "", "Storage:", clip(storage, BODY_MAX));
  } else {
    lines.push("", clip(text || storage, BODY_MAX));
  }
  return lines.join("\n");
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…truncated`;
}

function markdownToStorage(markdownText: string): string {
  const html = markdown.render(markdownText);
  return html
    .replace(/<br\s*\/?>/gi, "<br/>")
    .replace(/<hr\s*\/?>/gi, "<hr/>")
    .replace(/<img([^>]*)>/gi, (whole, attributes: string) =>
      attributes.trimEnd().endsWith("/") ? whole : `<img${attributes}/>`,
    )
    .trim();
}

function confluenceAuthorization(ctx: ToolContext): string {
  const token = ctx.confluenceToken;
  if (!token) throw new Error("Confluence is not configured.");
  return ctx.confluenceMode === "cloud"
    ? `Basic ${Buffer.from(`${ctx.confluenceEmail ?? ""}:${token}`).toString("base64")}`
    : `Bearer ${token}`;
}

async function confluenceSend(
  ctx: ToolContext,
  base: string,
  path: string,
  init: { method: string; body?: string },
): Promise<unknown> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    Authorization: confluenceAuthorization(ctx),
  };
  if (init.body) headers["Content-Type"] = "application/json";
  const requested = `${base}${path}`;
  let response: Response;
  try {
    response = await confluenceFetch(requested, {
      method: init.method,
      headers,
      body: init.body,
      signal: AbortSignal.timeout(20_000),
    });
  } catch (error) {
    ctx.log?.(`Confluence request failed: ${error instanceof Error ? error.message : String(error)}`);
    throw new Error("Confluence could not be reached.");
  }
  const text = await response.text();
  if (!response.ok) {
    ctx.log?.(`Confluence ${init.method} ${path} returned HTTP ${response.status}.`);
    if (response.status === 401 || response.status === 403) {
      throw new Error("Confluence rejected the token. Check Settings → Confluence.");
    }
    if (response.status === 404) {
      throw new Error("That Confluence page was not found, or the token cannot see it.");
    }
    if (response.status === 409) {
      throw new Error("The page changed while it was being edited. Read it again and retry.");
    }
    if (response.status === 429) {
      throw new Error("Confluence is rate limiting requests. Try again shortly.");
    }
    throw new Error(`Confluence returned HTTP ${response.status}.`);
  }
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("Confluence returned a response that was not JSON.");
  }
}
