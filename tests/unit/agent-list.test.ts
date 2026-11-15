import assert from "node:assert/strict";
import test from "node:test";
import { arrangeAgentList, parseAgentPlacement } from "../../src/shared/agent-list.ts";
import type { Agent } from "../../src/shared/types.ts";

function agent(partial: Pick<Agent, "id" | "name"> & Partial<Agent>): Agent {
  return {
    description: "",
    systemPrompt: "",
    workspaceDir: null,
    model: "auto",
    toolProfile: "browser",
    readOnly: true,
    memorySummary: "",
    memoryEnabled: true,
    pinned: false,
    archived: false,
    lastActivityAt: null,
    nextRoutineAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

test("pinned agents lead the list and archived agents leave it", () => {
  const agents = [
    agent({ id: "old", name: "Alpha", updatedAt: "2026-01-01T00:00:00.000Z" }),
    agent({ id: "new", name: "Middling", updatedAt: "2026-03-01T00:00:00.000Z" }),
    agent({ id: "pin", name: "Zebra", pinned: true, updatedAt: "2026-01-02T00:00:00.000Z" }),
    agent({
      id: "box",
      name: "Boxed",
      archived: true,
      pinned: true,
      updatedAt: "2026-04-01T00:00:00.000Z",
    }),
  ];
  const list = arrangeAgentList(agents, "");
  assert.deepEqual(
    list.listed.map((item) => item.name),
    ["Zebra", "Middling", "Alpha"],
  );
  assert.deepEqual(
    list.archived.map((item) => item.name),
    ["Boxed"],
  );
});

test("a blank search stays on the working list and a name search includes the archive", () => {
  const agents = [
    agent({ id: "a", name: "JIRA Agent", description: "Jira teammate", updatedAt: "2026-02-01T00:00:00.000Z" }),
    agent({ id: "b", name: "Notes", description: "Release notes", archived: true, updatedAt: "2026-03-01T00:00:00.000Z" }),
    agent({ id: "c", name: "Other", description: "Idle", updatedAt: "2026-01-01T00:00:00.000Z" }),
  ];
  assert.deepEqual(
    arrangeAgentList(agents, "   ").listed.map((item) => item.id),
    ["a", "c"],
  );
  assert.deepEqual(
    arrangeAgentList(agents, "release").listed.map((item) => item.name),
    ["Notes"],
  );
  assert.deepEqual(arrangeAgentList(agents, "release").archived, []);
  assert.deepEqual(
    arrangeAgentList(agents, "jira").listed.map((item) => item.name),
    ["JIRA Agent"],
  );
  assert.deepEqual(arrangeAgentList(agents, "nope").listed, []);
});

test("the same activity sorts names and a placement needs a boolean", () => {
  const agents = [
    agent({ id: "b", name: "Bravo", lastActivityAt: "2026-05-01T00:00:00.000Z" }),
    agent({ id: "a", name: "alpha", lastActivityAt: "2026-05-01T00:00:00.000Z" }),
  ];
  assert.deepEqual(
    arrangeAgentList(agents, "").listed.map((item) => item.name),
    ["alpha", "Bravo"],
  );
  assert.deepEqual(parseAgentPlacement({ pinned: true }), { pinned: true });
  assert.deepEqual(parseAgentPlacement({ archived: false, pinned: false }), {
    archived: false,
    pinned: false,
  });
  assert.throws(() => parseAgentPlacement(null), /Missing placement/);
  assert.throws(() => parseAgentPlacement({}), /Choose pin or archive/);
  assert.throws(() => parseAgentPlacement({ pinned: "yes" }), /Pinned must be true or false/);
  assert.throws(() => parseAgentPlacement({ archived: 1 }), /Archived must be true or false/);
});
