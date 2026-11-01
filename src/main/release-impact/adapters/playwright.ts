import { collectSignals, emptySignals } from "../collect";
import type { ChangeSignals } from "../../../shared/release-impact/score";

export type ParsedTest = {
  id: string;
  name: string;
  suite: string;
  line: number;
  skipped: boolean;
  signals: ChangeSignals;
};

const TEST_LINE = /\b(?:test|it)(?:\.(?:only|skip|fixme))?\(\s*(['"`])(.*)\1/;
const DESCRIBE_LINE = /\b(?:test\.)?describe(?:\.(?:only|skip))?\(\s*(['"`])(.*)\1/;

export function parsePlaywright(content: string, caseIdPattern?: string): ParsedTest[] {
  const lines = content.split(/\r?\n/);
  const tests: ParsedTest[] = [];
  let suite = "";
  let current: { name: string; line: number; skipped: boolean; body: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    tests.push(toTest(current.name, current.line, suite, current.skipped, current.body.join("\n"), caseIdPattern));
    current = null;
  };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const describe = line.match(DESCRIBE_LINE);
    if (describe && !TEST_LINE.test(line)) {
      flush();
      suite = describe[2];
      continue;
    }
    const test = line.match(TEST_LINE);
    if (!test || line.includes(".describe")) {
      if (current) current.body.push(line);
      continue;
    }
    flush();
    current = {
      name: test[2],
      line: index + 1,
      skipped: /\.skip|\.fixme|\bxit\b|\btest\.skip\b/.test(line),
      body: [line],
    };
  }
  flush();
  if (tests.length === 0 && content.trim()) {
    const id = caseId(content, caseIdPattern);
    if (id) tests.push(toTest(id, 1, suite, /\b(?:test|it)\.skip\b/.test(content), content, caseIdPattern));
  }
  return tests;
}

function toTest(name: string, line: number, suite: string, skipped: boolean, body: string, pattern?: string): ParsedTest {
  const signals = emptySignals();
  collectSignals(body, signals, true, false);
  const id = caseId(`${name}\n${body}`, pattern);
  return { id, name, suite, line, skipped: skipped || /\b(?:skip|fixme|flaky)\b/i.test(name), signals };
}

export function caseId(text: string, pattern?: string): string {
  if (pattern) {
    try {
      return text.match(new RegExp(pattern))?.[0] ?? "";
    } catch {
      return "";
    }
  }
  return text.match(/\b[A-Z][A-Z0-9]+-\d+\b/)?.[0] ?? "";
}
