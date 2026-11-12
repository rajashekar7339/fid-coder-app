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
  assert.equal(parseCommand("/routine run the tests tomorrow at 9")?.command.id, "routine");
  assert.equal(parseCommand("/routine run the tests tomorrow at 9")?.args, "run the tests tomorrow at 9");
  assert.equal(parseCommand("/files")?.command.id, "files");
  assert.equal(parseCommand("/schedule run the tests tomorrow at 9"), null);
  assert.equal(command("skills").ui, undefined);
  assert.equal(parseCommand("/unknown"), null);
  assert.equal(parseCommand("review"), null);
});

test("filters commands by id, label, and description", () => {
  assert.equal(filterCommands("rev").some((item) => item.id === "review"), true);
  assert.equal(filterCommands("guide").some((item) => item.id === "help"), true);
  assert.equal(filterCommands("routine").some((item) => item.id === "routine"), true);
  assert.equal(filterCommands("files").some((item) => item.id === "files"), true);
  assert.equal(filterCommands("zzz").length, 0);
  assert.deepEqual(filterCommands("").map((item) => item.id), [
    "review",
    "skills",
    "routine",
    "files",
    "help",
  ]);
});

test("marks workspace, profile, and agent-mode requirements", () => {
  const review = command("review");
  assert.equal(commandAvailability(review, "developer", false), "Set a workspace folder first.");
  assert.equal(commandAvailability(review, "browser", true), "Needs developer tools.");
  assert.equal(commandAvailability(review, "developer", true), null);
  assert.equal(commandAvailability(command("files"), "developer", false), "Set a workspace folder first.");
  assert.equal(commandAvailability(command("files"), "developer", true), null);
  assert.equal(command("files").ui, true);
  assert.equal(command("files").hideWithoutWorkspace, true);
  assert.equal(commandAvailability(command("help"), "browser", false), null);
  assert.equal(commandAvailability(command("skills"), "browser", false), null);
  assert.equal(
    commandAvailability(command("routine"), "developer", false, true),
    "Switch to Agent mode to use this command.",
  );
  assert.equal(commandAvailability(command("routine"), "developer", false, false), null);
  assert.equal(commandAvailability(command("routine"), "browser", false, false), null);
});
