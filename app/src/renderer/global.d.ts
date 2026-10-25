import type { FidApi } from "../shared/api";

declare global {
  interface Window {
    fid?: FidApi;
  }
}

export {};
