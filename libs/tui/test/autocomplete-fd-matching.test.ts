import assert from "node:assert";
import { describe, test } from "node:test";

import { Effect } from "effect";

import { CombinedAutocompleteProvider, type AutocompleteSuggestions } from "../src/autocomplete.ts";
import { pathOperations } from "../src/platform.ts";
import {
  getSuggestions,
  isFdInstalled,
  requireFdPath,
  setupFolder,
  useTempWorkspace,
  type TempWorkspace,
} from "./autocomplete-helpers.ts";
import { makeDirectory } from "./test-platform.ts";

const { join } = pathOperations;

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
    matchesFileExtensionQuery(ws);
    filtersAreCaseInsensitive(ws);
    ranksDirectoriesBeforeFiles(ws);
    returnsNestedFilePaths(ws);
    matchesDeeplyNestedPaths(ws);
    matchesDirectoryMiddlePathFull(ws);
    scopesFuzzySearchRelativeDirectories(ws);
    ranksShallowerSameScoreMatches(ws);
    includesScopedDirectChildrenRecursive(ws);
    returnsSameSuggestionsCwdPath(ws);
  });
});

function matchesFileExtensionQuery(ws: TempWorkspace): void {
  test("matches file with extension in query", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          files: {
            "file.txt": "content",
          },
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@file.txt";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value);
        assert.ok(values?.includes("@file.txt"));
      }),
    ));
}

function filtersAreCaseInsensitive(ws: TempWorkspace): void {
  test("filters are case insensitive", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          dirs: ["src"],
          files: {
            "README.md": "readme",
          },
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@re";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value).sort();
        assert.deepStrictEqual(values, ["@README.md"]);
      }),
    ));
}

function ranksDirectoriesBeforeFiles(ws: TempWorkspace): void {
  test("ranks directories before files", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          dirs: ["src"],
          files: {
            "src.txt": "text",
          },
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@src";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const firstValue = result?.items[0]?.value;
        const hasSrcFile = result?.items?.some((item) => item.value === "@src.txt");
        assert.strictEqual(firstValue, "@src/");
        assert.ok(hasSrcFile);
      }),
    ));
}

function returnsNestedFilePaths(ws: TempWorkspace): void {
  test("returns nested file paths", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          files: {
            "src/index.ts": "export {};\n",
          },
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@index";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value);
        assert.ok(values?.includes("@src/index.ts"));
      }),
    ));
}

function matchesDeeplyNestedPaths(ws: TempWorkspace): void {
  test("matches deeply nested paths", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          files: {
            "libs/tui/src/autocomplete.ts": "export {};",
            "libs/ai/src/autocomplete.ts": "export {};",
          },
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@tui/src/auto";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value);
        assert.ok(values?.includes("@libs/tui/src/autocomplete.ts"));
        assert.ok(values?.includes("@libs/ai/src/autocomplete.ts") !== true);
      }),
    ));
}

function matchesDirectoryMiddlePathFull(ws: TempWorkspace): void {
  test("matches directory in middle of path with --full-path", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          files: {
            "src/components/Button.tsx": "export {};",
            "src/utils/helpers.ts": "export {};",
          },
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@components/";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value);
        assert.ok(values?.includes("@src/components/Button.tsx"));
        assert.ok(values?.includes("@src/utils/helpers.ts") !== true);
      }),
    ));
}

function scopesFuzzySearchRelativeDirectories(ws: TempWorkspace): void {
  test("scopes fuzzy search to relative directories and searches recursively", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.outsideDir, {
          files: {
            "nested/alpha.ts": "export {};",
            "nested/deeper/also-alpha.ts": "export {};",
            "nested/deeper/zzz.ts": "export {};",
          },
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@../outside/a";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value);
        assert.ok(values?.includes("@../outside/nested/alpha.ts"));
        assert.ok(values?.includes("@../outside/nested/deeper/also-alpha.ts"));
        assert.ok(values?.includes("@../outside/nested/deeper/zzz.ts") !== true);
      }),
    ));
}

function ranksShallowerSameScoreMatches(ws: TempWorkspace): void {
  test("ranks shallower same-score @ matches before deeper matches", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          dirs: ["scope/aaa/venv/lib/python3.12/site-packages/pkg/core/profile", "scope/projects"],
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@scope/pro";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value) ?? [];
        assert.strictEqual(values[0], "@scope/projects/");
        assert.ok(
          values.includes("@scope/aaa/venv/lib/python3.12/site-packages/pkg/core/profile/"),
        );
      }),
    ));
}

function includesScopedDirectChildrenRecursive(ws: TempWorkspace): void {
  test("includes scoped direct children when recursive @ matches are flooded", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const floodedDirs = Array.from(
          { length: 250 },
          (_, index) =>
            `scope/a${String(index + 1).padStart(3, "0")}/venv/lib/python3.12/site-packages/pkg/core/profile`,
        );
        yield* setupFolder(ws.baseDir, {
          dirs: ["scope/projects", ...floodedDirs],
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        const line = "@scope/pro";
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length),
        );

        const values = result?.items.map((item) => item.value) ?? [];
        assert.strictEqual(values[0], "@scope/projects/");
        assert.ok(
          values.some((value) => value.includes("/profile/")),
          "Should keep deep fuzzy matches after direct children",
        );
      }),
    ));
}

function returnsSameSuggestionsCwdPath(ws: TempWorkspace): void {
  test("returns the same @ suggestions when the cwd path contains the query", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const normalBaseDir = join(ws.rootDir, "cwd-normal");
        const queryInPathBaseDir = join(ws.rootDir, "cwd-plan-repro");
        yield* makeDirectory(normalBaseDir);
        yield* makeDirectory(queryInPathBaseDir);

        const structure = {
          dirs: ["apps/coding-agent/examples/extensions/plan-mode"],
          files: {
            "apps/coding-agent/examples/extensions/plan-mode/README.md": "readme",
            "libs/tui/docs/plan.md": "plan",
          },
        };
        yield* setupFolder(normalBaseDir, structure);
        yield* setupFolder(queryInPathBaseDir, structure);

        const query = "@plan";
        const normalProvider = new CombinedAutocompleteProvider([], normalBaseDir, requireFdPath());
        const queryInPathProvider = new CombinedAutocompleteProvider(
          [],
          queryInPathBaseDir,
          requireFdPath(),
        );

        const normalResult = yield* Effect.promise(() =>
          getSuggestions(normalProvider, [query], 0, query.length),
        );
        const queryInPathResult = yield* Effect.promise(() =>
          getSuggestions(queryInPathProvider, [query], 0, query.length),
        );

        const normalize = (result: AutocompleteSuggestions | null) =>
          (result?.items ?? []).map((item) => `${item.label} :: ${item.description ?? ""}`).sort();

        assert.deepStrictEqual(normalize(queryInPathResult), normalize(normalResult));
        assert.ok(
          normalize(normalResult).includes(
            "plan-mode/ :: apps/coding-agent/examples/extensions/plan-mode",
          ),
        );
        assert.ok(normalize(normalResult).includes("plan.md :: libs/tui/docs/plan.md"));
      }),
    ));
}
