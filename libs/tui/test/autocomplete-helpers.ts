import { afterEach, beforeEach, it } from "node:test";

import { Effect } from "effect";
import { dual } from "effect/Function";

import CombinedAutocompleteProvider from "../src/autocomplete.ts";
import type autocompleteTypes from "../src/autocomplete.types.ts";
import platformModule from "../src/platform.ts";
import type autocompleteHelpersTypes from "./autocomplete-helpers.types.ts";
import testPlatform from "./test-platform.ts";

const { pathOperations } = platformModule;

const { makeDirectory, makeTempDirectory, removeRecursive, runCommand, writeFileString } =
  testPlatform;

const { join } = pathOperations;

const locateFd = runCommand({
  args: ["fd"],
  file: process.platform === "win32" ? "where" : "which",
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

const setupFolder: {
  (baseDir: string, structure?: autocompleteHelpersTypes.FolderStructure): Effect.Effect<void>;
  (structure?: autocompleteHelpersTypes.FolderStructure): (baseDir: string) => Effect.Effect<void>;
} = dual(
  (args) => typeof args[0] === "string",
  (
    baseDir: string,
    structure: autocompleteHelpersTypes.FolderStructure = {},
  ): Effect.Effect<void> =>
    Effect.gen(function* () {
      yield* Effect.forEach(structure.dirs ?? [], (dir) => makeDirectory(join(baseDir, dir)));
      yield* Effect.forEach(Object.entries(structure.files ?? {}), ([filePath, contents]) =>
        writeFileString(join(baseDir, filePath), contents),
      );
    }),
);

const useTempDirectory = (prefix: string): autocompleteHelpersTypes.TempWorkspace => {
  const workspace: autocompleteHelpersTypes.TempWorkspace = {
    baseDir: "",
    outsideDir: "",
    rootDir: "",
  };
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

const useTempWorkspace = (): autocompleteHelpersTypes.TempWorkspace => {
  const workspace: autocompleteHelpersTypes.TempWorkspace = {
    baseDir: "",
    outsideDir: "",
    rootDir: "",
  };
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

const located: { fdPath: string | null } = { fdPath: null };

const withFd = (register: () => void): Promise<void> =>
  Effect.runPromise(
    Effect.map(locateFd, (fdPath) => {
      located.fdPath = fdPath;
      if (fdPath === null || fdPath === "")
        it("needs fd", { skip: "fd is not installed" }, () => {});
      else register();
    }),
  );

const requireFdPath = (): string => {
  if (located.fdPath === null || located.fdPath === "") {
    throw new Error("fd is not available");
  }
  return located.fdPath;
};

const getSuggestions: {
  (
    provider: autocompleteTypes.CombinedAutocompleteProvider,
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    force?: boolean,
  ): Promise<autocompleteTypes.AutocompleteSuggestions | null>;
  (
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    force?: boolean,
  ): (
    provider: autocompleteTypes.CombinedAutocompleteProvider,
  ) => Promise<autocompleteTypes.AutocompleteSuggestions | null>;
} = dual(
  (args) => args[0] instanceof CombinedAutocompleteProvider,
  (
    provider: autocompleteTypes.CombinedAutocompleteProvider,
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    force: boolean = false,
  ): Promise<autocompleteTypes.AutocompleteSuggestions | null> =>
    provider.getSuggestions(lines, cursorLine, cursorCol, {
      force,
      signal: new AbortController().signal,
    }),
);

const autocompleteHelpers = {
  getSuggestions,
  requireFdPath,
  setupFolder,
  useTempDirectory,
  useTempWorkspace,
  withFd,
};

export default autocompleteHelpers;
