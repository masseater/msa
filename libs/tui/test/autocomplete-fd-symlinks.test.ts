import assert from "node:assert";
import { describe, test } from "node:test";

import { Effect } from "effect";

import CombinedAutocompleteProvider from "../src/autocomplete.ts";
import platform from "../src/platform.ts";
import autocompleteHelpers from "./autocomplete-helpers.ts";
import type autocompleteHelpersTypes from "./autocomplete-helpers.types.ts";
import testPlatform from "./test-platform.ts";

const { pathOperations } = platform;

const { getSuggestions, withFd, requireFdPath, setupFolder, useTempWorkspace } =
  autocompleteHelpers;
const { symlink } = testPlatform;

const { join } = pathOperations;

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", () =>
    withFd(() => {
      const ws = useTempWorkspace();
      includesHiddenPathsButExcludes(ws);
      followsSymlinkedDirectoriesFuzzySearch(ws);
      returnsSymlinkedDirectoriesMatchingTheir(ws);
      returnsSymlinkedFilesWithoutRequiring(ws);
    }));
});

function includesHiddenPathsButExcludes(ws: autocompleteHelpersTypes.TempWorkspace): void {
  test("includes hidden paths but excludes .git", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          dirs: [".msa", ".github", ".git"],
          files: {
            ".git/config": "[core]",
            ".github/workflows/ci.yml": "name: ci",
            ".msa/config.json": "{}",
          },
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value) ?? [];
        assert.ok(values.includes("@.msa/"));
        assert.ok(values.includes("@.github/"));
        assert.ok(!values.some((value) => value === "@.git" || value.startsWith("@.git/")));
      }),
    ));
}

function followsSymlinkedDirectoriesFuzzySearch(ws: autocompleteHelpersTypes.TempWorkspace): void {
  test("follows symlinked directories for fuzzy @ search", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          files: {
            "dir/some_file.txt": "real",
          },
        });
        yield* setupFolder(ws.outsideDir, {
          files: {
            "some_file.txt": "symlinked",
          },
        });
        yield* symlink("../outside", join(ws.baseDir, "symlinked_dir"));

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@some";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value) ?? [];
        assert.ok(values.includes("@dir/some_file.txt"));
        assert.ok(values.includes("@symlinked_dir/some_file.txt"));
      }),
    ));
}

function returnsSymlinkedDirectoriesMatchingTheir(
  ws: autocompleteHelpersTypes.TempWorkspace,
): void {
  test("returns symlinked directories when matching their name", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.outsideDir, {
          files: {
            "nested/file.txt": "symlinked",
          },
        });
        yield* symlink("../outside", join(ws.baseDir, "symlinked_dir"));

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@symlinked";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value) ?? [];
        assert.ok(values.includes("@symlinked_dir/"));
      }),
    ));
}

function returnsSymlinkedFilesWithoutRequiring(ws: autocompleteHelpersTypes.TempWorkspace): void {
  test("returns symlinked files without requiring type l", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          files: {
            "original.txt": "content",
          },
        });
        const linkPath = join(ws.baseDir, "link.txt");
        yield* symlink("original.txt", linkPath);

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@link";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value) ?? [];
        assert.ok(values.includes("@link.txt"));
      }),
    ));
}
