export const TABLE_DEFAULT_ROWS = 50;
export const TABLE_MAX_ROWS = 200;
export const TABLE_MAX_COLUMNS = 30;
export const TABLE_MAX_CELL_CHARS = 200;
export const TABLE_MAX_OUTPUT_CHARS = 24_000;
export const TABLE_MAX_FILE_BYTES = 20 * 1024 * 1024;

export type TableCell = string | number | boolean | Date | null;

export type TablePreviewInput = {
  fileName: string;
  sheetNames: string[];
  sheetName: string;
  rows: readonly (readonly TableCell[])[];
  /** 1-based row that holds the column names. 0 means the sheet has no header row. */
  headerRow: number;
  /** Zero-based data-row offset. */
  offset: number;
  limit: number;
};

function clip(text: string, max = TABLE_MAX_CELL_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export function tableCellText(value: TableCell | undefined): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const date = value;
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;
    const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return time === "00:00" ? day : `${day} ${time}`;
  }
  return String(value);
}

/** A cell safe to put in a Markdown table. */
export function tableCell(value: TableCell | undefined): string {
  const text = tableCellText(value).replace(/\r?\n/g, " ").replace(/\|/g, "\\|").trim();
  return clip(text);
}

export function columnLabel(index: number): string {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

function rowLine(cells: readonly string[]): string {
  return `| ${cells.join(" | ")} |`;
}

/**
 * A bounded Markdown preview of one sheet. Rows are data rows, not the header.
 * The output never exceeds TABLE_MAX_OUTPUT_CHARS; rows that do not fit are
 * left for the next call, and the returned offset says where to resume.
 */
export function tablePreview(input: TablePreviewInput): string {
  const dataStart = input.headerRow > 0 ? input.headerRow : 0;
  const dataRows = input.rows.slice(dataStart);
  const total = dataRows.length;
  const width = Math.min(
    TABLE_MAX_COLUMNS,
    Math.max(
      1,
      ...input.rows.slice(0, Math.max(dataStart, 0)).map((row) => row.length),
      ...dataRows.slice(0, 50).map((row) => row.length),
    ),
  );
  const headerCells =
    input.headerRow > 0
      ? Array.from({ length: width }, (_, index) => input.rows[input.headerRow - 1]?.[index])
      : Array.from({ length: width }, (_, index) => columnLabel(index));
  const headers = headerCells.map((cell, index) =>
    input.headerRow > 0 && tableCellText(cell).trim() ? tableCell(cell) : columnLabel(index),
  );
  const start = Math.min(Math.max(0, Math.floor(input.offset)), total);
  const end = Math.min(total, start + Math.max(1, Math.min(TABLE_MAX_ROWS, Math.floor(input.limit))));

  const prefix = [
    `File: ${input.fileName}`,
    `Sheets: ${input.sheetNames.join(", ")}`,
    `Sheet: ${input.sheetName}`,
    `Data rows: ${total} · Columns: ${width}`,
    input.headerRow > 0 ? `Header row: ${input.headerRow}` : "Header row: none",
  ];
  const lines = [rowLine(headers), rowLine(headers.map(() => "---"))];
  let shown = 0;
  for (let index = start; index < end; index += 1) {
    const row = dataRows[index] ?? [];
    const line = rowLine(
      Array.from({ length: width }, (_, column) => tableCell(row[column])),
    );
    const candidate = [...prefix, `Showing rows ${start + 1}–${start + shown + 1}`, ...lines, line].join("\n");
    if (candidate.length > TABLE_MAX_OUTPUT_CHARS) break;
    lines.push(line);
    shown += 1;
  }
  const next = start + shown;
  const summary = [
    ...prefix,
    shown > 0 ? `Showing rows ${start + 1}–${next}` : "Showing rows: none",
    ...lines,
  ];
  if (next < total) {
    summary.push(
      `More data: call table_read with offset=${next} (${total - next} rows remain).`,
    );
  } else if (total > 0) {
    summary.push("End of sheet.");
  }
  return summary.join("\n");
}
