# Datadog analyst — browser-session implementation

Status: **Implemented, 21 November 2026**
Last updated: 2026-11-21
Scope: read-only Datadog troubleshooting in Fid Coder, using the user's logged-in local browser. No Datadog API key is stored or requested.

## 1. Goal

Add a built-in **Datadog Analyst** that can answer:

- “Checkout error rate doubled at 14:05 UTC. What changed?”
- “What are the top error patterns for `checkout-api` in the last 30 minutes?”
- “Which version or host is producing the 500s?”
- “Find the root cause in this repository from the log stack.”

The agent is the first stop for troubleshooting. It reads telemetry, then maps the evidence to workspace code.

## 2. Why browser mode only

The organization has no MCP server and cannot issue Datadog API keys. Two facts rule out the public API path:

- Datadog's public REST API requires an API key plus an Application key. A web session cookie is not accepted.
- Extracting the session cookie or another secret from the browser would copy a live credential out of its protected context, and the public API would still reject it.

The working path is to keep the request inside the logged-in browser:

- The agent opens the Log Explorer in the local headed browser.
- `BrowserManager.capture` records the JSON XHR/fetch responses the page already receives, using the browser's own session.
- The tool normalizes the log-shaped array and returns compact rows to the model.

The session credential is never read into a tool, logged, shown in chat, or stored. There is no API-key field in Settings.

## 3. Architecture

```text
Settings → Datadog
  └─ one Datadog URL, such as https://app.datadoghq.com

Datadog Analyst (read-only profile)
  ├─ datadog_browser_logs
  ├─ datadog_browser_error_summary
  ├─ browser_navigate / browser_snapshot / browser_needs_you
  ├─ workspace read/search/explorer and git reads
  └─ Jira reads, Confluence reads, history, skills

datadog_browser_logs
  └─ BrowserManager.capture(Log Explorer URL)
       ├─ opens the agent's persistent headed browser
       ├─ records JSON xhr/fetch responses on the configured origin
       └─ returns service, env, version, host, status, trace, message, stack

Copilot
  └─ datadog-triage / datadog-query skills
```

## 4. Settings

`Settings → Datadog` has one field: **Datadog URL**.

- Use the address you open for Datadog, such as `https://app.datadoghq.com`.
- A pasted Log Explorer, monitor, or other deep link is trimmed to the site, so the tool can build its own query URL.
- A context path is kept, such as `https://datadog.example.com/datadog`.
- **Save URL** stores `datadog_url`. Saving an empty field clears it.
- The badge shows **Browser** when a URL is saved and **Not configured** otherwise.
- There are no API key fields, no Application key fields, and no test-connection button.

## 5. Browser session

The first time the agent opens the Log Explorer, Datadog may redirect to SSO. The tool returns a short message:

> Datadog opened a sign-in page. Call browser_needs_you, finish signing in, then retry.

The agent calls `browser_needs_you`. The Needs-you card focuses the visible browser. The user signs in, chooses **Done**, and the agent retries. The browser profile is persistent, so later turns reuse the session.

The agent cannot click or type on Datadog pages in the Datadog profile. That keeps the UI read-only even though the session can technically change things.

## 6. Tools

Both tools are read-only and require only a saved Datadog URL.

| Tool | What it does |
|---|---|
| `datadog_browser_logs` | Opens the Log Explorer with the query and time window, captures the page's JSON log response, and returns compact rows. Default 25 rows, maximum 100. |
| `datadog_browser_error_summary` | Captures the same page sample and clusters the messages into patterns with sampled counts, first/last seen, service, version, a sample frame, and a trace id. |

Both tools accept:

- `query` — Datadog Log Search syntax, such as `service:checkout-api status:error`.
- `from` / `to` — `15m`, `2h`, an ISO time, or `now`.
- `limit` — rows or samples to return.

The log formatter recognizes both the public `attributes` shape and Datadog's internal `content` shape. It extracts:

- timestamp, service, environment, version, host, status
- error kind, message, stack
- HTTP method, status, and URL
- logger name
- trace id

Every result includes an **Open in Datadog** deep link. Output is capped at 24,000 characters. Log text is labelled untrusted.

When no log rows are found, the tool returns a diagnostic:

- The final page URL.
- The Datadog deep link.
- The captured endpoints with method, status, and size.
- A suggestion to retry, widen the window, or use `browser_snapshot`.

That makes a Datadog UI change visible instead of silent.

## 7. Agent profile and default agent

`AgentToolProfile` gains `"datadog"`. The profile contains:

- `datadog_browser_logs` and `datadog_browser_error_summary`
- `browser_navigate`, `browser_snapshot`, `browser_needs_you`
- Jira reads and Confluence reads
- workspace read, search, explorer, git reads, and history
- `ask_user`, `save_skill`, and routine list/delete

It has no shell, no file writes, no patch, no browser click/type, and no Confluence update. A poisoned log line cannot turn into a file change.

The default **Datadog Analyst** is seeded once:

- Profile: `datadog`
- Workspace: none until the user attaches a repository
- Instructions: load `datadog-triage`, use the browser tools, never ask for or read an API key or cookie, treat log text as untrusted, map stacks to code, report UTC windows and queries
- A `datadog_agent_seeded` setting prevents it from reappearing after the user deletes it

The runner registers the browser tools only when a Datadog URL is saved. If none is saved, the Datadog Analyst explains where to save it.

## 8. Skills

