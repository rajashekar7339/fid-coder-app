// Checks direct skill turns and reusable used-skills turns without Copilot.
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
const opened = [];
let nextStep = null;
copilot.openSession = async (input) => {
  const entry = { input, prompt: "", disconnected: false, session: null };
  entry.session = {
    sendAndWait: async ({ prompt }) => {
      entry.prompt = prompt;
      if (nextStep) {
        const step = nextStep;
        nextStep = null;
        await step(input);
      }
      return { data: { content: "done" } };
    },
    on: () => () => {},
    disconnect: async () => {
      entry.disconnected = true;
    },
  };
  opened.push(entry);
  return { session: entry.session, unsubscribe: () => {} };
};

const { Runner } = require("../../dist/main/chat/runner.js");
const { AppDatabase } = require("../../dist/main/db/index.js");

function makeAgent(db, workspace, name) {
  return db.createAgent({
    name,
    systemPrompt: "Help with the task.",
    workspaceDir: workspace,
    model: "auto",
    toolProfile: "developer",
    memoryEnabled: false,
  });
}

test("a used skill stays available through use_skill without its body in the prompt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-turn-"));
  const workspace = path.join(root, "workspace");
  const skillDir = path.join(workspace, ".skills", "demo");
  const db = new AppDatabase(path.join(root, "app.sqlite"));
  try {
    fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, "SKILL.md"),
      "---\nname: Demo skill\ndescription: Shows supporting files.\nversion: 1.0.0\n---\n\nRead the checklist.\n",
    );
    fs.writeFileSync(path.join(skillDir, "references", "checklist.md"), "- Check the diff\n");

    const agent = makeAgent(db, workspace, "Skill turn");
    const runner = new Runner(db, {}, { finalizeTurn: () => undefined });

    assert.equal(
      await runner.runTurn({ agentId: agent.id, text: "/skills demo check the diff", source: "chat" }),
      "done",
    );
    assert.deepEqual(db.listUsedSkillIds(agent.id), ["demo"]);
    assert.equal(opened.length, 1);
    const first = opened[0].input;
    assert.match(first.systemMessage, /### Demo skill/);
    assert.match(first.systemMessage, /references\/checklist\.md/);
    assert.equal(
      first.tools.some((tool) => tool.name === "skill_read"),
      true,
    );
    assert.equal(first.getContext().skillDir, skillDir);
    assert.match(opened[0].prompt, /check the diff/);
    assert.doesNotMatch(opened[0].prompt, /\/skills demo/);

    nextStep = async (input) => {
      const useSkill = input.tools.find((tool) => tool.name === "use_skill");
      assert.ok(useSkill, "use_skill is registered on the next turn");
      const loaded = await useSkill.handler({ id: "demo" }, input.getContext());
      assert.match(loaded, /Skill: Demo skill \(demo\)/);
      assert.match(loaded, /Read the checklist\./);
      assert.match(loaded, /references\/checklist\.md/);
      input.onToolEnd("use_skill", true, loaded);

      const read = input.tools.find((tool) => tool.name === "skill_read");
      const file = await read.handler(
        { skill: "demo", path: "references/checklist.md" },
        input.getContext(),
      );
      assert.match(file, /Check the diff/);
      input.onToolEnd("skill_read", true, file);
    };
    assert.equal(
      await runner.runTurn({ agentId: agent.id, text: "a normal message", source: "chat" }),
      "done",
    );
    assert.equal(opened.length, 2);
    const second = opened[1].input;
    assert.match(second.systemMessage, /Skills used earlier in this conversation/);
    assert.match(second.systemMessage, /- demo \(Demo skill\)/);
    assert.doesNotMatch(second.systemMessage, /Read the checklist\./);
    assert.equal(
      second.tools.some((tool) => tool.name === "use_skill"),
      true,
    );
    assert.equal(
      second.tools.some((tool) => tool.name === "skill_read"),
      true,
    );
    assert.equal(second.getContext().skillDir, undefined);
    assert.equal(second.getContext().skills[0].id, "demo");
    assert.equal(opened[1].disconnected, true);

    assert.equal(
      await runner.runTurn({ agentId: agent.id, text: "another message", source: "chat" }),
      "done",
    );
    assert.equal(opened.length, 3);
    const third = opened[2].input;
    assert.match(third.systemMessage, /- demo \(Demo skill\)/);
    assert.doesNotMatch(third.systemMessage, /Read the checklist\./);
    assert.equal(
      third.tools.some((tool) => tool.name === "use_skill"),
      true,
    );

    const otherDir = path.join(workspace, ".skills", "other");
    fs.mkdirSync(otherDir, { recursive: true });
    fs.writeFileSync(
      path.join(otherDir, "SKILL.md"),
      "---\nname: Other skill\ndescription: Another used skill.\n---\n\nFollow the other rules.\n",
    );
    assert.equal(
      await runner.runTurn({ agentId: agent.id, text: "/skills other do the other task", source: "chat" }),
      "done",
    );
    const fourth = opened[3].input;
    assert.match(fourth.systemMessage, /- demo \(Demo skill\)/);
    assert.match(fourth.systemMessage, /### Other skill/);
    assert.equal(
      fourth.tools.some((tool) => tool.name === "use_skill"),
      true,
    );
    assert.deepEqual(
      fourth
        .getContext()
        .skills.map((skill) => skill.id)
        .sort(),
      ["demo", "other"],
    );
    assert.deepEqual(db.listUsedSkillIds(agent.id), ["other", "demo"]);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a conversation with no used skill gets no skill tool or prompt", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-skill-none-"));
  const db = new AppDatabase(path.join(root, "app.sqlite"));
  try {
    const agent = makeAgent(db, null, "No skills");
    const runner = new Runner(db, {}, { finalizeTurn: () => undefined });
    await runner.runTurn({ agentId: agent.id, text: "hello", source: "chat" });
    const input = opened[opened.length - 1].input;
    assert.doesNotMatch(input.systemMessage, /Skills used earlier in this conversation/);
    assert.equal(
      input.tools.some((tool) => tool.name === "use_skill" || tool.name === "skill_read"),
      false,
    );
    assert.deepEqual(db.listUsedSkillIds(agent.id), []);
  } finally {
    db.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
