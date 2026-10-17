import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";

export const resolveFdPath = (): string | null => {
  const command = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(command, ["fd"], { encoding: "utf-8" });
  if (result.status !== 0 || result.stdout === "") {
    return null;
  }

  const firstLine = result.stdout.split(/\r?\n/u).find(Boolean);
  return firstLine !== undefined && firstLine !== "" ? firstLine.trim() : null;
};

export type FolderStructure = {
  dirs?: string[];
  files?: Record<string, string>;
};

export const setupFolder = (baseDir: string, structure: FolderStructure = {}): void => {
  const dirs = structure.dirs ?? [];
  const files = structure.files ?? {};

  dirs.forEach((dir) => {
    mkdirSync(join(baseDir, dir), { recursive: true });
  });
  Object.entries(files).forEach(([filePath, contents]) => {
    const fullPath = join(baseDir, filePath);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, contents);
  });
};

export const fdPath = resolveFdPath();

export const isFdInstalled = Boolean(fdPath);

export const requireFdPath = (): string => {
  if (fdPath === null || fdPath === "") {
    throw new Error("fd is not available");
  }
  return fdPath;
};

export const getSuggestions = (
  provider: CombinedAutocompleteProvider,
  lines: string[],
  cursorLine: number,
  cursorCol: number,
  force: boolean = false,
) =>
  provider.getSuggestions(lines, cursorLine, cursorCol, {
    signal: new AbortController().signal,
    force,
  });
