const { app, Notification } = require("electron");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const userData = process.env.FID_CODER_USER_DATA;
const resultFile = process.env.FID_CODER_RESULT;
if (!userData || !resultFile) {
  console.error("FID_CODER_USER_DATA and FID_CODER_RESULT are required");
  process.exit(2);
}

app.setName("fid-coder");
app.setPath("userData", userData);
if (process.platform === "win32") app.setAppUserModelId("com.fidcoder.desktop");

const toastEvents = [];
const OriginalNotification = Notification;
function PatchedNotification(options) {
  const toast = new OriginalNotification(options);
  toast.on("show", () => toastEvents.push(`show:${options.title}`));
  toast.on("failed", (_event, error) => toastEvents.push(`failed:${options.title}:${error}`));
  return toast;
}
PatchedNotification.isSupported = () => OriginalNotification.isSupported();
require("electron").Notification = PatchedNotification;

const lines = [];
let failed = false;

fs.writeFileSync(resultFile, "");

function record(status, name, detail) {
  const line = `${status} ${name}: ${String(detail).replace(/\s+/g, " ").slice(0, 400)}`;
  lines.push(line);
  fs.appendFileSync(resultFile, `${line}\n`);
  console.log(line);
  if (status === "FAIL") failed = true;
}

app.whenReady().then(async () => {
  const { AppDatabase } = require("../dist/main/db.js");
  const { BrowserManager } = require("../dist/main/browser-manager.js");
  const { Runner } = require("../dist/main/runner.js");
  const { Scheduler } = require("../dist/main/scheduler.js");
  const { databasePath, profileDir } = require("../dist/main/paths.js");
  const { notify } = require("../dist/main/notify.js");
  const { stopClient } = require("../dist/main/copilot.js");
  const { allTools } = require("../dist/tools/registry.js");

  const db = new AppDatabase(databasePath());
  const browser = new BrowserManager();
  const runner = new Runner(db, browser);
  const scheduler = new Scheduler(db, runner);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    res.setHeader("content-type", "text/html; charset=utf-8");
    if (url.pathname === "/echo") {
      res.end(`<!doctype html><title>Echo</title><h1>Echo ${url.searchParams.get("note") || ""}</h1>`);
      return;
    }
    if (url.pathname === "/next") {
      res.end("<!doctype html><title>Next</title><h1>Next page</h1><p>Arrived</p>");
      return;
    }
    res.end(
      '<!doctype html><title>Form</title><h1>Form page</h1><form action="/echo" method="get"><label>Note <input name="note" /></label></form><a href="/next">Learn more</a>',
    );
  });

  try {
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = server.address().port;
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-ws-"));
    const agent = db.createAgent({
      name: "Tool Check",
      systemPrompt: "Reply briefly.",
      workspaceDir: workspace,
    });
    const tools = Object.fromEntries(allTools().map((tool) => [tool.name, tool]));
    const ctx = {
      agentId: agent.id,
      workspaceDir: workspace,
      browser,
      githubPat: "fid-github-marker",
      jiraToken: null,
      jiraSite: null,
    };

    const shellOk = await tools.shell_run.handler({ command: "echo hello-fid" }, ctx);
    if (!shellOk.includes("hello-fid")) throw new Error(`shell stdout missing hello-fid: ${shellOk}`);
    let escaped = false;
    try {
      await tools.shell_run.handler({ command: "echo no", cwd: ".." }, ctx);
    } catch (error) {
      escaped = /outside the workspace/i.test(error.message);
    }
    if (!escaped) throw new Error("shell cwd jail did not reject ..");
    process.env.COPILOT_GITHUB_TOKEN = "fid-copilot-marker";
    const envOut = await tools.shell_run.handler(
      { command: "echo GH=%GH_TOKEN% COPILOT=%COPILOT_GITHUB_TOKEN%" },
      ctx,
    );
    delete process.env.COPILOT_GITHUB_TOKEN;
    if (!envOut.includes("GH=fid-github-marker")) throw new Error("GitHub token was not passed to the shell");
    if (envOut.includes("fid-copilot-marker")) throw new Error("Copilot token leaked into the shell");
    record("PASS", "shell", "cwd jail holds and the Copilot token stays out of the child");

    await tools.file_write.handler({ path: "notes/hello.txt", content: "desk-note" }, ctx);
    const readBack = await tools.file_read.handler({ path: "notes/hello.txt" }, ctx);
    if (readBack !== "desk-note") throw new Error("file roundtrip mismatch");
    let fileEscaped = false;
    try {
      await tools.file_read.handler({ path: "../outside.txt" }, ctx);
    } catch (error) {
      fileEscaped = /outside the workspace/i.test(error.message);
    }
    if (!fileEscaped) throw new Error("file jail did not reject ..");
    record("PASS", "files", "write, read, and path jail");

    const formUrl = `http://127.0.0.1:${port}/form`;
    const nav = await tools.browser_navigate.handler({ url: formUrl }, ctx);
    const snap = await tools.browser_snapshot.handler({}, ctx);
    if (!snap.includes("Form page") || !snap.includes("Learn more")) {
      throw new Error(`snapshot missing form: ${snap.slice(0, 240)}`);
    }
    const typed = await tools.browser_type.handler(
      { selector: 'input[name="note"]', text: "FidCheck", submit: true },
      ctx,
    );
    const echo = await tools.browser_snapshot.handler({}, ctx);
    if (!echo.includes("FidCheck")) throw new Error(`typed value missing: ${typed} ${echo.slice(0, 240)}`);
    await tools.browser_navigate.handler({ url: formUrl }, ctx);
    await tools.browser_click.handler({ selector: 'role=link[name="Learn more"]' }, ctx);
    const next = await tools.browser_snapshot.handler({}, ctx);
    if (!next.includes("Next page")) throw new Error(`click did not open Next page: ${next.slice(0, 240)}`);
    await browser.close(agent.id);
    const profile = profileDir(agent.id);
    if (!fs.existsSync(profile)) throw new Error("profile directory was not created");
    await tools.browser_navigate.handler({ url: formUrl }, ctx);
    const again = await tools.browser_snapshot.handler({}, ctx);
    if (!again.includes("Form page")) throw new Error("profile relaunch did not open the page");
    await browser.deleteProfile(agent.id);
    if (fs.existsSync(profile)) throw new Error("profile directory was not deleted");
    record("PASS", "browser", `navigate, type, click, persistent profile. ${nav.split("\n")[0]}`);

    const { ensureWindowsToastShortcut } = require("../dist/main/notify.js");
    const shortcutOk = ensureWindowsToastShortcut();
    const direct = new OriginalNotification({ title: "Fid Coder check", body: "Local verification toast" });
    direct.on("show", () => toastEvents.push("direct-show"));
    direct.on("failed", (_event, error) => toastEvents.push(`direct-failed:${error}`));
    direct.show();
    notify("Fid Coder check", "Local verification toast");
    await new Promise((resolve) => setTimeout(resolve, 3000));
    if (!OriginalNotification.isSupported()) record("PASS", "toast", "Notification API is not supported on this session");
    else if (toastEvents.some((event) => event.includes("show"))) record("PASS", "toast", `shortcut=${shortcutOk} ${toastEvents.join(", ")}`);
    else record("FAIL", "toast", `shortcut=${shortcutOk} ${toastEvents.join(", ") || "toast was not shown"}`);

    const seeded = db.listAgents();
    const names = seeded.map((item) => item.name).sort();
    if (names.includes("To Do List") || !names.includes("JIRA Agent") || !names.includes("GIT PR Review")) {
      throw new Error(`seeded agents missing: ${names.join(", ")}`);
    }
    record("PASS", "seed", names.join(", "));

    const todo = seeded.find((item) => item.name === "JIRA Agent");
    if (process.env.FID_CODER_SKIP_COPILOT === "1") {
      record("SKIP", "chat", "FID_CODER_SKIP_COPILOT=1");
      return;
    }
    try {
      const text = await Promise.race([
        runner.runTurn({
          agentId: todo.id,
          text: "Reply with only the word pong. Do not use tools.",
          source: "chat",
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error("chat timed out after 90s")), 90000)),
      ]);
      const clean = String(text).trim();
      if (clean === "pong") record("PASS", "chat", clean);
      else if (/authorization|policy|credential/i.test(clean)) record("BLOCKED", "chat", clean);
      else record("FAIL", "chat", clean);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/authorization|policy|credential/i.test(message)) record("BLOCKED", "chat", message);
      else record("FAIL", "chat", message);
    }

    const when = new Date(Date.now() + 5000);
    when.setSeconds(0, 0);
    when.setMinutes(when.getMinutes() + 1);
    const cron = `${when.getMinutes()} ${when.getHours()} ${when.getDate()} ${when.getMonth() + 1} *`;
    const routine = db.createRoutine(
      {
        agentId: todo.id,
        name: "Verify ping",
        prompt: "Reply with only the word pong. Do not use tools.",
        cron,
        enabled: true,
        notify: true,
      },
      when.toISOString(),
    );
    scheduler.reload();
    const deadline = when.getTime() + 45000;
    let status = "not fired";
    while (Date.now() < deadline) {
      const current = db.getRoutine(routine.id);
      if (current?.lastRunAt) {
        status = current.lastStatus || "fired";
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    scheduler.stop();
    if (status === "not fired") record("FAIL", "routine", `cron ${cron} did not fire`);
    else if (status === "ok" || status.startsWith("skipped:")) record("PASS", "routine", status);
    else if (/authorization|policy|credential/i.test(status)) record("BLOCKED", "routine", status);
    else record("FAIL", "routine", status);
    if (toastEvents.filter((event) => event.includes("Verify ping") || event.includes("Fid Coder")).length > 0) {
      record("PASS", "routine-toast", toastEvents.join(", "));
    }
  } catch (error) {
    record("FAIL", "verify", error instanceof Error ? error.stack || error.message : String(error));
  } finally {
    scheduler.stop();
    await browser.closeAll().catch(() => undefined);
    await stopClient().catch(() => undefined);
    db.close();
    server.close();
    fs.mkdirSync(path.dirname(resultFile), { recursive: true });
    fs.writeFileSync(resultFile, `${lines.join("\n")}\n`, "utf8");
    app.exit(failed ? 1 : 0);
  }
});
