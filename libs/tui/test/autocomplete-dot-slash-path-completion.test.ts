import assert from "node:assert";
import { describe, test } from "node:test";

import { Effect } from "effect";

import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { getSuggestions, setupFolder, useTempDirectory } from "./autocomplete-helpers.ts";

describe("CombinedAutocompleteProvider", () => {
  describe("dot-slash path completion", () => {
    dotSlashPathCompletionCases3();
  });
});

function dotSlashPathCompletionCases3(): void {
  const ws = useTempDirectory("msa-autocomplete-");
  test("completes Chinese path prefixes after whitespace or CJK punctuation on Tab", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, {
          files: { "说明.md": "file", "文档/说明.md": "nested file" },
        });
        const provider = new CombinedAutocompleteProvider([], ws.baseDir);
        const completions = [
          { prefix: "说", value: "说明.md" },
          { prefix: "文", value: "文档/" },
          { prefix: "文档/说", value: "文档/说明.md" },
          { prefix: "./文档/说", value: "./文档/说明.md" },
        ];
        if (process.platform !== "win32") {
          completions.push({
            prefix: `${ws.baseDir}/文档/说`,
            value: `${ws.baseDir}/文档/说明.md`,
          });
        }
        for (const separator of " \t\u3000\u00a0，：；。！？（「《") {
          for (const { prefix, value } of completions) {
            const before = `查看𠮷${separator}`;
            const line = `${before}${prefix} 后文`;
            const cursorCol = before.length + prefix.length;
            const result = yield* Effect.promise(() =>
              getSuggestions(provider, [line], 0, cursorCol, true),
            );
            assert.ok(result, line);
            assert.strictEqual(result.prefix, prefix);
            assert.deepStrictEqual(
              result.items.map((item) => item.value),
              [value],
            );
            const applied = provider.applyCompletion(
              [line],
              0,
              cursorCol,
              result.items[0]!,
              result.prefix,
            );
            assert.strictEqual(applied.lines[0], `${before}${value} 后文`);
            assert.strictEqual(applied.cursorCol, before.length + value.length);
          }
        }
      }),
    ));
}

describe("CombinedAutocompleteProvider", () => {
  describe("dot-slash path completion", () => {
    dotSlashPathCompletionCases4();
  });
});

function dotSlashPathCompletionCases4(): void {
  const ws = useTempDirectory("msa-autocomplete-");
  test("treats unquoted separators as boundaries even when a matching literal path exists", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        yield* setupFolder(ws.baseDir, { files: { "归档/说明.md": "other" } });
        const provider = new CombinedAutocompleteProvider([], ws.baseDir);
        for (const separator of [" ", "\u3000", "，", "。"]) {
          const directory = `资料${separator}归档`;
          yield* setupFolder(ws.baseDir, { files: { [`${directory}/说明.md`]: "archive" } });
          for (const marker of ["", "@"]) {
            const line = `${marker}${directory}/说`;
            const result = yield* Effect.promise(() =>
              getSuggestions(provider, [line], 0, line.length, true),
            );
            assert.ok(result, line);
            assert.strictEqual(result.prefix, "归档/说");
            assert.deepStrictEqual(
              result.items.map((item) => item.value),
              ["归档/说明.md"],
            );
          }
          const quoted = `查看，"${directory}/说"后文`;
          const cursorCol = quoted.indexOf('"后文');
          const result = yield* Effect.promise(() =>
            getSuggestions(provider, [quoted], 0, cursorCol, true),
          );
          assert.ok(result);
          assert.strictEqual(result.prefix, `"${directory}/说`);
          assert.deepStrictEqual(
            result.items.map((item) => item.value),
            [`"${directory}/说明.md"`],
          );
          const applied = provider.applyCompletion(
            [quoted],
            0,
            cursorCol,
            result.items[0]!,
            result.prefix,
          );
          assert.strictEqual(applied.lines[0], `查看，"${directory}/说明.md"后文`);
          const missing = `查看，"不存在${separator}归档/说`;
          assert.strictEqual(
            yield* Effect.promise(() =>
              getSuggestions(provider, [missing], 0, missing.length, true),
            ),
            null,
          );
        }
      }),
    ));
}

describe("CombinedAutocompleteProvider", () => {
  describe("dot-slash path completion", () => {
    const ws = useTempDirectory("msa-autocomplete-");
    test("handles an empty prefix after whitespace or CJK punctuation consistently", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* setupFolder(ws.baseDir, { files: { "说明.md": "text" } });
          const provider = new CombinedAutocompleteProvider([], ws.baseDir);
          for (const separator of [" ", "\t", "\u3000", "，", "。"]) {
            for (const force of [false, true]) {
              const line = `查看${separator}`;
              const result = yield* Effect.promise(() =>
                getSuggestions(provider, [line], 0, line.length, force),
              );
              assert.ok(result, line);
              assert.strictEqual(result.prefix, "");
              assert.deepStrictEqual(
                result.items.map((item) => item.value),
                ["说明.md"],
              );
            }
          }
          assert.strictEqual(
            yield* Effect.promise(() => getSuggestions(provider, [""], 0, 0)),
            null,
          );
        }),
      ));
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("dot-slash path completion", () => {
    const ws = useTempDirectory("msa-autocomplete-");
    test("completes paths after opening wrappers like ( [ { < and backticks", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* setupFolder(ws.baseDir, { files: { "src/main.ts": "x" } });
          const provider = new CombinedAutocompleteProvider([], ws.baseDir);
          for (const wrapper of ["(", "[", "{", "<", "`", "((", "(`"]) {
            for (const prefix of ["src/ma", "./src/ma"]) {
              const before = `see ${wrapper}`;
              const line = `${before}${prefix}`;
              const result = yield* Effect.promise(() =>
                getSuggestions(provider, [line], 0, line.length, true),
              );
              assert.ok(result, line);
              assert.strictEqual(result.prefix, prefix);
              const value = prefix.replace("src/ma", "src/main.ts");
              assert.deepStrictEqual(
                result.items.map((item) => item.value),
                [value],
              );
              const applied = provider.applyCompletion(
                [line],
                0,
                line.length,
                result.items[0]!,
                result.prefix,
              );
              assert.strictEqual(applied.lines[0], `${before}${value}`);
            }
          }
        }),
      ));
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("dot-slash path completion", () => {
    const ws = useTempDirectory("msa-autocomplete-");
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
            files: { "[slug]/page.tsx": "x", "(group)/layout.tsx": "x" },
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
  });
});
