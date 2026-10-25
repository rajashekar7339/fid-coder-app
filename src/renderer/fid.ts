import type { FidApi } from "../shared/api";

declare global {
  interface Window {
    fid?: FidApi;
  }
}

export function hasFid(): boolean {
  return Boolean(window.fid);
}

export function fid(): FidApi {
  if (!window.fid) {
    throw new Error("This screen only works inside the Fid Coder desktop window.");
  }
  return window.fid;
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return stripIpcWrapper(error.message);
  if (typeof error === "string") return stripIpcWrapper(error);
  return "Something went wrong";
}

function stripIpcWrapper(message: string): string {
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
}
