import assert from "node:assert";
import { describe, it, test } from "node:test";

import { Console, Effect } from "effect";

import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import autocompleteHelpers from "./autocomplete-helpers.ts";

const { getSuggestions, withFd, requireFdPath, setupFolder, useTempWorkspace } =
  autocompleteHelpers;

describe("CombinedAutocompleteProvider", () => {
  describe("extractPathPrefix", () => {
    it("extracts / from 'hey /' when forced", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const provider = new CombinedAutocompleteProvider([], "/tmp");
          const lines = ["hey /"];
          const cursorLine = 0;
          const cursorCol = 5;

          const result = yield* Effect.promise(() =>
            getSuggestions(provider, lines, cursorLine, cursorCol, true),
          );

          assert.notEqual(result, null, "Should return suggestions for root directory");
          if (result !== null) {
            assert.strictEqual(result.prefix, "/", "Prefix should be '/'");
          }
        }),
      ));

    it("extracts /A from '/A' when forced", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const provider = new CombinedAutocompleteProvider([], "/tmp");
          const lines = ["/A"];
          const cursorLine = 0;
          const cursorCol = 2;

          const result = yield* Effect.promise(() =>
            getSuggestions(provider, lines, cursorLine, cursorCol, true),
          );

          yield* Console.log("Result:", result);
          if (result !== null) {
            assert.strictEqual(result.prefix, "/A", "Prefix should be '/A'");
          }
        }),
      ));
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("extractPathPrefix", () => {
    it("does not trigger for slash commands", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const provider = new CombinedAutocompleteProvider([], "/tmp");
          const lines = ["/model"];
          const cursorLine = 0;
          const cursorCol = 6;

          const result = yield* Effect.promise(() =>
            getSuggestions(provider, lines, cursorLine, cursorCol, true),
          );

          yield* Console.log("Result:", result);
          assert.strictEqual(result, null, "Should not trigger for slash commands");
        }),
      ));

    it("triggers for absolute paths after slash command argument", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const provider = new CombinedAutocompleteProvider([], "/tmp");
          const lines = ["/command /"];
          const cursorLine = 0;
          const cursorCol = 10;

          const result = yield* Effect.promise(() =>
            getSuggestions(provider, lines, cursorLine, cursorCol, true),
          );

          yield* Console.log("Result:", result);
          assert.notEqual(result, null, "Should trigger for absolute paths in command arguments");
          if (result !== null) {
            assert.strictEqual(result.prefix, "/", "Prefix should be '/'");
          }
        }),
      ));
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", () =>
    withFd(() => {
      const ws = useTempWorkspace();
      test("returns all files and folders for empty @ query", () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* setupFolder(ws.baseDir, {
              dirs: ["src"],
              files: {
                "README.md": "readme",
              },
            });

            const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
            const line = "@";
            const result = yield* Effect.promise(() =>
              getSuggestions(provider, [line], 0, line.length),
            );

            const values = result?.items.map((item) => item.value).sort();
            assert.deepStrictEqual(values, ["@README.md", "@src/"].sort());
          }),
        ));
    }));
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", () =>
    withFd(() => {
      fdFileSuggestionsCases1();
    }));
});

function fdFileSuggestionsCases1(): void {
  const ws = useTempWorkspace();
  test("recognizes @ after CJK punctuation without consuming the preceding text", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, { files: { "README.md": "readme" } });
        const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
        for (const before of [
          "查看，",
          "\u3000",
          ..."，．：；！？（）［］｛｝“”‘’…—。、「」『』《》【】",
        ]) {
          for (const force of [false, true]) {
            const line = `${before}@REA`;
            const result = yield* Effect.promise(() =>
              getSuggestions(provider, [line], 0, line.length, force),
            );
            assert.ok(result, line);
            assert.strictEqual(result.prefix, "@REA");
            assert.deepStrictEqual(
              result.items.map((item) => item.value),
              ["@README.md"],
            );
            const applied = provider.applyCompletion(
              [line],
              0,
              line.length,
              result.items[0]!,
              result.prefix,
            );
            assert.strictEqual(applied.lines[0], `${before}@README.md `);
            assert.strictEqual(applied.cursorCol, applied.lines[0]!.length);
          }
        }
      }),
    ));
}

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", () =>
    withFd(() => {
      const ws = useTempWorkspace();
      test("recognizes @ after opening wrappers like ( and backticks", () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* setupFolder(ws.baseDir, { files: { "README.md": "readme" } });
            const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
            for (const before of ["(", "see (", "[", "`", "<", "{"]) {
              const line = `${before}@REA`;
              const result = yield* Effect.promise(() =>
                getSuggestions(provider, [line], 0, line.length),
              );
              assert.ok(result, line);
              assert.strictEqual(result.prefix, "@REA");
              const applied = provider.applyCompletion(
                [line],
                0,
                line.length,
                result.items[0]!,
                result.prefix,
              );
              assert.strictEqual(applied.lines[0], `${before}@README.md `);
            }
            const embedded = "foo(@REA";
            assert.strictEqual(
              yield* Effect.promise(() => getSuggestions(provider, [embedded], 0, embedded.length)),
              null,
            );
          }),
        ));
    }));
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", () =>
    withFd(() => {
      const ws = useTempWorkspace();
      test("preserves CJK characters and embedded @ in attachment paths", () =>
        Effect.runPromise(
          Effect.gen(function* () {
            yield* setupFolder(ws.baseDir, {
              files: { "文档/说明.md": "text", "文档@备份/说明.md": "backup" },
            });
            const provider = new CombinedAutocompleteProvider([], ws.baseDir, requireFdPath());
            for (const before of ["", "查看，"]) {
              for (const directory of ["文档", "文档@备份"]) {
                const prefix = `@${directory}/说`;
                const line = before + prefix;
                const result = yield* Effect.promise(() =>
                  getSuggestions(provider, [line], 0, line.length),
                );
                assert.ok(result, line);
                assert.strictEqual(result.prefix, prefix);
                assert.deepStrictEqual(
                  result.items.map((item) => item.value),
                  [`@${directory}/说明.md`],
                );
              }
            }
          }),
        ));
    }));
});
