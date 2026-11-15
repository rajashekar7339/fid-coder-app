// Browser handoff and save-skill wait for the user without a Copilot call.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const secrets = require("../../dist/main/secrets.js");
secrets.hasSecret = () => false;
secrets.getSecret = () => null;

const copilot = require("../../dist/main/copilot/index.js");
copilot.getCopilotStatus = async () => ({ signedIn: true, authStatus: "Signed in" });
let behavior = async () => ({ data: { content: "answer" } });
copilot.openSession = async (input) => ({
  session: {
    sendAndWait: (request) => behavior(input, request),
    on: () => () => {},
    disconnect: async () => undefined,
    abort: async () => undefined,
  },
  unsubscribe: () => {},
});

const { Runner } = require("../../dist/main/chat/runner.js");
const { AppDatabase } = require("../../dist/main/db/index.js");
const { HANDOFF_TIMEOUT_MS } = require("../../dist/shared/browser-handoff.js");
const { QUESTION_HINT } = require("../../dist/shared/question.js");
const { SKILL_SAVE_TIMEOUT_MS } = require("../../dist/shared/skill-draft.js");
const { parseSkillMarkdown } = require("../../dist/shared/skills.js");

async function withRunner(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-handoff-"));
  const previousUserData = process.env.FID_CODER_USER_DATA;
  process.env.FID_CODER_USER_DATA = root;
  const calls = [];
  const browser = {
    focusOpen: true,
    navigate: async (_id, url) => {
      calls.push(["navigate", url]);
      return "opened";
    },
    snapshot: async () => {
      calls.push(["snapshot"]);
      return "page";
    },
    click: async (_id, selector) => {
      calls.push(["click", selector]);
      return `clicked ${selector}`;
    },
    type: async () => "typed",
    focus: async () => browser.focusOpen,
  };
  const db = new AppDatabase(path.join(root, "app.sqlite"));
  const runner = new Runner(db, browser, { finalizeTurn: () => undefined });
  try {
    await run(db, runner, browser, calls, root);
  } finally {
    db.close();
    if (previousUserData === undefined) delete process.env.FID_CODER_USER_DATA;
    else process.env.FID_CODER_USER_DATA = previousUserData;
    fs.rmSync(root, { recursive: true, force: true });
  }
}

function createAgent(db, profile = "browser", readOnly = false) {
  return db.createAgent({
    name: "Browser",
    systemPrompt: "Help.",
    workspaceDir: null,
    model: "auto",
    toolProfile: profile,
    readOnly,
    memoryEnabled: false,
  });
}

function toolNamed(input, name) {
  const tool = input.tools.find((item) => item.name === name);
  assert.ok(tool, name);
  return tool;
}

test("a handoff blocks the browser until Done, then requires a snapshot", async () => {
  await withRunner(async (db, runner, browser, calls) => {
    const agent = createAgent(db);
    const notes = [];
    const events = [];
    runner.setSink((event) => {
      if (event.type.startsWith("handoff-")) events.push(event.type);
    });
    behavior = async (input) => {
      const handoff = toolNamed(input, "browser_needs_you");
      const click = toolNamed(input, "browser_click");
      const navigate = toolNamed(input, "browser_navigate");
      const snapshot = toolNamed(input, "browser_snapshot");
      const ctx = input.getContext();
      const pending = handoff.handler({ reason: "  Sign in to GitHub  " }, ctx);
      const card = runner.listPendingHandoffs(agent.id)[0];
      assert.equal(card.reason, "Sign in to GitHub");
      assert.equal(card.takenOver, false);
      await assert.rejects(() => handoff.handler({ reason: "Again" }, ctx), /already waiting/);
      await assert.rejects(() => click.handler({ selector: "role=button" }, ctx), /waiting for you/);
      await assert.rejects(() => snapshot.handler({}, ctx), /waiting for you/);
      assert.equal(calls.some((call) => call[0] === "snapshot"), false);
      browser.focusOpen = false;
      assert.equal(await runner.takeoverHandoff(card.id), false);
      assert.equal(runner.listPendingHandoffs(agent.id)[0].takenOver, true);
      await assert.rejects(() => click.handler({ selector: "role=button" }, ctx), /waiting for you/);
      assert.equal(runner.completeHandoff(card.id), true);
      assert.match(await pending, /handed the browser back/);
      assert.equal(runner.listPendingHandoffs(agent.id).length, 0);
      await assert.rejects(() => click.handler({ selector: "role=button" }, ctx), /fresh browser_snapshot/);
      await assert.rejects(
        () => navigate.handler({ url: "https://example.com" }, ctx),
        /fresh browser_snapshot/,
      );
      assert.equal(await snapshot.handler({}, ctx), "page");
      assert.equal(await click.handler({ selector: "role=button" }, ctx), "clicked role=button");
      return { data: { content: "Signed in." } };
    };
    assert.equal(
      await runner.runTurn({
        agentId: agent.id,
        text: "Open GitHub.",
        source: "chat",
        notify: (text) => notes.push(text),
      }),
      "Signed in.",
    );
    assert.ok(notes.some((note) => note.startsWith("Needs you in the browser: Sign in to GitHub")));
    assert.deepEqual(events, ["handoff-request", "handoff-updated", "handoff-resolved"]);
  });
});

