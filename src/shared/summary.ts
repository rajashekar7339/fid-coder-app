export function summarizeTool(name: string, ok: boolean, text: string): string {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const head = (lines[0] ?? (ok ? "done" : "failed")).slice(0, 160);
  const extra = lines.length > 1 ? ` (+${lines.length - 1} more lines)` : "";
  const body = `${head}${extra}`.slice(0, 220);
  return `${name}: ${ok ? body : `failed: ${body}`}`;
}
