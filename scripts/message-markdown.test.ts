import assert from "node:assert/strict";
import test from "node:test";
import { isAsciiDiagram, parseMessageBlocks } from "../src/renderer/lib/message-markdown.ts";

test("parses a GFM table with alignment and stops at the next paragraph", () => {
  const blocks = parseMessageBlocks(
    [
      "Top picks:",
      "",
      "| Rank | Movie | Year |",
      "|-----:|:-----|-----:|",
      "| 1 | **The Shawshank Redemption** | 1994 |",
      "| 2 | A \\| B | 1995 |",
      "| 3 | `a|b` | 1996 |",
      "",
      "That is the list.",
    ].join("\n"),
  );

  assert.equal(blocks.length, 3);
  assert.deepEqual(blocks[0], { type: "paragraph", text: "Top picks:" });
  const table = blocks[1];
  assert.equal(table?.type, "table");
  if (table?.type !== "table") return;
  assert.deepEqual(table.headers, ["Rank", "Movie", "Year"]);
  assert.deepEqual(table.align, ["right", "left", "right"]);
  assert.deepEqual(table.rows, [
    ["1", "**The Shawshank Redemption**", "1994"],
    ["2", "A | B", "1995"],
    ["3", "`a|b`", "1996"],
  ]);
  assert.deepEqual(blocks[2], { type: "paragraph", text: "That is the list." });
});

test("recognizes a table directly after a paragraph", () => {
  const blocks = parseMessageBlocks(
    ["Results:", "| Name | Count |", "| --- | ---: |", "| Alpha | 2 |", "Finished."].join("\n"),
  );

  assert.equal(blocks.length, 3);
  assert.equal(blocks[1]?.type, "table");
  assert.equal(blocks[2]?.type, "paragraph");
});

test("leaves a table inside a fenced block as code", () => {
  const blocks = parseMessageBlocks(["```text", "| A | B |", "| --- | --- |", "| 1 | 2 |", "```"].join("\n"));

  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]?.type, "code");
  if (blocks[0]?.type === "code") assert.equal(blocks[0].language, "text");
});

test("parses indented fences inside an ordered list and keeps the list numbering", () => {
  const blocks = parseMessageBlocks(
    [
      "1. **Create the model**:",
      "   ```powershell",
      "   ollama create qwen27b-fast -f Modelfile.opt",
      "   ```",
      "",
      "2. **Run the benchmark**:",
      "   ```powershell",
      "   .\\bench.ps1 qwen27b-fast",
      "   ```",
      "",
      "   The script accepts a model name.",
      "   ```powershell",
      '   .\\bench.ps1 qwen27b-fast -Prompt "Explain recursion briefly."',
      "   ```",
      "",
      "3. **Review the output.**",
    ].join("\n"),
  );

  assert.deepEqual(
    blocks.map((block) => block.type),
    ["list", "code", "list", "code", "paragraph", "code", "list"],
  );
  const first = blocks[0];
  assert.equal(first?.type === "list" && first.start, 1);
  const firstCode = blocks[1];
  assert.equal(firstCode?.type, "code");
  if (firstCode?.type === "code") {
    assert.equal(firstCode.language, "powershell");
    assert.equal(firstCode.text, "ollama create qwen27b-fast -f Modelfile.opt");
  }
  const second = blocks[2];
  assert.equal(second?.type === "list" && second.start, 2);
  const last = blocks[6];
  assert.equal(last?.type === "list" && last.start, 3);
});

test("detects box-drawing and ASCII flow diagrams", () => {
  const boxDrawing = [
    "┌──────────┐      ┌──────────┐",
    "│  Input   │ ───▶ │  Model   │",
    "└──────────┘      └──────────┘",
  ].join("\n");
  const ascii = ["+----------+      +----------+", "|  Input   | ---> |  Model   |", "+----------+      +----------+"]
    .join("\n");

  assert.equal(isAsciiDiagram(boxDrawing, "text"), true);
  assert.equal(isAsciiDiagram(ascii, ""), true);
  assert.equal(isAsciiDiagram('const label = "| a | b |";', "ts"), false);
  assert.equal(isAsciiDiagram("a | b\n--- | ---\n1 | 2", "text"), false);
});