test("stopping a handoff still requires a fresh snapshot", async () => {
  await withRunner(async (db, runner) => {
    const agent = createAgent(db);
    behavior = async (input) => {
      const handoff = toolNamed(input, "browser_needs_you");
      const click = toolNamed(input, "browser_click");
      const ctx = input.getContext();
      const pending = handoff.handler({ reason: "Captcha" }, ctx);
      const closing = runner.abort(agent.id);
      await assert.rejects(pending, /closed before/);
      await closing;
      await assert.rejects(() => click.handler({ selector: "a" }, ctx), /fresh browser_snapshot/);
      assert.equal(await toolNamed(input, "browser_snapshot").handler({}, ctx), "page");
      assert.equal(await click.handler({ selector: "a" }, ctx), "clicked a");
      return { data: { content: "stopped" } };
    };
    assert.equal(await runner.runTurn({ agentId: agent.id, text: "Continue.", source: "chat" }), "stopped");
  });
});

test("a handoff timeout continues without a password", { timeout: 10_000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await withRunner(async (db, runner) => {
    const agent = createAgent(db);
    behavior = async (input) => {
      const pending = toolNamed(input, "browser_needs_you").handler({ reason: "Sign in" }, input.getContext());
      t.mock.timers.tick(HANDOFF_TIMEOUT_MS);
      assert.match(await pending, /did not finish/);
      assert.match(await pending, /Do not type a password/);
      await assert.rejects(
        () => toolNamed(input, "browser_click").handler({ selector: "a" }, input.getContext()),
        /fresh browser_snapshot/,
      );
      return { data: { content: "continued" } };
    };
    assert.equal(await runner.runTurn({ agentId: agent.id, text: "Open it.", source: "chat" }), "continued");
  });
});

