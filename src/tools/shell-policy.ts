// Heuristic guard for common delete commands. It is not a shell sandbox; it
// catches the forms the agent is likely to use so the host can ask first.
const DELETE_COMMANDS = new Set([
  "del",
  "erase",
  "rd",
  "rmdir",
  "rm",
  "rm.exe",
  "unlink",
  "remove-item",
  "ri",
  "srm",
  "srm.exe",
  "shred",
  "shred.exe",
  "format",
  "diskpart",
  "diskpart.exe",
]);

const WRAPPERS = new Set([
  "cmd",
  "cmd.exe",
  "%comspec%",
  "call",
  "@",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "bash",
  "sh",
  "zsh",
]);

const WRAPPER_FLAGS = new Set(["/d", "/s", "/c", "/q", "/k", "-c", "-command", "--command", "/command"]);

const DELETE_EXE_PATH = /[\\/](rm|srm|shred|diskpart)\.exe\b|[\\/]format\.com\b/;

export function needsDeleteConfirmation(command: string): boolean {
  const normalized = command.toLowerCase();
  if (DELETE_EXE_PATH.test(normalized)) return true;
  for (const segment of normalized.split(/&&|\|\||[&|;\n\r()]/)) {
    const tokens = segment
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map(cleanToken);
    const first = firstCommandToken(tokens);
    if (!first) continue;
    if (DELETE_COMMANDS.has(first)) return true;
    if ((first === "git" || first === "git.exe") && isDestructiveGit(tokens)) return true;
    if (TRANSFER_COMMANDS.has(first)) return true;
  }
  if (/\bdo\s+@?(del|erase|rd|rmdir|rm)\b/.test(normalized)) return true;
  if (/(powershell|pwsh)/.test(normalized) && /\b(remove-item|ri|del|erase|rmdir|rm)\b/.test(normalized)) {
    return true;
  }
  return false;
}

function firstCommandToken(tokens: string[]): string | undefined {
  for (const token of tokens) {
    const name = token.split(/[\\/]/).pop() ?? token;
    if (WRAPPERS.has(name) || WRAPPER_FLAGS.has(name) || /^\/[a-z?]+$/i.test(token) || token.startsWith("-")) {
      continue;
    }
    return name;
  }
  return undefined;
}

const GIT_VALUE_FLAGS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
  "--config-env",
  "--exec-path",
  "--super-prefix",
]);

function isDestructiveGit(tokens: string[]): boolean {
  const gitIndex = tokens.findIndex((token) => {
    const name = token.split(/[\\/]/).pop() ?? token;
    return name === "git" || name === "git.exe";
  });
  if (gitIndex < 0) return false;
  const args = tokens.slice(gitIndex + 1);
  const command = gitSubcommand(args);
  if (command === "push" || command === "clean" || command === "rm" || command === "restore") return true;
  if (command === "reset" && args.includes("--hard")) return true;
  if (command === "checkout" && args.includes("--")) return true;
  if (command === "stash" && (args.includes("drop") || args.includes("clear"))) return true;
  if (command === "branch" && args.some((token) => token === "-d" || token === "--delete")) return true;
  return false;
}

function gitSubcommand(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (GIT_VALUE_FLAGS.has(token)) {
      index += 1;
      continue;
    }
    if (token.startsWith("-")) continue;
    return token;
  }
  return undefined;
}

const TRANSFER_COMMANDS = new Set([
  "curl",
  "curl.exe",
  "wget",
  "wget.exe",
  "iwr",
  "irm",
  "invoke-webrequest",
  "invoke-restmethod",
]);

function cleanToken(token: string): string {
  return token.replace(/^["']+|["']+$/g, "").replace(/^@/, "");
}
