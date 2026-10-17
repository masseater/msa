import assert from "node:assert";
import { describe, test } from "node:test";

import { Effect } from "effect";

import { type AutocompleteSuggestions, CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { pathOperations } from "../src/platform.ts";
import {
  getSuggestions,
  isFdInstalled,
  requireFdPath,
  setupFolder,
  useTempWorkspace,
} from "./autocomplete-helpers.ts";
import { makeDirectory, symlink } from "./test-platform.ts";

const { join } = pathOperations;

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
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
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
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
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
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
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    fdFileSuggestionsCases2();
  });
});

function fdFileSuggestionsCases2(): void {
  const ws = useTempWorkspace();
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

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
    test("continues autocomplete inside quoted @ paths", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* setupFolder(ws.baseDir, {
            files: {
              "my folder/test.txt": "content",
              "my folder/other.txt": "content",
            },
          });

          const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
          const line = '@"my folder/"';
          const result = yield* Effect.promise(() =>
            getSuggestions(provider, [line], 0, line.length - 1),
          );

          assert.notEqual(result, null, "Should return suggestions for quoted folder path");
          const values = result?.items.map((item) => item.value);
          assert.ok(values?.includes('@"my folder/test.txt"'));
          assert.ok(values?.includes('@"my folder/other.txt"'));
        }),
      ));
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
    test("applies quoted @ completion without duplicating closing quote", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* setupFolder(ws.baseDir, {
            files: {
              "my folder/test.txt": "content",
            },
          });

          const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
          const line = '@"my folder/te"';
          const cursorCol = line.length - 1;
          const result = yield* Effect.promise(() =>
            getSuggestions(provider, [line], 0, cursorCol),
          );

          assert.notEqual(result, null, "Should return suggestions for quoted @ path");
          const item = result?.items.find((entry) => entry.value === '@"my folder/test.txt"');
          assert.ok(item, "Should find test.txt suggestion");

          const applied = provider.applyCompletion([line], 0, cursorCol, item!, result!.prefix);
          assert.strictEqual(applied.lines[0], '@"my folder/test.txt" ');
        }),
      ));
  });
});
