import { net } from "electron";
import type { BrowserContext, Cookie } from "playwright";
import { jiraCookieHeader, jiraSessionName } from "../../shared/jira-auth";
import type { JiraLoginResult } from "../../shared/types";
import { jiraBaseUrls } from "../../tools/jira/jira-format";
import { launchBrowserContext } from "../browser/browser-manager";
import { logInfo, logWarn } from "../log";
import { jiraLoginProfileDir } from "../paths";
import { secretKeys, setSecret } from "../secrets";

const LOGIN_TIMEOUT_MS = 10 * 60_000;
const POLL_INTERVAL_MS = 1_500;
const PROBE_TIMEOUT_MS = 10_000;
const PROGRESS_INTERVAL_MS = 30_000;

let activeContext: BrowserContext | null = null;
let activeLogin: Promise<JiraLoginResult> | null = null;

const jiraFetch: typeof fetch =
  typeof net?.fetch === "function" ? (net.fetch.bind(net) as unknown as typeof fetch) : fetch;

/**
 * Open a headed browser for Jira SSO, wait until /rest/api/2/myself confirms the
 * session, and save the verified Cookie header. Mirrors the older Python app's
 * browser login: cookies are the source of truth, not the visible page URL.
 */
export function jiraBrowserLogin(site: string): Promise<JiraLoginResult> {
  if (activeLogin) throw new Error("A Jira browser sign-in is already running.");
  const run = login(site).finally(() => {
    activeLogin = null;
  });
  activeLogin = run;
  return run;
}

export async function cancelJiraBrowserLogin(): Promise<void> {
  const context = activeContext;
  activeContext = null;
  if (context) await context.close().catch(() => undefined);
}

async function login(site: string): Promise<JiraLoginResult> {
  const bases = jiraBaseUrls(site).map((url) => url.toString());
  const context = await launchBrowserContext(jiraLoginProfileDir());
  activeContext = context;
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page
      .goto(bases[0]!, { waitUntil: "domcontentloaded", timeout: 120_000 })
      .catch(() => undefined);
    logInfo(`Jira browser sign-in opened ${bases[0]}.`);

    const deadline = Date.now() + LOGIN_TIMEOUT_MS;
    let lastProgress = Date.now();
    while (Date.now() < deadline) {
      if (!context.pages().some((candidate) => !candidate.isClosed())) {
        throw new Error("The Jira sign-in window was closed before a session was saved.");
      }
      const cookie = await cookieHeader(context, bases);
      if (cookie) {
        for (const base of bases) {
          const name = await probeSession(base, cookie);
          if (name) {
            setSecret(secretKeys.jiraCookie, cookie);
            logInfo(`Jira browser session saved for ${base}: user=${name}.`);
            return { name, url: base };
          }
        }
      }
      if (Date.now() - lastProgress >= PROGRESS_INTERVAL_MS) {
        lastProgress = Date.now();
        logWarn("Jira browser sign-in is still waiting for a verified session at /rest/api/2/myself.");
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(
      "Jira did not confirm the browser session. Finish signing in through SSO in the browser window, then try again.",
    );
  } finally {
    activeContext = null;
    await context.close().catch(() => undefined);
  }
}

async function cookieHeader(context: BrowserContext, bases: string[]): Promise<string> {
  let cookies: Cookie[];
  try {
    cookies = await context.cookies(bases);
  } catch {
    return "";
  }
  return jiraCookieHeader(cookies.map(({ name, value }) => ({ name, value })));
}

async function probeSession(base: string, cookie: string): Promise<string | null> {
  const requested = `${base.replace(/\/+$/, "")}/rest/api/2/myself`;
  let response: Response;
  try {
    response = await jiraFetch(requested, {
      method: "GET",
      headers: { Accept: "application/json", Cookie: cookie },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
  } catch {
    return null;
  }
  if (!response.ok) return null;
  if (!/json/i.test(response.headers.get("content-type") ?? "")) return null;
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }
  return jiraSessionName(payload);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
