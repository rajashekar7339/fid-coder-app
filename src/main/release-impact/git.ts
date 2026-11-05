import { isMissingExecutable, runArgv } from "../../tools/process";

const REF_PATTERN = /^[A-Za-z0-9._/@+~^-]{1,200}$/;

export function safeRef(ref: string): boolean {
  if (!ref || ref.startsWith("-") || ref.includes("..") || ref.includes("\\") || /\s/.test(ref)) return false;
  return REF_PATTERN.test(ref);
}

export async function gitOutput(
  cwd: string,
  args: string[],
  timeoutMs = 20_000,
): Promise<{ ok: boolean; text: string; error: string; missing: boolean }> {
  try {
    const result = await runArgv("git", args, cwd, timeoutMs);
    return {
      ok: result.code === 0,
      text: result.stdout,
      error: result.stderr.trim(),
      missing: false,
    };
  } catch (error) {
    return {
      ok: false,
      text: "",
      error: error instanceof Error ? error.message : String(error),
      missing: isMissingExecutable(error),
    };
  }
}

export async function resolveRef(cwd: string, ref: string): Promise<{ sha: string | null; error: string | null; missing: boolean }> {
  if (!safeRef(ref)) return { sha: null, error: `Ref is not allowed: ${ref}`, missing: false };
  const result = await gitOutput(cwd, ["rev-parse", "--verify", `${ref}^{commit}`]);
  if (result.missing) return { sha: null, error: "git was not found on PATH", missing: true };
  if (!result.ok) return { sha: null, error: result.error || `Could not resolve ${ref}`, missing: false };
  const sha = result.text.trim().split("\n")[0] ?? "";
  if (!/^[0-9a-f]{7,64}$/i.test(sha)) return { sha: null, error: `Could not resolve ${ref}`, missing: false };
  return { sha, error: null, missing: false };
}
