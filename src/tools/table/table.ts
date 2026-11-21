import fs from "fs";
import path from "path";
import readXlsxFile from "read-excel-file/node";
import { parse } from "csv-parse/sync";
import {
  TABLE_DEFAULT_ROWS,
  TABLE_MAX_FILE_BYTES,
  TABLE_MAX_ROWS,
  tablePreview,
  type TableCell,
} from "../../shared/table";
import { asRecord, optionalNumber, optionalString, requiredString } from "../args";
import type { AppTool } from "../types";
import { resolveInside } from "../workspace";

const CSV_EXTENSIONS = new Set([".csv", ".tsv"]);
const WORKBOOK_EXTENSIONS = new Set([".xlsx", ".xlsm"]);
const DELIMITERS = new Set([",", ";", "\t", "|"]);

export const tableTools: AppTool[] = [
  {
    name: "table_read",
    description:
      "Read a CSV, TSV, or Excel sheet as a bounded table. Returns the sheet names, data-row count, headers, and a Markdown preview. Use this instead of file_read for .csv, .tsv, .xlsx, or .xlsm. The first call defaults to 50 rows; call again with offset to page. It does not write the file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path relative to the workspace" },
        sheet: {
          type: "string",
          description: "Sheet name for an Excel workbook. Omit for the first sheet.",
        },
        headerRow: {
          type: "number",
          description: "1-based row that holds the column names. Use 0 when the sheet has no header. Default 1.",
        },
        offset: {
          type: "number",
          description: "Data rows to skip before the preview. Default 0.",
        },
        limit: {
          type: "number",
          description: `Rows to return. Default ${TABLE_DEFAULT_ROWS}, maximum ${TABLE_MAX_ROWS}.`,
        },
        delimiter: {
          type: "string",
          description: "CSV delimiter: comma, semicolon, tab, or pipe. Defaults to comma, or tab for .tsv.",
        },
      },
      required: ["path"],
    },
    handler: async (args, ctx) => {
      const record = asRecord(args);
      const requested = requiredString(record, "path");
      const file = resolveInside(ctx.workspaceDir, requested);
      const stat = fs.statSync(file);
      if (!stat.isFile()) throw new Error("Path is not a file");
      if (stat.size > TABLE_MAX_FILE_BYTES) {
        throw new Error(`The file is larger than ${Math.round(TABLE_MAX_FILE_BYTES / 1024 / 1024)} MB.`);
      }
      const extension = path.extname(file).toLowerCase();
      const headerRow = Math.floor(optionalNumber(record, "headerRow", 1));
      if (headerRow < 0) throw new Error("headerRow must be 0 or greater");
      const offset = Math.max(0, Math.floor(optionalNumber(record, "offset", 0)));
      const limit = Math.max(
        1,
        Math.min(TABLE_MAX_ROWS, Math.floor(optionalNumber(record, "limit", TABLE_DEFAULT_ROWS))),
      );
      const fileName = path.basename(file);

      if (CSV_EXTENSIONS.has(extension)) {
        const delimiter =
          optionalString(record, "delimiter") ?? (extension === ".tsv" ? "\t" : ",");
        if (!DELIMITERS.has(delimiter)) {
          throw new Error("delimiter must be a comma, semicolon, tab, or pipe");
        }
        const sheet = optionalString(record, "sheet");
        if (sheet) throw new Error("A CSV file has one sheet; omit sheet.");
        let text: string;
        try {
          text = new TextDecoder("utf-8", { fatal: true }).decode(fs.readFileSync(file));
        } catch {
          throw new Error("The CSV file is not UTF-8 text. Save it as UTF-8 and try again.");
        }
        if (text.includes("\u0000")) throw new Error("The CSV file looks binary. Use UTF-8 text.");
        let rows: TableCell[][];
        try {
          rows = parse(text, {
            bom: true,
            skip_empty_lines: true,
            relax_column_count: true,
            delimiter,
          }) as TableCell[][];
        } catch (error) {
          throw new Error(`Could not parse the CSV: ${errorMessage(error)}`);
        }
        return tablePreview({
          fileName,
          sheetNames: ["CSV"],
          sheetName: "CSV",
          rows,
          headerRow,
          offset,
          limit,
        });
      }

      if (!WORKBOOK_EXTENSIONS.has(extension)) {
        throw new Error("Use table_read on a .csv, .tsv, .xlsx, or .xlsm file.");
      }

      let sheets: Array<{ sheet: string; data: TableCell[][] }>;
      try {
        sheets = (await readXlsxFile(fs.readFileSync(file))) as Array<{
          sheet: string;
          data: TableCell[][];
        }>;
      } catch (error) {
        throw new Error(`Could not read the workbook: ${errorMessage(error)}`);
      }
      if (sheets.length === 0) throw new Error("The workbook has no sheets.");
      const requestedSheet = optionalString(record, "sheet");
      const selected =
        (requestedSheet
          ? sheets.find((sheet) => sheet.sheet === requestedSheet)
          : sheets[0]) ?? null;
      if (!selected) {
        throw new Error(
          `Sheet not found. Sheets: ${sheets.map((sheet) => sheet.sheet).join(", ")}`,
        );
      }
      return tablePreview({
        fileName,
        sheetNames: sheets.map((sheet) => sheet.sheet),
        sheetName: selected.sheet,
        rows: selected.data,
        headerRow,
        offset,
        limit,
      });
    },
  },
];

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
