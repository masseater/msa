import { afterEach, beforeEach } from "node:test";

import { Effect } from "effect";
import { dual } from "effect/Function";

import { type AutocompleteSuggestions, CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { pathOperations } from "../src/platform.ts";
import {
  makeDirectory,
  makeTempDirectory,
  removeRecursive,
  runCommand,
  writeFileString,
} from "./test-platform.ts";

const { join } = pathOperations;

const locateFd = runCommand({
  file: process.platform === "win32" ? "where" : "which",
  args: ["fd"],
}).pipe(
  Effect.map(({ exitCode, stdout }) => {
    if (exitCode !== 0 || stdout === "") {
      return null;
    }
    const firstLine = stdout.split(/\r?\n/u).find(Boolean);
    return firstLine !== undefined && firstLine !== "" ? firstLine.trim() : null;
  }),
  Effect.catchDefect(() => Effect.succeed(null)),
);

export type FolderStructure = {
  dirs?: string[];
  files?: Record<string, string>;
};

export const setupFolder: {
  (baseDir: string, structure?: FolderStructure): Effect.Effect<void>;
  (structure?: FolderStructure): (baseDir: string) => Effect.Effect<void>;
} = dual(
  (args) => typeof args[0] === "string",
  (baseDir: string, structure: FolderStructure = {}): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Effect.forEach(structure.dirs ?? [], (dir) => makeDirectory(join(baseDir, dir)));
      yield* Effect.forEach(Object.entries(structure.files ?? {}), ([filePath, contents]) =>
        writeFileString(join(baseDir, filePath), contents),
      );
    }),
);

export interface TempWorkspace {
  rootDir: string;
  baseDir: string;
  outsideDir: string;
}

export const useTempDirectory = (prefix: string): TempWorkspace => {
  const workspace: TempWorkspace = { rootDir: "", baseDir: "", outsideDir: "" };
  beforeEach(() =>
    Effect.runPromise(
      Effect.map(makeTempDirectory(prefix), (directory) => {
        workspace.rootDir = directory;
        workspace.baseDir = directory;
      }),
    ),
  );
  afterEach(() => Effect.runPromise(removeRecursive(workspace.rootDir)));
  return workspace;
};

export const useTempWorkspace = (): TempWorkspace => {
  const workspace: TempWorkspace = { rootDir: "", baseDir: "", outsideDir: "" };
  beforeEach(() =>
    Effect.runPromise(
      Effect.gen(function* () {
        workspace.rootDir = yield* makeTempDirectory("msa-autocomplete-root-");
        workspace.baseDir = join(workspace.rootDir, "cwd");
        workspace.outsideDir = join(workspace.rootDir, "outside");
        yield* makeDirectory(workspace.baseDir);
        yield* makeDirectory(workspace.outsideDir);
      }),
    ),
  );
  afterEach(() => Effect.runPromise(removeRecursive(workspace.rootDir)));
  return workspace;
};

export const fdPath = await Effect.runPromise(locateFd);

export const isFdInstalled = Boolean(fdPath);

export const requireFdPath = (): string => {
  if (fdPath === null || fdPath === "") {
    throw new Error("fd is not available");
  }
  return fdPath;
};

export const getSuggestions: {
  (
    provider: CombinedAutocompleteProvider,
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    force?: boolean,
  ): Promise<AutocompleteSuggestions | null>;
  (
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    force?: boolean,
  ): (provider: CombinedAutocompleteProvider) => Promise<AutocompleteSuggestions | null>;
} = dual(
  (args) => args[0] instanceof CombinedAutocompleteProvider,
  (
    provider: CombinedAutocompleteProvider,
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    force: boolean = false,
  ): Promise<AutocompleteSuggestions | null> =>
    provider.getSuggestions(lines, cursorLine, cursorCol, {
      signal: new AbortController().signal,
      force,
    }),
);
