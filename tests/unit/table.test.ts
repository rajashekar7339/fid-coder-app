import assert from "node:assert/strict";
import test from "node:test";
import {
  TABLE_MAX_CELL_CHARS,
  columnLabel,
  tableCell,
  tablePreview,
} from "../../src/shared/table.ts";

test("a preview shows the sheet, headers, and rows", () => {
  const text = tablePreview({
    fileName: "sales.xlsx",
    sheetNames: ["Sales", "Notes"],
    sheetName: "Sales",
    rows: [
      ["Region", "Amount"],
      ["North", 120],
      ["South", 80],
    ],
    headerRow: 1,
    offset: 0,
    limit: 50,
  });
  assert.match(text, /File: sales\.xlsx/);
  assert.match(text, /Sheets: Sales, Notes/);
  assert.match(text, /Data rows: 2 · Columns: 2/);
  assert.match(text, /\| Region \| Amount \|/);
  assert.match(text, /\| North \| 120 \|/);
  assert.match(text, /End of sheet\./);
});

test("paging resumes after the last shown row", () => {
  const rows = [["N"], ...Array.from({ length: 5 }, (_, index) => [index + 1])];
  const text = tablePreview({
    fileName: "numbers.csv",
    sheetNames: ["CSV"],
    sheetName: "CSV",
    rows,
    headerRow: 1,
    offset: 2,
    limit: 2,
  });
  assert.match(text, /Showing rows 3–4/);
  assert.match(text, /offset=4 \(1 rows remain\)/);
  assert.doesNotMatch(text, /\| 2 \|/);
});

test("a sheet without a header uses column letters", () => {
  const text = tablePreview({
    fileName: "plain.csv",
    sheetNames: ["CSV"],
    sheetName: "CSV",
    rows: [
      ["a", "b"],
      ["c", "d"],
    ],
    headerRow: 0,
    offset: 0,
    limit: 50,
  });
  assert.match(text, /\| A \| B \|/);
  assert.match(text, /Header row: none/);
});

test("cells escape table pipes and clip long values", () => {
  assert.equal(tableCell("a|b\nc"), "a\\|b c");
  assert.equal(tableCell("x".repeat(TABLE_MAX_CELL_CHARS + 10)).endsWith("…"), true);
  assert.equal(tableCell("  value  "), "value");
});

test("dates are readable and column labels continue past Z", () => {
  const date = new Date(2026, 10, 20, 9, 30);
  assert.equal(tableCell(date), "2026-11-20 09:30");
  assert.equal(columnLabel(0), "A");
  assert.equal(columnLabel(25), "Z");
  assert.equal(columnLabel(26), "AA");
});
