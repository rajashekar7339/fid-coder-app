import type { FidApi } from "../shared/api";

export function fid(): FidApi {
  if (!window.fid) {
    throw new Error("This screen only works inside the Fid Coder desktop window.");
  }
  return window.fid;
}

export function errorText(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "string") return error;
  return "Something went wrong";
}