test("save skill writes one file only after Save", async () => {
  await withRunner(async (db, runner, _browser, _calls, root) => {
    const agent = createAgent(db);
    const notes = [];
    const skillDir = path.join(root, "skills", "release-notes");
    behavior = async (input) => {
      const tool = toolNamed(input, "save_skill");
      const ctx = input.getContext();
      const draft = {
        name: "Release notes",
        description: "Write the notes.",
        steps: "1. Read the merged pull requests.",
      };
      await assert.rejects(
        () => tool.handler({ ...draft, steps: "ghp_abcdefghijklmnopqrst" }, ctx),
        /secrets/,
      );
      assert.equal(runner.listPendingSkillSaves(agent.id).length, 0);
      await assert.rejects(
        () => tool.handler({ ...draft, steps: "```bash\nnpm test\n```" }, ctx),
        /scripts/,
      );
      await assert.rejects(
        () => tool.handler({ name: "Write lean", description: "Be brief.", steps: "Cut words." }, ctx),
        /built-in/,
      );
      assert.equal(runner.listPendingSkillSaves(agent.id).length, 0);

      const denied = tool.handler(draft, ctx);
      const first = runner.listPendingSkillSaves(agent.id)[0];
      assert.equal(first.skillId, "release-notes");
      assert.equal(first.replaces, false);
      await assert.rejects(() => tool.handler(draft, ctx), /already waiting/);
      assert.equal(runner.decideSkillSave(first.id, false), true);
      assert.match(await denied, /did not save/);
      assert.equal(fs.existsSync(path.join(skillDir, "SKILL.md")), false);

      const saved = tool.handler(draft, ctx);
      assert.equal(runner.decideSkillSave(runner.listPendingSkillSaves(agent.id)[0].id, true), true);
      assert.match(await saved, /Saved skill release-notes/);
      const parsed = parseSkillMarkdown(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"));
      assert.equal(parsed.name, "Release notes");
      assert.equal(parsed.body, draft.steps);
      fs.writeFileSync(path.join(skillDir, "notes.txt"), "keep");

      const replaced = tool.handler({ ...draft, steps: "2. Draft the notes." }, ctx);
      const again = runner.listPendingSkillSaves(agent.id)[0];
      assert.equal(again.replaces, true);
      assert.equal(runner.decideSkillSave(again.id, true), true);
      assert.match(await replaced, /Use \/skills release-notes/);
      assert.equal(fs.readFileSync(path.join(skillDir, "notes.txt"), "utf8"), "keep");
      assert.match(fs.readFileSync(path.join(skillDir, "SKILL.md"), "utf8"), /Draft the notes/);
      return { data: { content: "Saved." } };
    };
    assert.equal(
      await runner.runTurn({
        agentId: agent.id,
        text: "Save this.",
        source: "chat",
        notify: (text) => notes.push(text),
      }),
      "Saved.",
    );
    assert.ok(notes.some((note) => note.startsWith("Save skill: Release notes")));
  });
});

test("a skill timeout and a stop write nothing", { timeout: 10_000 }, async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  await withRunner(async (db, runner, _browser, _calls, root) => {
    const agent = createAgent(db);
    const file = path.join(root, "skills", "release-notes", "SKILL.md");
    behavior = async (input) => {
      const tool = toolNamed(input, "save_skill");
      const ctx = input.getContext();
      const draft = { name: "Release notes", description: "Write the notes.", steps: "Read the pull requests." };
      const timed = tool.handler(draft, ctx);
      t.mock.timers.tick(SKILL_SAVE_TIMEOUT_MS);
      assert.match(await timed, /was not saved/);
      assert.equal(fs.existsSync(file), false);
      const pending = tool.handler(draft, ctx);
      const closing = runner.abort(agent.id);
      await assert.rejects(pending, /closed before it was saved/);
      await closing;
      assert.equal(fs.existsSync(file), false);
      return { data: { content: "left it" } };
    };
    assert.equal(await runner.runTurn({ agentId: agent.id, text: "Save this.", source: "chat" }), "left it");
  });
});

test("the /skill-save command asks for a save proposal", async () => {
  await withRunner(async (db, runner) => {
    const agent = createAgent(db);
    let seen = null;
    behavior = async (input, request) => {
      seen = { input, request };
      return { data: { content: "Proposed." } };
    };
    assert.equal(await runner.runTurn({ agentId: agent.id, text: "/skill-save", source: "chat" }), "Proposed.");
    assert.ok(seen, "the command opened a session");
    assert.match(seen.request.prompt, /Save the task we just completed/);
    assert.equal(seen.input.tools.some((tool) => tool.name === "save_skill"), true);
    await assert.rejects(
      () => runner.runTurn({ agentId: agent.id, text: "/skill-save notes", source: "chat" }),
      /on its own/,
    );
  });
});

