import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempPath(name: string): string {
  return join(tmpdir(), name);
}

export function makeTempDir(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export interface TempFile {
  readonly directory: string;
  readonly path: string;
}

export async function makeTempFile(prefix: string, name: string): Promise<TempFile> {
  const directory = await makeTempDir(prefix);
  return { directory, path: join(directory, name) };
}

export function makeTempDirSync(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function removeDir(directory: string): Promise<void> {
  return rm(directory, { recursive: true, force: true });
}

export function removeDirSync(directory: string): void {
  rmSync(directory, { recursive: true, force: true });
}

export function writeTempFile(directory: string, name: string, content: string | Uint8Array): void {
  writeFileSync(join(directory, name), content);
}

export function readTempFile(directory: string, name: string): string {
  return readFileSync(join(directory, name), "utf8");
}

export function appendTempFile(directory: string, name: string, content: string): void {
  appendFileSync(join(directory, name), content);
}
