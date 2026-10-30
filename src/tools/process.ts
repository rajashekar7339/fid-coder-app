import { spawn } from "child_process";

const MAX_STDOUT = 64_000;
const MAX_STDERR = 8_000;

export function isMissingExecutable(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT");
}

export function runArgv(
  executable: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let overflow = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Command timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      if (stdout.length >= MAX_STDOUT) {
        overflow = true;
        return;
      }
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.length < MAX_STDERR) stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = stdout.replace(/\r\n/g, "\n");
      resolve({
        code,
        stdout: overflow ? `${text.slice(0, MAX_STDOUT)}\n…truncated` : text,
        stderr: stderr.replace(/\r\n/g, "\n"),
      });
    });
  });
}
