export type TableAlign = "left" | "center" | "right";

export type MessageBlock =
  | { type: "code"; text: string; language: string }
  | { type: "heading"; level: number; text: string }
  | { type: "list"; ordered: boolean; start?: number; items: string[] }
  | { type: "quote"; text: string }
  | { type: "table"; headers: string[]; align: TableAlign[]; rows: string[][] }
  | { type: "paragraph"; text: string };

type TableStart = { headers: string[]; align: TableAlign[] };

const FENCE = /^(\s*)```([^`]*)$/;
const FENCE_CLOSE = /^\s*```\s*$/;
const DIVIDER_CELL = /^:?-{3,}:?$/;

export function parseMessageBlocks(source: string): MessageBlock[] {
  const lines = source.split(/\r?\n/);
  const blocks: MessageBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const fence = FENCE.exec(line);
    if (fence) {
      const indent = fence[1]?.length ?? 0;
      const language = fence[2]?.trim() ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE_CLOSE.test(lines[index] ?? "")) {
        body.push(stripFenceIndent(lines[index] ?? "", indent));
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", text: body.join("\n"), language });
      continue;
    }

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const table = tableStartAt(lines, index);
    if (table) {
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length) {
        const row = lines[index] ?? "";
        if (!row.trim() || !row.includes("|") || FENCE.test(row)) break;
        const cells = splitTableRow(row);
        rows.push(table.headers.map((_, column) => cells[column] ?? ""));
        index += 1;
      }
      blocks.push({ type: "table", headers: table.headers, align: table.align, rows });
      continue;
    }

    const heading = /^(#{1,3})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
      index += 1;
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index] ?? "")) {
        items.push((lines[index] ?? "").replace(/^[-*]\s+/, ""));
        index += 1;
      }
      blocks.push({ type: "list", ordered: false, items });
      continue;
    }

    const ordered = /^(\d+)\.\s+(.*)$/.exec(line);
    if (ordered) {
      const start = Number.parseInt(ordered[1] ?? "1", 10) || 1;
      const items: string[] = [];
      while (index < lines.length) {
        const item = /^(\d+)\.\s+(.*)$/.exec(lines[index] ?? "");
        if (!item) break;
        items.push(item[2] ?? "");
        index += 1;
      }
      blocks.push({ type: "list", ordered: true, start, items });
      continue;
    }

    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (index < lines.length && (lines[index] ?? "").startsWith(">")) {
        quote.push((lines[index] ?? "").replace(/^>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "quote", text: quote.join("\n") });
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (
      index < lines.length &&
      (lines[index] ?? "").trim() &&
      !FENCE.test(lines[index] ?? "") &&
      !/^#{1,3}\s+/.test(lines[index] ?? "") &&
      !/^[-*]\s+/.test(lines[index] ?? "") &&
      !/^\d+\.\s+/.test(lines[index] ?? "") &&
      !(lines[index] ?? "").startsWith(">") &&
      !tableStartAt(lines, index)
    ) {
      paragraph.push(lines[index] ?? "");
      index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }

  return blocks;
}

function stripFenceIndent(line: string, count: number): string {
  let cut = 0;
  while (cut < count && line[cut] === " ") cut += 1;
  return line.slice(cut);
}

function tableStartAt(lines: string[], index: number): TableStart | null {
  const header = lines[index] ?? "";
  if (!header.trim() || !header.includes("|")) return null;
  const headers = splitTableRow(header);
  const align = dividerAlignments(lines[index + 1] ?? "", headers.length);
  return align ? { headers, align } : null;
}

function dividerAlignments(line: string, columns: number): TableAlign[] | null {
  if (!line.includes("|")) return null;
  const cells = splitTableRow(line);
  if (cells.length !== columns || cells.length === 0) return null;
  const alignments: TableAlign[] = [];
  for (const cell of cells) {
    if (!DIVIDER_CELL.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    alignments.push(left && right ? "center" : right ? "right" : "left");
  }
  return alignments;
}

function splitTableRow(line: string): string[] {
  let value = line.trim();
  if (value.startsWith("|")) value = value.slice(1);
  if (value.endsWith("|") && !value.endsWith("\\|")) value = value.slice(0, -1);

  const cells: string[] = [];
  let cell = "";
  let inCode = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";
    if (character === "\\" && value[index + 1] === "|") {
      cell += "|";
      index += 1;
      continue;
    }
    if (character === "`") inCode = !inCode;
    if (character === "|" && !inCode) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += character;
  }
  cells.push(cell.trim());
  return cells;
}

const BOX_DRAWING = /[┌┐└┘├┤┬┴┼─│┏┓┗┛┣┫┳┻╋━┃]/g;

export function isAsciiDiagram(text: string, language: string): boolean {
  const label = language.trim().toLowerCase();
  if (/^(diagram|flow|flowchart)$/.test(label)) return true;
  if ((text.match(BOX_DRAWING)?.length ?? 0) >= 4) return true;

  const texty = !label || /^(text|txt|plain|plaintext|ascii)$/.test(label);
  if (!texty) return false;
  const outlineCount = (text.match(/\+[-=+]{3,}\+/g) ?? []).length;
  const arrows = (text.match(/-->|->|==>|=>/g) ?? []).length;
  return (outlineCount >= 1 && arrows >= 1) || outlineCount >= 2;
}
