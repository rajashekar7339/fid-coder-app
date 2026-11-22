import assert from "node:assert/strict";
import test from "node:test";
import {
  DATADOG_AGENT_PROMPT,
  datadogBrowserReady,
  datadogLogsUrl,
  formatDatadogWindow,
  normalizeDatadogUrl,
  parseDatadogWindow,
} from "../../src/shared/datadog.ts";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const HOUR = 3_600_000;

test("the saved Datadog URL is normalized to a base", () => {
  assert.equal(normalizeDatadogUrl("https://app.datadoghq.com"), "https://app.datadoghq.com");
  assert.equal(normalizeDatadogUrl("https://app.datadoghq.com/"), "https://app.datadoghq.com");
  assert.equal(
    normalizeDatadogUrl("https://app.datadoghq.com/logs"),
    "https://app.datadoghq.com",
  );
  assert.equal(
    normalizeDatadogUrl("https://datadog.example.com/datadog/logs"),
    "https://datadog.example.com/datadog",
  );
  assert.equal(
    normalizeDatadogUrl("https://datadog.example.com/DD/logs"),
    "https://datadog.example.com/DD",
  );
  assert.equal(normalizeDatadogUrl("https://datadog.example.com/datadog"), "https://datadog.example.com/datadog");
  assert.equal(
    normalizeDatadogUrl("http://127.0.0.1:9999/logs?query=service%3Acheckout"),
    "http://127.0.0.1:9999",
  );
  assert.equal(
    normalizeDatadogUrl("https://app.datadoghq.com/monitors/12345?tab=status"),
    "https://app.datadoghq.com",
  );
});

test("an unsafe or incomplete Datadog URL is refused", () => {
  assert.throws(() => normalizeDatadogUrl(""), /Datadog URL/);
  assert.throws(() => normalizeDatadogUrl("not-a-url"), /full Datadog URL/);
  assert.throws(() => normalizeDatadogUrl("ftp://example.com"), /http/);
  assert.throws(
    () => normalizeDatadogUrl("https://user:pass@example.com"),
    /credentials/,
  );
});

test("browser mode needs only a saved URL", () => {
  assert.equal(datadogBrowserReady("https://app.datadoghq.com"), true);
  assert.equal(datadogBrowserReady(""), false);
  assert.equal(datadogBrowserReady(null), false);
  assert.equal(datadogBrowserReady("not-a-url"), false);
});

test("a relative window ends now and starts before it", () => {
  const window = parseDatadogWindow("2h", "now", { now: NOW });
  assert.equal(window.fromMs, NOW - 2 * HOUR);
  assert.equal(window.toMs, NOW);
  assert.equal(window.fromIso, "2026-11-20T10:00:00.000Z");
  assert.match(window.label, /2026-11-20 10:00:00Z – 2026-11-20 12:00:00Z UTC/);
});

test("an ISO window and now-relative time are accepted", () => {
  const iso = parseDatadogWindow("2026-11-20T09:00:00Z", "2026-11-20T11:00:00Z", { now: NOW });
  assert.equal(iso.fromMs, Date.parse("2026-11-20T09:00:00Z"));
  assert.equal(iso.toMs, Date.parse("2026-11-20T11:00:00Z"));
  const relative = parseDatadogWindow("now-30m", "now", { now: NOW });
  assert.equal(relative.fromMs, NOW - 30 * 60_000);
});

test("an invalid or too-wide window is refused", () => {
  assert.throws(
    () =>
      parseDatadogWindow("2026-11-20T12:00:00Z", "2026-11-20T11:00:00Z", { now: NOW }),
    /start time/,
  );
  assert.throws(() => parseDatadogWindow("48h", "now", { now: NOW }), /too wide/);
  assert.throws(() => parseDatadogWindow("yesterday-ish", "now", { now: NOW }), /Could not read/);
});

test("the log deep link keeps the query and the window", () => {
  const window = parseDatadogWindow("1h", "now", { now: NOW });
  const logs = new URL(datadogLogsUrl("https://app.datadoghq.com", "service:checkout status:error", window));
  assert.equal(logs.pathname, "/logs");
  assert.equal(logs.searchParams.get("query"), "service:checkout status:error");
  assert.equal(logs.searchParams.get("from_ts"), String(NOW - HOUR));
  assert.equal(logs.searchParams.get("to_ts"), String(NOW));
  assert.equal(logs.searchParams.get("live"), "false");
  assert.equal(formatDatadogWindow(NOW - HOUR, NOW), "2026-11-20 11:00:00Z – 2026-11-20 12:00:00Z UTC");
});

test("the default agent prompt uses browser mode and never asks for keys", () => {
  assert.match(DATADOG_AGENT_PROMPT, /datadog-triage/);
  assert.match(DATADOG_AGENT_PROMPT, /datadog-query/);
  assert.match(DATADOG_AGENT_PROMPT, /datadog_browser_logs/);
  assert.match(DATADOG_AGENT_PROMPT, /untrusted/);
  assert.match(DATADOG_AGENT_PROMPT, /never ask for, read, print, or store an API key/);
});
