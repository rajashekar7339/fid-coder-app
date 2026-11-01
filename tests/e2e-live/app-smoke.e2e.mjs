// Launch smoke test: agent and routine CRUD, settings, and a basic chat round trip.
// Set FID_CODER_SKIP_CHAT=1 to skip the chat round trip.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const userData = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-smoke-"));
const vite = spawn(process.execPath, [path.join(appDir, "node_modules", "vite", "bin", "vite.js")], {
  cwd: appDir,
  stdio: ["ignore", "pipe", "pipe"],
});

let viteLog = "";
vite.stdout.on("data", (chunk) => {
  viteLog += chunk.toString();
});
vite.stderr.on("data", (chunk) => {
  viteLog += chunk.toString();
});

const deadline = Date.now() + 30000;
while (!viteLog.includes("5173") && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!viteLog.includes("5173")) {
  console.log(viteLog);
  throw new Error("Vite did not start");
}

const app = await electron.launch({
  executablePath: path.join(appDir, "node_modules", "electron", "dist", "electron.exe"),
  args: ["."],
  cwd: appDir,
  env: { ...process.env, FID_CODER_USER_DATA: userData },
});
app.process().stdout?.on("data", (chunk) => process.stdout.write(`[electron] ${chunk}`));
app.process().stderr?.on("data", (chunk) => process.stderr.write(`[electron] ${chunk}`));

const page = await app.firstWindow();
page.on("console", (msg) => console.log(`[page:${msg.type()}] ${msg.text()}`));
page.on("pageerror", (error) => console.log(`[pageerror] ${error.message}`));
try {
  await page.waitForSelector("text=JIRA Agent", { timeout: 20000 });
  const hasBridge = await page.evaluate(() => Boolean(window.fid && window.fid.agents));
  if (!hasBridge) throw new Error("window.fid is missing");

  await page.getByRole("button", { name: /JIRA Agent/ }).first().click();
  await page.getByRole("button", { name: "Manage routines" }).click();
  await page.getByRole("button", { name: "New routine" }).first().click();
  await page.getByLabel("Name").fill("Hourly ping");
  await page.getByLabel("Instruction").fill("Say hello");
  await page.getByRole("button", { name: "Create routine" }).click();
  await page.getByRole("button", { name: /Hourly ping/ }).first().waitFor();
  await page.getByRole("button", { name: "Close routines" }).click();

  await page.getByRole("button", { name: "New agent" }).first().click();
  await page.getByLabel("Name").fill("Smoke Agent");
  await page.getByLabel("Instructions").fill("Reply briefly.");
  await page.getByRole("button", { name: "Create agent" }).click();
  await page.waitForSelector("text=Smoke Agent");

  await page.getByRole("button", { name: "Actions for Smoke Agent" }).click();
  await page.getByRole("menuitem", { name: "Delete agent" }).click();
  await page.locator(".confirm-modal").getByRole("button", { name: "Delete agent" }).click();
  await page.waitForSelector("text=Smoke Agent", { state: "detached" });

  await page.getByRole("button", { name: "Open settings" }).click();
  await page.waitForSelector("text=GitHub Copilot");
  console.log("SETTINGS\n" + (await page.locator(".settings-scroll").innerText()));
  await page.getByRole("button", { name: "Safety", exact: true }).click();
  await page.waitForSelector("text=Approval rules");
  console.log("SAFETY\n" + (await page.locator(".settings-scroll").innerText()));
  await page.getByRole("button", { name: "Close settings" }).click();

  await page.getByRole("button", { name: /JIRA Agent/ }).first().click();
  const jiraAgent = await page.evaluate(async () => {
    const agents = await window.fid.agents.list();
    return agents.find((agent) => agent.name === "JIRA Agent") ?? null;
  });
  if (!jiraAgent) throw new Error("JIRA Agent missing");
  await app.evaluate(({ BrowserWindow }, agent) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.webContents.send("chat:event", {
      agentId: agent.id,
      type: "approval-request",
      approval: {
        id: "smoke-approval",
        agentId: agent.id,
        agentName: agent.name,
        turnId: "abcdef12-3456-4789-8abc-def012345678",
        kind: "shell",
        title: "Run a sensitive command?",
        command: "git push origin main",
        cwd: "D:\\repo",
        reason: "This pushes commits to a remote repository.",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
  }, jiraAgent);
  await page.waitForSelector(".approval-card");
  console.log("APPROVAL\n" + (await page.locator(".approval-card").innerText()));
  await page.getByRole("button", { name: "Allow once" }).click();
  await page.waitForSelector(".approval-card", { state: "detached" });

  const gitAgent = await page.evaluate(async () => {
    const agents = await window.fid.agents.list();
    return agents.find((agent) => agent.name === "GIT PR Review") ?? null;
  });
  if (!gitAgent) throw new Error("GIT PR Review missing");
  await app.evaluate(({ BrowserWindow }, agent) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.webContents.send("chat:event", {
      agentId: agent.id,
      type: "approval-request",
      approval: {
        id: "smoke-approval-2",
        agentId: agent.id,
        agentName: agent.name,
        turnId: null,
        kind: "shell",
        title: "Run a sensitive command?",
        command: "del notes.tmp",
        cwd: "D:\\repo",
        reason: "This deletes files or data.",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
  }, gitAgent);
  await page.waitForSelector(".approval-notice");
  await page.getByRole("button", { name: /Approval needed for GIT PR Review/ }).click();
  await page.waitForSelector(".approval-card");
  await page.getByRole("button", { name: "Reject" }).click();
  await page.waitForSelector(".approval-card", { state: "detached" });

  await page.getByRole("button", { name: /JIRA Agent/ }).first().click();
  const input = page.getByPlaceholder("Message JIRA Agent");
  if (process.env.FID_CODER_SKIP_CHAT === "1") {
    console.log("CHAT skipped: FID_CODER_SKIP_CHAT=1");
  } else if (await input.isEnabled()) {
    const chat = await page.evaluate(async () => {
      const agents = await window.fid.agents.list();
      const todo = agents.find((agent) => agent.name === "JIRA Agent");
      if (!todo) return { ok: false, error: "JIRA Agent missing" };
      try {
        await window.fid.chat.send(todo.id, "Reply with only the word pong. Do not use tools.");
        const messages = await window.fid.messages.list(todo.id);
        const last = messages[messages.length - 1];
        return { ok: last?.role === "assistant" && last.content.trim() === "pong", last: last?.content ?? "" };
      } catch (error) {
        const messages = await window.fid.messages.list(todo.id);
        const last = messages[messages.length - 1];
        return { ok: false, error: error instanceof Error ? error.message : String(error), last: last?.content ?? "" };
      }
    });
    console.log(`CHAT ${chat.ok ? "ok" : "blocked"} ${chat.error || ""} ${chat.last || ""}`.slice(0, 500));
  } else {
    console.log("CHAT skipped: composer disabled");
  }

  console.log("SMOKE ok");
} catch (error) {
  console.log("URL", page.url());
  console.log("BODY", (await page.locator("body").innerText().catch(() => "")).slice(0, 2000));
  throw error;
} finally {
  await app.close().catch(() => undefined);
  vite.kill();
  fs.rmSync(userData, { recursive: true, force: true });
}
