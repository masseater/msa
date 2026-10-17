import assert from "node:assert";
import { describe, test } from "node:test";

import { Effect } from "effect";

import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import {
  getSuggestions,
  isFdInstalled,
  requireFdPath,
  setupFolder,
  useTempWorkspace,
  type TempWorkspace,
} from "./autocomplete-helpers.ts";

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
    completesQuotedCJKAttachmentsAfter(ws);
    doesNotInterpretEmailAddresses(ws);
    quotesPathsContainingWhitespaceCJK(ws);
    continuesAutocompleteInsideQuotedPaths(ws);
    appliesQuotedCompletionWithoutDuplicating(ws);
  });
});

function completesQuotedCJKAttachmentsAfter(ws: TempWorkspace): void {
  test("completes quoted CJK attachments after prose without losing path segments or quotes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        for (const separator of [" ", "\u3000", "，", "。"]) {
          const directory = `我的${separator}文档`;
          yield* setupFolder(ws.baseDir, {
            files: { [`${directory}/说明.md`]: "text", "文档/说明.md": "not the quoted path" },
          });
          const line = `查看：@"${directory}/说"后文`;
          const cursorCol = line.indexOf('"后文');
          const result = yield* Effect.promise(() =>
            getSuggestions(provider, [line], 0, cursorCol),
          );
          assert.ok(result);
          assert.strictEqual(result.prefix, `@"${directory}/说`);
          assert.deepStrictEqual(
            result.items.map((item) => item.value),
            [`@"${directory}/说明.md"`],
          );
          const applied = provider.applyCompletion(
            [line],
            0,
            cursorCol,
            result.items[0]!,
            result.prefix,
          );
          assert.strictEqual(applied.lines[0], `查看：@"${directory}/说明.md" 后文`);
          assert.strictEqual(applied.cursorCol, `查看：@"${directory}/说明.md" `.length);
        }
      }),
    ));
}

function doesNotInterpretEmailAddresses(ws: TempWorkspace): void {
  test("does not interpret email addresses or @ after ASCII or CJK letters as attachment prefixes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          files: { "README.md": "readme", "example.com": "text" },
        });
        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        for (const before of [
          "user",
          "查看",
          "あ",
          "カ",
          "한",
          "ㄅ",
          "𠮷",
          "か\u3099",
          "禰\u{e0100}",
          "々",
          "Ａ",
        ]) {
          for (const name of ["REA", "example.com"]) {
            const line = `${before}@${name}`;
            assert.strictEqual(
              yield* Effect.promise(() => getSuggestions(provider, [line], 0, line.length)),
              null,
              line,
            );
          }
        }
      }),
    ));
}

function quotesPathsContainingWhitespaceCJK(ws: TempWorkspace): void {
  test("quotes paths containing whitespace or CJK punctuation for @ suggestions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        for (const separator of [" ", "\u3000", "，", "。"]) {
          const directory = `my${separator}folder`;
          yield* setupFolder(ws.baseDir, { files: { [`${directory}/test.txt`]: "content" } });
          const line = "@my";
          const result = yield* Effect.promise(() =>
            getSuggestions(provider, [line], 0, line.length),
          );
          assert.ok(result);
          const item = result.items.find((entry) => entry.value === `@"${directory}/"`);
          assert.ok(item, directory);
          const applied = provider.applyCompletion([line], 0, line.length, item, result.prefix);
          const continued = yield* Effect.promise(() =>
            getSuggestions(provider, applied.lines, 0, applied.cursorCol),
          );
          assert.strictEqual(continued?.prefix, `@"${directory}/`);
          assert.ok(continued?.items.some((entry) => entry.value === `@"${directory}/test.txt"`));
        }
      }),
    ));
}

function continuesAutocompleteInsideQuotedPaths(ws: TempWorkspace): void {
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
}

function appliesQuotedCompletionWithoutDuplicating(ws: TempWorkspace): void {
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
        const result = yield* Effect.promise(() => getSuggestions(provider, [line], 0, cursorCol));

        assert.notEqual(result, null, "Should return suggestions for quoted @ path");
        const item = result?.items.find((entry) => entry.value === '@"my folder/test.txt"');
        assert.ok(item, "Should find test.txt suggestion");

        const applied = provider.applyCompletion([line], 0, cursorCol, item!, result!.prefix);
        assert.strictEqual(applied.lines[0], '@"my folder/test.txt" ');
      }),
    ));
}
