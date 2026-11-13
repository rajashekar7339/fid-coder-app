// Tests the routine service, the agent routine tools, and one-time scheduling.

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { DatabaseSync } = require("node:sqlite");
const { AppDatabase } = require("../../dist/main/db/index.js");
const { Scheduler } = require("../../dist/main/routines/scheduler.js");
const { RoutineService } = require("../../dist/main/routines/service.js");
const { routineTools } = require("../../dist/tools/routines/routines.js");
const { askTools, routineCreateTools, toolsForAgent } = require("../../dist/tools/registry.js");
const { MAX_ROUTINES_PER_AGENT } = require("../../dist/shared/routine-schedule.js");

const FUTURE_DATE = "2099-01-01";
const FUTURE_TIME = "09:00";

function tempDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-routines-"));
  return { dir, db: new AppDatabase(path.join(dir, "app.sqlite")) };
}

function createAgent(db, name = "Scheduler") {
  return db.createAgent({
    name,
    systemPrompt: "Keep replies short.",
    workspaceDir: null,
    model: "auto",
  });
}

function port(service) {
  return {
    list: (agentId) => service.list(agentId),
    create: (agentId, draft) => service.create(agentId, draft),
    remove: (agentId, id) => service.removeForAgent(agentId, id),
  };
}

function context(agentId, service) {
  return {
    agentId,
    workspaceDir: null,
    githubPat: null,
    jiraToken: null,
    jiraSite: null,
    browser: {},
    routines: port(service),
  };
}

function tool(name) {
  const found = routineTools.find((item) => item.name === name);
  assert.ok(found, name);
  return found;
}

