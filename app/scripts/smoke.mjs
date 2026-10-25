import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
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

  await page.getByRole("button", { name: "JIRA Agent" }).click();
  await page.getByRole("button", { name: "Routines" }).click();
  await page.getByPlaceholder("Name").fill("Hourly ping");
  await page.getByPlaceholder("Prompt to run").fill("Say hello");
  await page.getByRole("button", { name: "Add routine" }).click();
  await page.waitForSelector("text=Hourly ping");
  await page.getByRole("button", { name: "Close", exact: true }).click();

  await page.getByRole("button", { name: "New agent" }).click();
  await page.getByRole("textbox").nth(0).fill("Smoke Agent");
  await page.locator("textarea").first().fill("Reply briefly.");
  await page.getByRole("button", { name: "Save" }).click();
  await page.waitForSelector("text=Smoke Agent");

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Delete" }).click();
  await page.waitForSelector("text=Smoke Agent", { state: "detached" });

  await page.getByRole("button", { name: "Settings" }).click();
  await page.waitForSelector("text=GitHub Copilot");
  console.log("SETTINGS\n" + (await page.locator("section").first().innerText()));

  await page.getByRole("button", { name: "JIRA Agent" }).click();
  const input = page.getByPlaceholder("Message JIRA Agent");
  if (await input.isEnabled()) {
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