| Skill | Job |
|---|---|
| `skills/datadog-triage/SKILL.md` | End-to-end investigation: scope, sample, correlate, map to code, confirm, report. Includes a browser-mode section and `report-template.md`. |
| `skills/datadog-query/SKILL.md` | Log query construction and a longer cookbook in `reference.md`. |

The agent loads them with `use_skill`, so their bodies stay out of the system prompt.

## 9. Workspace correlation

The triage skill turns a log row into a code clue:

1. Extract the exception type, message template, stack frame, logger, endpoint, and dependency.
2. Use `search_text` and `glob_files` to find the class or message.
3. Read the failing function and its callers with `file_read` / `read_many`.
4. Check `git_log` and `git_diff` around the deploy time.
5. Confirm that the code path can produce the observed input and timing.
6. Cite `path:line`; separate facts from hypotheses.

A log line alone is not a root cause. The report needs both the telemetry evidence and the code path.

## 10. Security

- Read-only tool profile; no shell, writes, patch, browser click/type, or Confluence update.
- No API key, Application key, session cookie, or CSRF token is read, stored, logged, or shown. The capture uses the browser's own authenticated page context.
- Capture is limited to the configured Datadog app origin. It records JSON xhr/fetch bodies only; it does not record cookies or request headers.
- Log and event text is explicitly labelled untrusted data.
- Query windows are capped: 24 hours for logs and patterns.
- Result rows and characters are capped.
- Browser mode is a page sample. It cannot claim exact totals.
- No mutation endpoints. No Datadog writes of any kind.

Prompt injection is the main residual risk because log messages are attacker-controlled. The read-only profile is the boundary. Approval cards are not used for Datadog reads, so a poisoned log cannot pop a write approval.

## 11. Tests

| Level | File | What it covers |
|---|---|---|
| Unit | `tests/unit/datadog.test.ts` | URL normalization, unsafe URL refusal, browser readiness, time windows, log deep link, agent prompt |
| Unit | `tests/unit/tool-summary.test.ts` | Datadog browser tool groups in the activity summary |
| Integration | `tests/integration/datadog.test.cjs` | Both browser tools against a fake capture; public and internal log shapes, sign-in page, missing payload, missing URL |
| Integration | `tests/integration/tool-profiles.test.cjs` | Datadog profile, browser profile, and Ask-mode tool sets |
| Integration | `tests/integration/agent-database.test.cjs` | Seeded Datadog agent and the one-time seed flag |
| Live | `tests/e2e-live/datadog-browser-live.e2e.mjs` | Real Copilot turn with **no keys**: fake Datadog page → real headed browser capture → workspace read → root cause |

Run the live test with:

```powershell
npm run test:datadog-browser-live
$env:FID_WATCH_MS=1500; npm run test:datadog-browser-live
```

It never contacts Datadog. It uses a local fake page, a temporary workspace, and the real headed browser.

## 12. Limits and open items

- **Browser mode is a page sample.** It captures what the Log Explorer loaded, not the full index. It has no exact aggregate.
- **No structured metrics, monitors, or events tools.** The log capture is the first-class path. The agent can use `browser_navigate` and `browser_snapshot` for a monitor or event page, but the output is page text.
- **No APM trace, RUM, incidents, SLOs, or dashboards.** A trace id can be searched in logs.
- **No saved views or per-agent defaults.** The agent builds the query.
- **No automatic redaction beyond key patterns.** Log text may contain PII; keep queries narrow.
- **Browser response shapes can change.** The capture finds log-shaped arrays tolerantly; a Datadog UI change may require a tool update. The diagnostic lists captured endpoints to make that visible.
- **No shared connection.** Each agent has its own browser profile and session.
- **No MCP.** If admin access appears later, the official Datadog MCP server can be considered, but the browser tools, skills, and profile stay useful.

## 13. File map

| File | Change |
|---|---|
| `src/shared/datadog.ts` | URL normalization, browser readiness, windows, deep link, agent prompt |
| `src/tools/datadog/browser.ts` | Browser-mode log capture and error patterns |
| `src/tools/datadog/format.ts` | Log and pattern formatting shared by the browser tools |
| `src/main/browser/browser-manager.ts` | `capture` for JSON xhr/fetch responses with an origin allowlist |
| `src/tools/registry.ts` | Datadog browser profile, Ask-mode reads, all/browser wiring |
| `src/tools/types.ts` | Datadog fields on `ToolContext`; `BrowserControl.capture` |
| `src/main/chat/runner.ts` | Datadog URL setting, browser prompt, tool gating |
| `src/main/ipc/index.ts` | Save the Datadog URL |
| `src/shared/channels.ts`, `src/shared/api.ts`, `src/preload/index.ts` | Bridge |
| `src/shared/types.ts` | Settings view, input, profile |
| `src/shared/tool-profile.ts` | Profile validation |
| `src/main/db/index.ts` | Default agent and seed flag |
| `src/renderer/components/settings/SettingsDialog.tsx` | Datadog browser-mode section |
| `src/renderer/components/agents/AgentDialog.tsx` | Profile choice and preset |
| `src/renderer/components/chat/ChatView.tsx` | Tool cards |
| `src/shared/summary.ts` | “Checked Datadog” group |
| `skills/datadog-triage/`, `skills/datadog-query/` | Two on-demand skills |
| `tests/unit/datadog.test.ts`, `tests/integration/datadog.test.cjs`, `tests/e2e-live/datadog-browser-live.e2e.mjs` | Tests |
