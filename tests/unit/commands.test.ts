// Tests the composer command registry and its availability rules.

import assert from "node:assert/strict";
import test from "node:test";
import {
  COMMANDS,
  commandAvailability,
  filterCommands,
  parseCommand,
} from "../../src/shared/commands.ts";

function command(id: string) {
  const found = COMMANDS.find((item) => item.id === id);
  assert.ok(found, id);
  return found;
}

test("parses a command and its target", () => {
  assert.equal(parseCommand("/review")?.command.id, "review");
  assert.equal(parseCommand("/review staged")?.args, "staged");
  assert.equal(parseCommand("/review pr 123")?.args, "pr 123");
  assert.equal(parseCommand("/review branch main")?.args, "branch main");
  assert.equal(parseCommand("/skills write-lean tighten the parser")?.command.id, "skills");
  assert.equal(parseCommand("/skills write-lean tighten the parser")?.args, "write-lean tighten the parser");
  assert.equal(command("skills").ui, undefined);
  assert.equal(parseCommand("/unknown"), null);
  assert.equal(parseCommand("review"), null);
});

test("filters commands by id, label, and description", () => {
  assert.equal(filterCommands("rev").some((item) => item.id === "review"), true);
  assert.equal(filterCommands("guide").some((item) => item.id === "help"), true);
  assert.equal(filterCommands("zzz").length, 0);
  assert.deepEqual(filterCommands("").map((item) => item.id), ["review", "skills", "help"]);
});

test("marks workspace and profile requirements", () => {
  const review = command("review");
  assert.equal(commandAvailability(review, "developer", false), "Set a workspace folder first.");
  assert.equal(commandAvailability(review, "browser", true), "Needs developer tools.");
  assert.equal(commandAvailability(review, "analyst", true), "Needs developer tools.");
  assert.equal(commandAvailability(review, "developer", true), null);
  assert.equal(commandAvailability(command("help"), "browser", false), null);
  assert.equal(commandAvailability(command("skills"), "browser", false), null);
});
