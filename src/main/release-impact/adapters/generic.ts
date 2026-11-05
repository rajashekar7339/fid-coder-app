import { parsePlaywright, caseId, type ParsedTest } from "./playwright";
import { collectSignals, emptySignals } from "../collect";

const SCENARIO = /^(?:Scenario Outline|Scenario):\s*(.+)$/;
const PY_TEST = /^def\s+(test_[A-Za-z0-9_]+)/;
const JAVA_TEST = /(?:@Test|public\s+void)\s+(?:public\s+void\s+)?([A-Za-z0-9_]+)/;

export function parseGeneric(content: string, caseIdPattern?: string): ParsedTest[] {
  const playwright = parsePlaywright(content, caseIdPattern).filter((test) => test.name !== "file");
  const extra: ParsedTest[] = [];
  const lines = content.split(/\r?\n/);
  let robot = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line === "*** Test Cases ***") {
      robot = true;
      continue;
    }
    if (line.startsWith("*** ") && line.endsWith("***")) robot = false;
    const scenario = line.match(SCENARIO);
    const python = line.match(PY_TEST);
    const java = line.match(JAVA_TEST);
    const robotName = robot && line && !line.startsWith("[") && !line.startsWith("#") ? line : "";
    const name = scenario?.[1] || python?.[1] || (java && line.includes("@Test") ? "" : java?.[1]) || robotName;
    if (!name) continue;
    const signals = emptySignals();
    collectSignals(line, signals, true, false);
    const id = caseId(line, caseIdPattern) || caseId(name, caseIdPattern);
    extra.push({
      id,
      name,
      suite: "",
      line: index + 1,
      skipped: /\b(?:skip|fixme|flaky)\b/i.test(line),
      signals,
    });
  }
  const tests = [...playwright, ...extra];
  if (tests.length > 0) return tests;
  return parsePlaywright(content, caseIdPattern);
}
