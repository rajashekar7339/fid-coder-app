export type DiffKind = "same" | "add" | "remove";

export type DiffLine = {
  kind: DiffKind;
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

export type DiffResult = {
  lines: DiffLine[];
  additions: number;
  deletions: number;
  truncated: boolean;
};

const MAX_DIFF_LINES = 1600;
const MAX_CELLS = 900_000;

export function diffLines(before: string, after: string, maxLines = MAX_DIFF_LINES): DiffResult {
  const oldText = splitLines(before, maxLines);
  const newText = splitLines(after, maxLines);
  const truncated = oldText.truncated || newText.truncated;
  const a = oldText.lines;
  const b = newText.lines;

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }

  const ops: Array<{ kind: DiffKind; text: string }> = [];
  for (let index = 0; index < start; index += 1) ops.push({ kind: "same", text: a[index]! });
  ops.push(...diffMiddle(a.slice(start, endA), b.slice(start, endB)));
  for (let index = endA; index < a.length; index += 1) ops.push({ kind: "same", text: a[index]! });

  let oldLine = 1;
  let newLine = 1;
  let additions = 0;
  let deletions = 0;
  const lines = ops.map((op): DiffLine => {
    if (op.kind === "same") {
      const line = { kind: op.kind, text: op.text, oldLine, newLine };
      oldLine += 1;
      newLine += 1;
      return line;
    }
    if (op.kind === "remove") {
      deletions += 1;
      const line = { kind: op.kind, text: op.text, oldLine, newLine: null };
      oldLine += 1;
      return line;
    }
    additions += 1;
    const line = { kind: op.kind, text: op.text, oldLine: null, newLine };
    newLine += 1;
    return line;
  });

  return { lines, additions, deletions, truncated };
}

function splitLines(text: string, maxLines: number): { lines: string[]; truncated: boolean } {
  const normalized = text.replace(/\r\n/g, "\n");
  if (!normalized) return { lines: [], truncated: false };
  const lines = normalized.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  if (lines.length <= maxLines) return { lines, truncated: false };
  return { lines: lines.slice(0, maxLines), truncated: true };
}

function diffMiddle(a: string[], b: string[]): Array<{ kind: DiffKind; text: string }> {
  if (a.length === 0) return b.map((text) => ({ kind: "add" as const, text }));
  if (b.length === 0) return a.map((text) => ({ kind: "remove" as const, text }));
  if (a.length * b.length > MAX_CELLS) {
    return [
      ...a.map((text) => ({ kind: "remove" as const, text })),
      ...b.map((text) => ({ kind: "add" as const, text })),
    ];
  }

  const width = b.length + 1;
  const table = new Uint32Array((a.length + 1) * width);
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[i] === b[j]
          ? table[(i + 1) * width + j + 1]! + 1
          : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }

  const ops: Array<{ kind: DiffKind; text: string }> = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      ops.push({ kind: "same", text: a[i]! });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      ops.push({ kind: "remove", text: a[i]! });
      i += 1;
    } else {
      ops.push({ kind: "add", text: b[j]! });
      j += 1;
    }
  }
  while (i < a.length) {
    ops.push({ kind: "remove", text: a[i]! });
    i += 1;
  }
  while (j < b.length) {
    ops.push({ kind: "add", text: b[j]! });
    j += 1;
  }
  return ops;
}