test("an edited skill draft is what gets saved", async () => {
  await withRunner(async (db, runner, _browser, _calls, root) => {
    const agent = createAgent(db);
    behavior = async (input) => {
      const tool = toolNamed(input, "save_skill");
      const ctx = input.getContext();
      const pending = tool.handler(
        { name: "Release notes", description: "Write the notes.", steps: "Read the merged pull requests." },
        ctx,
      );
      const request = runner.listPendingSkillSaves(agent.id)[0];
      assert.equal(
        runner.decideSkillSave(request.id, true, {
          id: "release-notes-edited",
          name: "Release notes edited",
          description: "Use when release notes need an edit.",
          steps: "Edited step: read the merged pull requests and check the changelog.",
        }),
        true,
      );
      assert.match(await pending, /Saved skill release-notes-edited/);
      return { data: { content: "Saved." } };
    };
    assert.equal(await runner.runTurn({ agentId: agent.id, text: "Save this.", source: "chat" }), "Saved.");
    const markdown = fs.readFileSync(path.join(root, "skills", "release-notes-edited", "SKILL.md"), "utf8");
    assert.match(markdown, /Edited step/);
    assert.match(markdown, /check the changelog/);
  });
});

test("the /skill-save command recaps the whole task", async () => {
  await withRunner(async (db, runner) => {
    const agent = createAgent(db);
    db.setMemorySummary(agent.id, "Earlier summary.", 1);
    db.addMessage(agent.id, "user", "The task starts with EARLY-MARKER.");
    db.addMessage(agent.id, "assistant", "Step one is noted.");
    for (let index = 0; index < 10; index += 1) {
      db.addMessage(agent.id, "user", `Filler ${index}`);
      db.addMessage(agent.id, "assistant", `Reply ${index}`);
    }
    let prompt = "";
    behavior = async (_input, request) => {
      prompt = request.prompt;
      return { data: { content: "Proposed." } };
    };
    assert.equal(await runner.runTurn({ agentId: agent.id, text: "/skill-save", source: "chat" }), "Proposed.");
    assert.match(prompt, /Save the task we just completed/);
    assert.match(prompt, /Conversation to review/);
    assert.match(prompt, /EARLY-MARKER/);
  });
});

test("a routine run keeps questions and drops handoff and save skill", async () => {
  await withRunner(async (db, runner) => {
    const agent = createAgent(db);
    const view = await runner.previewContext(agent.id);
    assert.equal(view.tools.includes("browser_needs_you"), true);
    assert.equal(view.tools.includes("save_skill"), true);
    assert.match(view.systemMessage, /browser_needs_you/);
    assert.match(view.systemMessage, /save_skill/);

    let seen = null;
    behavior = async (input) => {
      seen = input;
      return { data: { content: "ran" } };
    };
    assert.equal(await runner.runTurn({ agentId: agent.id, text: "Check the board.", source: "routine" }), "ran");
    assert.equal(seen.tools.some((tool) => tool.name === "browser_needs_you"), false);
    assert.equal(seen.tools.some((tool) => tool.name === "save_skill"), false);
    assert.equal(seen.tools.some((tool) => tool.name === "ask_user"), true);
    assert.equal(seen.systemMessage.includes(QUESTION_HINT), true);
    assert.equal(seen.systemMessage.includes("browser_needs_you"), false);
    assert.equal(seen.systemMessage.includes("save_skill"), false);

    assert.equal(
      await runner.runTurn({
        agentId: agent.id,
        text: "/routine Check the build every weekday at 9:00",
        source: "chat",
      }),
      "ran",
    );
    assert.deepEqual(seen.tools.map((tool) => tool.name), ["routine_create"]);
    assert.equal(seen.systemMessage.includes(QUESTION_HINT), false);
    assert.equal(seen.systemMessage.includes("browser_needs_you"), false);
    assert.equal(seen.systemMessage.includes("save_skill"), false);

    const developer = createAgent(db, "developer");
    const code = await runner.previewContext(developer.id);
    assert.equal(code.tools.includes("save_skill"), true);
    assert.equal(code.tools.includes("browser_needs_you"), false);
    assert.equal(code.systemMessage.includes("browser_needs_you"), false);
    assert.equal(code.systemMessage.includes("save_skill"), true);
  });
});
