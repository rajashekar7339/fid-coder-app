import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("python", python);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("yaml", yaml);

const ALIASES: Record<string, string> = {
  console: "bash",
  js: "javascript",
  jsx: "javascript",
  ps: "powershell",
  ps1: "powershell",
  pwsh: "powershell",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
  zsh: "bash",
};

export function highlightCode(text: string, language: string): string | null {
  const normalized = language.trim().toLowerCase();
  const name = ALIASES[normalized] ?? normalized;
  if (!name || !hljs.getLanguage(name)) return null;
  try {
    return hljs.highlight(text, { language: name, ignoreIllegals: true }).value;
  } catch {
    return null;
  }
}
