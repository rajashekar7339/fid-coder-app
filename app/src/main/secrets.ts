import fs from "fs";
import { safeStorage } from "electron";
import { secretsPath } from "./paths";

type SecretFile = Record<string, string>;

export const secretKeys = {
  copilot: "copilot-token",
  githubPat: "github-pat",
  jira: "jira-token",
} as const;

function readFile(): SecretFile {
  try {
    const raw = fs.readFileSync(secretsPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    return parsed as SecretFile;
  } catch {
    return {};
  }
}

function writeFile(data: SecretFile): void {
  fs.writeFileSync(secretsPath(), JSON.stringify(data));
}

function assertEncryption(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Windows encryption is not available, so tokens cannot be stored.");
  }
}

export function setSecret(key: string, value: string): void {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Token is empty");
  assertEncryption();
  const data = readFile();
  data[key] = safeStorage.encryptString(trimmed).toString("base64");
  writeFile(data);
}

export function getSecret(key: string): string | null {
  const encoded = readFile()[key];
  if (!encoded) return null;
  assertEncryption();
  return safeStorage.decryptString(Buffer.from(encoded, "base64"));
}

export function hasSecret(key: string): boolean {
  return Boolean(readFile()[key]);
}

export function clearSecret(key: string): void {
  const data = readFile();
  delete data[key];
  writeFile(data);
}