test("the service creates repeating and one-time routines with the right next run", () => {
  const { dir, db } = tempDatabase();
  try {
    const agent = createAgent(db);
    const service = new RoutineService(db, { reload() {} });
    const repeating = service.create(agent.id, {
      name: "Morning sweep",
      prompt: "Check the tickets.",
      cron: "0 9 * * 1-5",
      once: false,
      runAt: null,
      enabled: true,
      notify: true,
    });
    assert.equal(repeating.once, false);
    assert.equal(repeating.runAt, null);
    assert.ok(repeating.nextRunAt);
    const next = new Date(repeating.nextRunAt);
    assert.ok(next.getTime() > Date.now());
    assert.equal(next.getHours(), 9);
    assert.equal(next.getMinutes(), 0);
    assert.equal(next.getSeconds(), 0);
    assert.ok(next.getDay() >= 1 && next.getDay() <= 5);

    const once = service.create(agent.id, {
      name: "Run the build",
      prompt: "Run mvn clean install.",
      cron: "0 16 1 1 *",
      once: true,
      runAt: new Date(2099, 0, 1, 16, 0).toISOString(),
      enabled: true,
      notify: true,
    });
    assert.equal(once.once, true);
    assert.equal(once.nextRunAt, once.runAt);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("an agent can create and list only its own routines", async () => {
  const { dir, db } = tempDatabase();
  try {
    const agentA = createAgent(db, "Agent A");
    const agentB = createAgent(db, "Agent B");
    const service = new RoutineService(db, { reload() {} });

    const result = await tool("routine_create").handler(
      {
        instruction: "Run the tests tomorrow and report failures.",
        name: "Run tests",
        date: FUTURE_DATE,
        time: FUTURE_TIME,
      },
      context(agentA.id, service),
    );
    assert.match(result, /Created routine "Run tests"/);
    assert.match(result, /Once ·/);

    const created = service.list(agentA.id)[0];
    assert.ok(created);
    assert.equal(created.once, true);
    assert.equal(created.notify, true);

    const ownList = await tool("routine_list").handler({}, context(agentA.id, service));
    assert.match(ownList, new RegExp(created.id));
    assert.match(ownList, /Run the tests/);

    const otherList = await tool("routine_list").handler({}, context(agentB.id, service));
    assert.match(otherList, /No routines/);

    await assert.rejects(
      () => tool("routine_delete").handler({ id: created.id }, context(agentB.id, service)),
      /not found for this agent/,
    );
    const deleted = await tool("routine_delete").handler({ id: created.id }, context(agentA.id, service));
    assert.match(deleted, /Deleted routine "Run tests"/);
    assert.equal(service.list(agentA.id).length, 0);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("one-time tool arguments default to the next occurrence and reject a past date", async () => {
  const { dir, db } = tempDatabase();
  try {
    const agent = createAgent(db);
    const service = new RoutineService(db, { reload() {} });
    const result = await tool("routine_create").handler(
      { instruction: "Standup reminder", time: "23:59" },
      context(agent.id, service),
    );
    assert.match(result, /Once/);
    const created = service.list(agent.id)[0];
    assert.equal(created.once, true);
    assert.ok(Date.parse(created.runAt) > Date.now());

    await assert.rejects(
      () =>
        tool("routine_create").handler(
          { instruction: "Too late", time: "10:00", date: "2020-01-01" },
          context(agent.id, service),
        ),
      /already passed/,
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the service rejects duplicates and caps the number of routines", () => {
  const { dir, db } = tempDatabase();
  try {
    const agent = createAgent(db);
    const service = new RoutineService(db, { reload() {} });
    const draft = {
      name: "Same",
      prompt: "Do the same thing.",
      cron: "0 9 * * *",
      once: false,
      runAt: null,
      enabled: true,
      notify: true,
    };
    service.create(agent.id, draft);
    assert.throws(() => service.create(agent.id, draft), /matching routine already exists/);

    for (let index = service.list(agent.id).length; index < MAX_ROUTINES_PER_AGENT; index += 1) {
      service.create(agent.id, { ...draft, name: `Routine ${index}`, prompt: `Task ${index}.` });
    }
    assert.equal(service.list(agent.id).length, MAX_ROUTINES_PER_AGENT);
    assert.throws(
      () => service.create(agent.id, { ...draft, name: "Extra", prompt: "One too many." }),
      /already has 20 routines/,
    );
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("routine management stays in agent mode and creation is only on the routine command", () => {
  for (const profile of ["developer", "browser", "all"]) {
    const names = toolsForAgent(profile).map((item) => item.name);
    assert.equal(names.includes("routine_list"), true, `${profile}: routine_list`);
    assert.equal(names.includes("routine_delete"), true, `${profile}: routine_delete`);
    assert.equal(names.includes("routine_create"), false, `${profile}: routine_create`);
  }
  assert.deepEqual(routineCreateTools().map((item) => item.name), ["routine_create"]);
  for (const profile of ["developer", "browser", "all"]) {
    const names = askTools(profile).map((item) => item.name);
    for (const name of ["routine_list", "routine_create", "routine_delete"]) {
      assert.equal(names.includes(name), false, `${profile}: ${name}`);
    }
  }
});

test("a one-time routine fires, disables itself, and records the run", async () => {
  const { dir, db } = tempDatabase();
  try {
    const agent = createAgent(db);
    const runAt = new Date(Date.now() + 200).toISOString();
    const routine = db.createRoutine(
      {
        agentId: agent.id,
        name: "Soon",
        prompt: "Say hello.",
        cron: `${new Date(runAt).getMinutes()} ${new Date(runAt).getHours()} ${new Date(runAt).getDate()} ${new Date(runAt).getMonth() + 1} *`,
        once: true,
        runAt,
        enabled: true,
        notify: false,
      },
      runAt,
    );
    let called = 0;
    const scheduler = new Scheduler(db, {
      isRunning: () => false,
      runTurn: async () => {
        called += 1;
        return "hello";
      },
    });
    scheduler.reload();
    await new Promise((resolve) => setTimeout(resolve, 500));
    scheduler.stop();

    assert.equal(called, 1);
    const after = db.getRoutine(routine.id);
    assert.equal(after.enabled, false);
    assert.equal(after.nextRunAt, null);
    assert.equal(after.lastStatus, "ok");
    assert.ok(after.lastRunAt);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a missed one-time routine is marked and disabled on reload", () => {
  const { dir, db } = tempDatabase();
  try {
    const agent = createAgent(db);
    const runAt = new Date(Date.now() - 60_000).toISOString();
    const routine = db.createRoutine(
      {
        agentId: agent.id,
        name: "Missed",
        prompt: "Say hello.",
        cron: "0 9 1 1 *",
        once: true,
        runAt,
        enabled: true,
        notify: false,
      },
      runAt,
    );
    const scheduler = new Scheduler(db, {
      isRunning: () => false,
      runTurn: async () => "unused",
    });
    scheduler.reload();
    scheduler.stop();

    const after = db.getRoutine(routine.id);
    assert.equal(after.enabled, false);
    assert.equal(after.nextRunAt, null);
    assert.match(after.lastStatus, /^missed/);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("existing routine rows gain the one-time columns", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fid-routine-migrate-"));
  const file = path.join(dir, "app.sqlite");
  const agentId = "11111111-1111-4111-8111-111111111111";
  const now = "2026-01-01T00:00:00.000Z";
  const raw = new DatabaseSync(file);
  raw.exec(`
    CREATE TABLE agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      system_prompt TEXT NOT NULL,
      workspace_dir TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE routines (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      cron TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0,
      notify INTEGER NOT NULL DEFAULT 1,
      last_run_at TEXT,
      next_run_at TEXT,
      last_status TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  raw
    .prepare("INSERT INTO agents (id, name, system_prompt, workspace_dir, created_at, updated_at) VALUES (?, ?, ?, NULL, ?, ?)")
    .run(agentId, "Old agent", "Prompt", now, now);
  raw
    .prepare(
      "INSERT INTO routines (id, agent_id, name, prompt, cron, enabled, notify, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?)",
    )
    .run("routine-old", agentId, "Old routine", "Say hello.", "0 9 * * *", now, now);
  raw.close();

  const db = new AppDatabase(file);
  try {
    const routine = db.listRoutines(agentId)[0];
    assert.ok(routine);
    assert.equal(routine.once, false);
    assert.equal(routine.runAt, null);
  } finally {
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
