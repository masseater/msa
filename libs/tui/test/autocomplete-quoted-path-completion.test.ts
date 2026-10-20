import assert from "node:assert";
import { describe, test } from "node:test";

import { Effect } from "effect";

import CombinedAutocompleteProvider from "../src/autocomplete.ts";
import autocompleteHelpers from "./autocomplete-helpers.ts";
import type autocompleteHelpersTypes from "./autocomplete-helpers.types.ts";

const { getSuggestions, setupFolder, useTempDirectory } = autocompleteHelpers;

describe("CombinedAutocompleteProvider", () => {
  describe("dot-slash path completion", () => {
    const ws = useTempDirectory("msa-autocomplete-");
    completesQuotedPathsAfterOpening(ws);
  });
  describe("quoted path completion", () => {
    const ws = useTempDirectory("msa-autocomplete-");
    quotesPathsContainingWhitespaceCJK(ws);
    continuesCompletionInsideQuotedPaths(ws);
    appliesQuotedCompletionWithoutDuplicating(ws);
  });
});

function completesQuotedPathsAfterOpening(ws: autocompleteHelpersTypes.TempWorkspace): void {
  test("completes quoted paths after opening wrappers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, { files: { "my dir/main.ts": "x" } });
        const provider = new CombinedAutocompleteProvider([], ws.baseDir);
        const line = 'see ("my dir/ma';
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length, true),
        );
        assert.ok(result);
        assert.strictEqual(result.prefix, '"my dir/ma');
        assert.deepStrictEqual(
          result.items.map((item) => item.value),
          ['"my dir/main.ts"'],
        );
      }),
    ));
  test("keeps wrappers that are closed inside the path", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          files: { "(group)/layout.tsx": "x", "[slug]/page.tsx": "x" },
        });
        const provider = new CombinedAutocompleteProvider([], ws.baseDir);
        for (const [prefix, value] of [
          ["[slug]/pa", "[slug]/page.tsx"],
          ["(group)/la", "(group)/layout.tsx"],
          ["./[slug]/pa", "./[slug]/page.tsx"],
        ]) {
          const line = `see ${prefix}`;
          const result = yield* Effect.promise(() =>
            getSuggestions(provider, [line], 0, line.length, true),
          );
          assert.ok(result, line);
          assert.strictEqual(result.prefix, prefix);
          assert.deepStrictEqual(
            result.items.map((item) => item.value),
            [value],
          );
        }
      }),
    ));
}

function quotesPathsContainingWhitespaceCJK(ws: autocompleteHelpersTypes.TempWorkspace): void {
  test("quotes paths containing whitespace or CJK punctuation for direct completion", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = new CombinedAutocompleteProvider([], ws.baseDir);
        for (const separator of [" ", "\u3000", "，", "。"]) {
          const directory = `my${separator}folder`;
          yield* setupFolder(ws.baseDir, { files: { [`${directory}/test.txt`]: "content" } });
          const line = "my";
          const result = yield* Effect.promise(() =>
            getSuggestions(provider, [line], 0, line.length, true),
          );
          assert.ok(result);
          const item = result.items.find((entry) => entry.value === `"${directory}/"`);
          assert.ok(item, directory);
          const applied = provider.applyCompletion([line], 0, line.length, item, result.prefix);
          const continued = yield* Effect.promise(() =>
            getSuggestions(provider, applied.lines, 0, applied.cursorCol, true),
          );
          assert.strictEqual(continued?.prefix, `"${directory}/`);
          assert.deepStrictEqual(
            continued?.items.map((entry) => entry.value),
            [`"${directory}/test.txt"`],
          );
        }
      }),
    ));
  test("keeps quoted directories before files", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          dirs: ["z folder", "z，folder"],
          files: { "a.txt": "text" },
        });
        const provider = new CombinedAutocompleteProvider([], ws.baseDir);
        const result = yield* Effect.promise(() => getSuggestions(provider, [""], 0, 0, true));
        assert.ok(result);
        assert.deepStrictEqual(
          result.items.map((item) => item.label.endsWith("/")),
          [true, true, false],
        );
      }),
    ));
}

function continuesCompletionInsideQuotedPaths(ws: autocompleteHelpersTypes.TempWorkspace): void {
  test("continues completion inside quoted paths", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          files: {
            "my folder/other.txt": "content",
            "my folder/test.txt": "content",
          },
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir);
        const line = '"my folder/"';
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, line.length - 1, true),
        );

        assert.notEqual(result, null, "Should return suggestions for quoted folder path");
        const values = result?.items.map((item) => item.value);
        assert.ok(values?.includes('"my folder/test.txt"'));
        assert.ok(values?.includes('"my folder/other.txt"'));
      }),
    ));
}

function appliesQuotedCompletionWithoutDuplicating(
  ws: autocompleteHelpersTypes.TempWorkspace,
): void {
  test("applies quoted completion without duplicating closing quote", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          files: {
            "my folder/test.txt": "content",
          },
        });

        const provider = new CombinedAutocompleteProvider([], ws.baseDir);
        const line = '"my folder/te"';
        const cursorCol = line.length - 1;
        const result = yield* Effect.promise(() =>
          getSuggestions(provider, [line], 0, cursorCol, true),
        );

        assert.notEqual(result, null, "Should return suggestions for quoted path");
        const item = result?.items.find((entry) => entry.value === '"my folder/test.txt"');
        assert.ok(item, "Should find test.txt suggestion");

        const applied = provider.applyCompletion([line], 0, cursorCol, item!, result!.prefix);
        assert.strictEqual(applied.lines[0], '"my folder/test.txt"');
      }),
    ));
}
