import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import dos from "highlight.js/lib/languages/dos";
import go from "highlight.js/lib/languages/go";
import groovy from "highlight.js/lib/languages/groovy";
import ini from "highlight.js/lib/languages/ini";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import less from "highlight.js/lib/languages/less";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import powershell from "highlight.js/lib/languages/powershell";
import properties from "highlight.js/lib/languages/properties";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("c", c);
hljs.registerLanguage("cpp", cpp);
hljs.registerLanguage("csharp", csharp);
hljs.registerLanguage("css", css);
hljs.registerLanguage("dos", dos);
hljs.registerLanguage("go", go);
hljs.registerLanguage("groovy", groovy);
hljs.registerLanguage("ini", ini);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("kotlin", kotlin);
hljs.registerLanguage("less", less);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("php", php);
hljs.registerLanguage("powershell", powershell);
hljs.registerLanguage("properties", properties);
hljs.registerLanguage("python", python);
hljs.registerLanguage("ruby", ruby);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);

const ALIASES: Record<string, string> = {
  console: "bash",
  js: "javascript",
  jsx: "javascript",
  md: "markdown",
  ps: "powershell",
  ps1: "powershell",
  psm1: "powershell",
  pwsh: "powershell",
  py: "python",
  sh: "bash",
  shell: "bash",
  ts: "typescript",
  tsx: "typescript",
  yml: "yaml",
  zsh: "bash",
};

const EXTENSION_LANGUAGES: Record<string, string> = {
  c: "c",
  cc: "cpp",
  cmd: "dos",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cts: "typescript",
  cxx: "cpp",
  go: "go",
  gradle: "groovy",
  h: "c",
  hh: "cpp",
  hpp: "cpp",
  htm: "xml",
  html: "xml",
  ini: "ini",
  java: "java",
  js: "javascript",
  json: "json",
  jsonc: "json",
  jsx: "javascript",
  kt: "kotlin",
  kts: "kotlin",
  less: "less",
  md: "markdown",
  mdx: "markdown",
  mjs: "javascript",
  mts: "typescript",
  php: "php",
  properties: "properties",
  ps1: "powershell",
  psd1: "powershell",
  psm1: "powershell",
  py: "python",
  pyw: "python",
  rb: "ruby",
  rs: "rust",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  svg: "xml",
  toml: "ini",
  ts: "typescript",
  tsx: "typescript",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

/** Maps a workspace path to a highlight.js language, or an empty string. */
export function languageForPath(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return EXTENSION_LANGUAGES[base.slice(dot + 1).toLowerCase()] ?? "";
}

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

/**
 * Highlights a whole block, then splits it into balanced per-line HTML.
 * Multi-line spans are closed at each line end and reopened on the next line,
 * so each line can be rendered beside its own line number.
 */
export function highlightLines(text: string, language: string): string[] | null {
  const html = highlightCode(text, language);
  return html === null ? null : splitHighlightedLines(html);
}

function splitHighlightedLines(html: string): string[] {
  const lines: string[] = [];
  const openSpans: string[] = [];
  let current = "";

  for (const token of html.match(/<span\b[^>]*>|<\/span>|<[^>]+>|[^<]+/g) ?? []) {
    if (token.startsWith("<span")) {
      openSpans.push(token);
      current += token;
    } else if (token === "</span>") {
      openSpans.pop();
      current += token;
    } else if (token.startsWith("<")) {
      current += token;
    } else {
      const parts = token.split("\n");
      for (let index = 0; index < parts.length; index += 1) {
        if (index > 0) {
          current += "</span>".repeat(openSpans.length);
          lines.push(current);
          current = openSpans.join("");
        }
        current += parts[index];
      }
    }
  }

  lines.push(current);
  return lines;
}
