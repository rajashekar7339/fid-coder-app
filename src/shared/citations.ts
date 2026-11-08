export type Citation = {
  path: string;
  line: number;
  endLine: number | null;
};

const EXTENSIONS = [
  "ts",
  "tsx",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "json",
  "jsonc",
  "md",
  "mdx",
  "css",
  "scss",
  "less",
  "html",
  "py",
  "java",
  "kt",
  "cs",
  "go",
  "rs",
  "rb",
  "php",
  "sql",
  "yml",
  "yaml",
  "toml",
  "xml",
  "sh",
  "ps1",
  "bat",
  "gradle",
  "properties",
  "opt",
  "txt",
  "log",
  "vue",
  "svelte",
].join("|");

const EXTENSION_SET = new Set(EXTENSIONS.split("|"));
const CITATION_SOURCE = String.raw`(?<![\w/.])(?:[A-Za-z]:)?(?:[\w.@+~-]+[\\/])*[\w.@+~-]+\.(?:${EXTENSIONS}):\d+(?:[-–—]\d+)?(?![\w])`;

/** A fresh pattern each call keeps callers from sharing lastIndex state. */
export function citationPattern(): RegExp {
  return new RegExp(CITATION_SOURCE, "g");
}

export function parseCitation(raw: string): Citation | null {
  const value = raw.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) return null;
  const match = /^(.*\.([A-Za-z0-9]+)):(\d+)(?:[-–—](\d+))?$/.exec(value);
  if (!match) return null;
  const extension = (match[2] ?? "").toLowerCase();
  if (!EXTENSION_SET.has(extension)) return null;
  const line = Number.parseInt(match[3] ?? "", 10);
  const end = match[4] ? Number.parseInt(match[4], 10) : null;
  if (!Number.isFinite(line) || line < 1) return null;
  return {
    path: match[1] ?? value,
    line,
    endLine: end !== null && Number.isFinite(end) && end >= line ? end : null,
  };
}

/** Citations in source order, with duplicates removed. */
export function collectCitations(text: string): Citation[] {
  const seen = new Set<string>();
  const found: Citation[] = [];
  for (const match of text.matchAll(citationPattern())) {
    const citation = parseCitation(match[0]);
    if (!citation) continue;
    const key = `${citation.path}:${citation.line}:${citation.endLine ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(citation);
  }
  return found;
}
