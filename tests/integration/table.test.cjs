// Native table_read: CSV, TSV, and XLSX without a Copilot turn.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { strToU8, zipSync } = require("fflate");
const { tableTools } = require("../../dist/tools/table/table.js");
const { columnLabel } = require("../../dist/shared/table.js");

const tool = tableTools.find((candidate) => candidate.name === "table_read");

function xml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cellXml(value, reference) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return `<c r="${reference}"><v>${value}</v></c>`;
  return `<c r="${reference}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`;
}

function xlsx(rows) {
  const sheetData = rows
    .map(
      (row, rowIndex) =>
        `<row r="${rowIndex + 1}">${row
          .map((value, columnIndex) => cellXml(value, `${columnLabel(columnIndex)}${rowIndex + 1}`))
          .join("")}</row>`,
    )
    .join("");
  const files = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    "_rels/.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Sales" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetData}</sheetData></worksheet>`,
  };
  return Buffer.from(
    zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, strToU8(value)]))),
  );
}

function withWorkspace(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fid-table-"));
  try {
    return run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("table_read reads a CSV with headers and pages", async () => {
  await withWorkspace(async (root) => {
    fs.writeFileSync(
      path.join(root, "sales.csv"),
      "Region,Amount\nNorth,120\nSouth,80\nEast,40\n",
      "utf8",
    );
    const output = await tool.handler({ path: "sales.csv", headerRow: 1, limit: 2 }, { workspaceDir: root });
    assert.match(output, /File: sales\.csv/);
    assert.match(output, /Data rows: 3 · Columns: 2/);
    assert.match(output, /\| Region \| Amount \|/);
    assert.match(output, /\| North \| 120 \|/);
    assert.match(output, /offset=2 \(1 rows remain\)/);
  });
});

test("table_read refuses a CSV that is not UTF-8", async () => {
  await withWorkspace(async (root) => {
    fs.writeFileSync(path.join(root, "legacy.csv"), Buffer.from([0x52, 0x65, 0x67, 0xff, 0x0a]));
    await assert.rejects(
      () => tool.handler({ path: "legacy.csv" }, { workspaceDir: root }),
      /not UTF-8 text/,
    );
  });
});

test("table_read supports a semicolon and paging", async () => {
  await withWorkspace(async (root) => {
    fs.writeFileSync(path.join(root, "sales.csv"), "Region;Amount\nNorth;120\nSouth;80\n", "utf8");
    const output = await tool.handler(
      { path: "sales.csv", delimiter: ";", offset: 1 },
      { workspaceDir: root },
    );
    assert.match(output, /\| South \| 80 \|/);
    assert.doesNotMatch(output, /\| North \| 120 \|/);
  });
});

test("table_read reads an XLSX sheet", async () => {
  await withWorkspace(async (root) => {
    fs.writeFileSync(
      path.join(root, "sales.xlsx"),
      xlsx([
        ["Region", "Amount"],
        ["North", 120],
        ["South", 80],
      ]),
    );
    const output = await tool.handler({ path: "sales.xlsx", sheet: "Sales" }, { workspaceDir: root });
    assert.match(output, /Sheets: Sales/);
    assert.match(output, /Sheet: Sales/);
    assert.match(output, /\| Region \| Amount \|/);
    assert.match(output, /\| South \| 80 \|/);
  });
});

test("table_read refuses a path outside the workspace", async () => {
  await withWorkspace(async (root) => {
    await assert.rejects(
      () => tool.handler({ path: "../outside.csv" }, { workspaceDir: root }),
      /outside the workspace/,
    );
  });
});

test("table_read names the supported formats", async () => {
  await withWorkspace(async (root) => {
    fs.writeFileSync(path.join(root, "old.xls"), "not really excel", "utf8");
    await assert.rejects(
      () => tool.handler({ path: "old.xls" }, { workspaceDir: root }),
      /\.csv, \.tsv, \.xlsx, or \.xlsm/,
    );
  });
});
