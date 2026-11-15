// Deterministic Electron UI test for the browser handoff card and the save-skill card.
//
// Usage:
//   npm run test:handoff
//   FID_WATCH_MS=900 npm run test:handoff
//
// No Copilot turn. The runner round trip lives in tests/integration/handoff-skill.test.cjs.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { _electron as electron } from "playwright";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-coder-handoff-"));
const userData = path.join(root, "userdata");
const shots = path.join(root, "shots");
const agentName = "Handoff E2E";
const otherAgentName = "Handoff Banner E2E";
const watchMs = Number(process.env.FID_WATCH_MS ?? 0);
const require = createRequire(import.meta.url);
const { AppDatabase } = require("../../dist/main/db/index.js");

const results = [];
let vite = null;
let app = null;
let page = null;

function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  (${detail})` : ""}`);
}

async function pause(ms = 8) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function watch(ms = watchMs) {
  if (watchMs > 0) await new Promise((resolve) => setTimeout(resolve, ms));
}

function handoff(agent, id, reason) {
  return {
    id,
    agentId: agent.id,
    agentName: agent.name,
    reason,
    takenOver: false,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
  };
}

function skillSave(agent, id, replaces = false) {
  return {
    id,
    agentId: agent.id,
    agentName: agent.name,
    skillId: "release-notes",
    name: "Release notes",
    description: "Write the notes from merged pull requests.",
    steps: "1. Read the merged pull requests.\n2. Draft the notes.",
    replaces,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

async function seed() {
  fs.mkdirSync(userData, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  const db = new AppDatabase(path.join(userData, "fid-coder.sqlite"));
  const agent = db.createAgent({
    name: agentName,
    description: "Seeded handoff card",
    systemPrompt: "Ask before guessing.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
    readOnly: false,
    memoryEnabled: false,
  });
  const otherAgent = db.createAgent({
    name: otherAgentName,
    description: "Seeded handoff banner",
    systemPrompt: "Ask before guessing.",
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
    readOnly: false,
    memoryEnabled: false,
  });
  db.addMessage(agent.id, "user", "Open the release page.");
  db.addMessage(agent.id, "assistant", "The page needs you to sign in.");
  db.close();
  return { agent, otherAgent };
}

async function viteRunning() {
  try {
    const response = await fetch("http://127.0.0.1:5173", { signal: AbortSignal.timeout(1000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function ensureVite() {
  if (await viteRunning()) {
    console.log("vite: reusing the server on 5173");
    return;
  }
  let log = "";
  vite = spawn(
    process.execPath,
    [path.join(appDir, "node_modules", "vite", "bin", "vite.js"), "--port", "5173", "--strictPort"],
    { cwd: appDir, stdio: ["ignore", "pipe", "pipe"] },
  );
  vite.stdout.on("data", (chunk) => {
    log += chunk.toString();
  });
  vite.stderr.on("data", (chunk) => {
    log += chunk.toString();
  });
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (await viteRunning()) {
      console.log("vite: started on 5173");
      return;
    }
    await pause(250);
  }
  console.log(log.slice(-3000));
  throw new Error("Vite did not start on 5173");
}

async function shot(name) {
  const file = path.join(shots, `${name}.png`);
  await page.screenshot({ path: file });
  console.log("  shot:", file);
}

async function ensureAgent(name) {
  await page.waitForSelector(".agent-row", { timeout: 30_000 });
  const title = await page.locator(".chat-title h1").first().innerText().catch(() => "");
  if (title.trim() === name) return;
  await page.locator(".agent-row").filter({ hasText: name }).first().click();
  await page.waitForFunction(
    (wanted) => document.querySelector(".chat-title h1")?.textContent?.trim() === wanted,
    name,
    { timeout: 15_000 },
  );
}

async function installStubs() {
  await app.evaluate(({ ipcMain }) => {
    const state = {
      handoff: null,
      takeoverId: null,
      doneId: null,
      doneResult: true,
      focusOpen: false,
      skill: null,
      decision: null,
    };
    globalThis.__fidHandoffE2E = state;
    ipcMain.removeHandler("browser:handoff-takeover");
    ipcMain.handle("browser:handoff-takeover", (_event, id) => {
      state.takeoverId = id;
      return state.focusOpen;
    });
    ipcMain.removeHandler("browser:handoff-done");
    ipcMain.handle("browser:handoff-done", (_event, id) => {
      state.doneId = id;
      if (!state.doneResult || !state.handoff || state.handoff.id !== id) return false;
      state.handoff = null;
      return true;
    });
    ipcMain.removeHandler("browser:handoffs-pending");
    ipcMain.handle("browser:handoffs-pending", () => (state.handoff ? [state.handoff] : []));
    ipcMain.removeHandler("skills:save-decide");
    ipcMain.handle("skills:save-decide", (_event, id, allow, draft) => {
      state.decision = { id, allow, draft };
      if (!state.skill || state.skill.id !== id) return false;
      state.skill = null;
      return true;
    });
    ipcMain.removeHandler("skills:save-pending");
    ipcMain.handle("skills:save-pending", () => (state.skill ? [state.skill] : []));
  });
}

async function send(payload) {
  await app.evaluate(({ BrowserWindow }, next) => {
    const state = globalThis.__fidHandoffE2E;
    if (next.handoff) {
      state.takeoverId = null;
      state.doneId = null;
      state.handoff = next.handoff;
    }
    if (next.skill) {
      state.decision = null;
      state.skill = next.skill;
    }
    BrowserWindow.getAllWindows()[0]?.webContents.send("chat:event", next.event);
  }, payload);
}

async function readState(field) {
  return app.evaluate(async (key) => {
    const state = globalThis.__fidHandoffE2E;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (state[key]) {
        return { takeoverId: state.takeoverId, doneId: state.doneId, decision: state.decision };
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return { takeoverId: state.takeoverId, doneId: state.doneId, decision: state.decision };
  }, field);
}

async function main() {
  const { agent, otherAgent } = await seed();
  await ensureVite();
  try {
    app = await electron.launch({
      executablePath: path.join(appDir, "node_modules", "electron", "dist", "electron.exe"),
      args: ["."],
      cwd: appDir,
      env: { ...process.env, FID_CODER_USER_DATA: userData },
      timeout: 60_000,
    });
    page = await app.firstWindow({ timeout: 60_000 });
    page.on("pageerror", (error) => console.log("[pageerror]", error.message));
    await page.waitForSelector(".app-shell", { timeout: 60_000 });
    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.setSize(1280, 900);
    });
    await ensureAgent(agentName);
    await installStubs();

    const first = handoff(agent, "handoff-main", "Sign in to GitHub");
    await send({
      handoff: first,
      event: { agentId: agent.id, type: "handoff-request", handoff: first },
    });
    const handoffCard = page.locator('[aria-label="Needs you"]');
    await handoffCard.waitFor({ timeout: 10_000 });
    await watch();
    const cardText = await handoffCard.innerText();
    check("the card shows the reason", /Sign in to GitHub/.test(cardText) && /needs you/i.test(cardText), cardText.replace(/\s+/g, " ").slice(0, 180));
    check("the card shows a countdown", /\d+:\d{2}/.test(await handoffCard.locator(".question-countdown").innerText()));
    const browserSwitch = handoffCard.getByRole("switch", { name: "I have the browser" });
    check("the switch starts off", (await browserSwitch.getAttribute("aria-checked")) === "false");
    await shot("01-handoff");

    await browserSwitch.click();
    await watch();
    const taken = await readState("takeoverId");
    check("takeover reaches the main process", taken.takeoverId === first.id, JSON.stringify({ takeoverId: taken.takeoverId }));
    check("a closed window stays taken over", (await browserSwitch.getAttribute("aria-checked")) === "true" && (await browserSwitch.isDisabled()));
    check(
      "a missing window is reported on the card",
      /not open yet/.test(await handoffCard.innerText()),
    );
    await shot("02-taken");

    await handoffCard.getByRole("button", { name: "Done" }).click();
    await watch();
    const done = await readState("doneId");
    check("Done reaches the main process", done.doneId === first.id, JSON.stringify({ doneId: done.doneId }));
    await handoffCard.waitFor({ state: "detached", timeout: 10_000 });
    check("Done closes the card", true);

    const resolved = handoff(agent, "handoff-resolved", "Solve the captcha");
    await send({
      handoff: resolved,
      event: { agentId: agent.id, type: "handoff-request", handoff: resolved },
    });
    await page.locator('[aria-label="Needs you"]').waitFor({ timeout: 10_000 });
    await send({
      event: { agentId: agent.id, type: "handoff-resolved", handoffId: resolved.id, source: "timeout" },
    });
    await page.locator('[aria-label="Needs you"]').waitFor({ state: "detached", timeout: 10_000 });
    check("a resolved event closes the handoff card", true);

    const banner = handoff(otherAgent, "handoff-banner", "Sign in there");
    await send({
      handoff: banner,
      event: { agentId: otherAgent.id, type: "handoff-request", handoff: banner },
    });
    await page.locator(".approval-notice").waitFor({ timeout: 10_000 });
    const bannerText = await page.locator(".approval-notice").innerText();
    check(
      "another agent's handoff shows in the top bar",
      /Needs you in the browser for Handoff Banner E2E/.test(bannerText),
      bannerText.replace(/\s+/g, " ").slice(0, 160),
    );
    await page.locator(".approval-notice").click();
    await page.waitForFunction(
      (wanted) => document.querySelector(".chat-title h1")?.textContent?.trim() === wanted,
      otherAgentName,
      { timeout: 15_000 },
    );
    await page.locator('[aria-label="Needs you"]').waitFor({ timeout: 10_000 });
    check("opening the other agent shows its card", /Sign in there/.test(await page.locator('[aria-label="Needs you"]').innerText()));
    await page.locator('[aria-label="Needs you"]').getByRole("button", { name: "Done" }).click();
    await page.locator('[aria-label="Needs you"]').waitFor({ state: "detached", timeout: 10_000 });
    await ensureAgent(agentName);

    const skill = skillSave(agent, "skill-deny");
    await send({
      skill,
      event: { agentId: agent.id, type: "skill-save-request", request: skill },
    });
    const skillCard = page.locator('[aria-label="Save skill"]');
    await skillCard.waitFor({ timeout: 10_000 });
    await watch();
    const skillText = await skillCard.innerText();
    const skillName = await skillCard.getByLabel("Skill name").inputValue();
    const skillDescription = await skillCard.getByLabel("Skill description").inputValue();
    const skillSteps = await skillCard.getByLabel("Skill steps").inputValue();
    check(
      "the skill card shows editable name, description, and steps",
      skillName === "Release notes" &&
        /merged pull requests/.test(skillDescription) &&
        /Draft the notes/.test(skillSteps),
      `${skillName} | ${skillDescription} | ${skillSteps}`.slice(0, 180),
    );
    check("a new skill does not say it replaces one", !/Replaces installed skill/.test(skillText));
    await shot("03-skill");
    await skillCard.getByRole("button", { name: "Don't save" }).click();
    await watch();
    const denied = await readState("decision");
    check(
      "Don't save reaches the main process",
      denied.decision?.id === skill.id && denied.decision.allow === false,
      JSON.stringify(denied.decision),
    );
    await skillCard.waitFor({ state: "detached", timeout: 10_000 });
    check("Don't save closes the card", true);

    const replacing = skillSave(agent, "skill-save", true);
    await send({
      skill: replacing,
      event: { agentId: agent.id, type: "skill-save-request", request: replacing },
    });
    await page.locator('[aria-label="Save skill"]').waitFor({ timeout: 10_000 });
    check(
      "replacing a skill is shown on the card",
      /Replaces installed skill release-notes/.test(await page.locator('[aria-label="Save skill"]').innerText()),
    );
    await shot("04-replaces");
    await page.locator('[aria-label="Save skill"]').getByLabel("Skill steps").fill("Edited step: check the changelog.");
    await page.locator('[aria-label="Save skill"]').getByRole("button", { name: "Save", exact: true }).click();
    await watch();
    const allowed = await readState("decision");
    check(
      "the edited draft reaches the main process",
      allowed.decision?.id === replacing.id &&
        allowed.decision.allow === true &&
        allowed.decision.draft?.steps === "Edited step: check the changelog.",
      JSON.stringify(allowed.decision),
    );
    await page.locator('[aria-label="Save skill"]').waitFor({ state: "detached", timeout: 10_000 });
    check("Save closes the card", true);

    const skillBanner = skillSave(otherAgent, "skill-banner");
    await send({
      skill: skillBanner,
      event: { agentId: otherAgent.id, type: "skill-save-request", request: skillBanner },
    });
    await page.locator(".approval-notice").waitFor({ timeout: 10_000 });
    check(
      "another agent's skill shows in the top bar",
      /Save a skill for Handoff Banner E2E/.test(await page.locator(".approval-notice").innerText()),
    );
    await page.locator(".approval-notice").click();
    await page.locator('[aria-label="Save skill"]').waitFor({ timeout: 10_000 });
    await page.locator('[aria-label="Save skill"]').getByRole("button", { name: "Don't save" }).click();
    await page.locator('[aria-label="Save skill"]').waitFor({ state: "detached", timeout: 10_000 });
    check("the other agent's skill card can be declined", true);
  } finally {
    await app?.close().catch(() => undefined);
    if (vite) {
      vite.kill();
      await pause(250);
      vite = null;
    }
  }

  const failed = results.filter((result) => !result.ok);
  console.log(`\nSUMMARY: ${results.length - failed.length}/${results.length} passed`);
  console.log(`ARTIFACTS: ${root}`);
  if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
