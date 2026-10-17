import assert from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

import { Effect } from "effect";

import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { getSuggestions, setupFolder } from "./autocomplete-helpers.ts";
import { toJson } from "./effect-helpers.ts";

describe("CombinedAutocompleteProvider", () => {
  describe("dot-slash path completion", () => {
    let baseDir = "";
    beforeEach(() => {
      baseDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-"));
    });
    afterEach(() => {
      rmSync(baseDir, { recursive: true, force: true });
    });
    test("preserves CJK characters in unprefixed Tab completions", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          setupFolder(baseDir, { files: { "文档/说明.md": "text" } });
          const provider = new CombinedAutocompleteProvider([], baseDir);
          const line = "文档/说";
          const result = yield* Effect.promise(() =>
            getSuggestions(provider, [line], 0, line.length, true),
          );
          assert.ok(result);
          assert.strictEqual(result.prefix, line);
          assert.deepStrictEqual(
            result.items.map((item) => item.value),
            ["文档/说明.md"],
          );
        }),
      ));

    test("preserves ./ prefix when completing paths", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          setupFolder(baseDir, {
            files: {
              "update.sh": "#!/bin/bash",
              "utils.ts": "export {};",
            },
          });

          const provider = new CombinedAutocompleteProvider([], baseDir);
          const line = "./up";
          const result = yield* Effect.promise(() =>
            getSuggestions(provider, [line], 0, line.length, true),
          );

          assert.notEqual(result, null, "Should return suggestions for ./ path");
          const values = result?.items.map((item) => item.value);
          assert.ok(
            values?.includes("./update.sh"),
            `Expected ./update.sh in ${yield* toJson(values ?? null)}`,
          );
        }),
      ));
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("dot-slash path completion", () => {
    let baseDir = "";
    beforeEach(() => {
      baseDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-"));
    });
    afterEach(() => {
      rmSync(baseDir, { recursive: true, force: true });
    });
    test("preserves ./ prefix for directory completions", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          setupFolder(baseDir, {
            dirs: ["src"],
            files: {
              "src/index.ts": "export {};",
            },
          });

          const provider = new CombinedAutocompleteProvider([], baseDir);
          const line = "./sr";
          const result = yield* Effect.promise(() =>
            getSuggestions(provider, [line], 0, line.length, true),
          );

          assert.notEqual(result, null, "Should return suggestions for ./ directory path");
          const values = result?.items.map((item) => item.value);
          assert.ok(
            values?.includes("./src/"),
            `Expected ./src/ in ${yield* toJson(values ?? null)}`,
          );
        }),
      ));
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("quoted path completion", () => {
    let baseDir = "";
    beforeEach(() => {
      baseDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-"));
    });
    afterEach(() => {
      rmSync(baseDir, { recursive: true, force: true });
    });
    test("quotes paths containing whitespace or CJK punctuation for direct completion", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const provider = new CombinedAutocompleteProvider([], baseDir);
          for (const separator of [" ", "\u3000", "，", "。"]) {
            const directory = `my${separator}folder`;
            setupFolder(baseDir, { files: { [`${directory}/test.txt`]: "content" } });
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
          setupFolder(baseDir, { dirs: ["z folder", "z，folder"], files: { "a.txt": "text" } });
          const provider = new CombinedAutocompleteProvider([], baseDir);
          const result = yield* Effect.promise(() => getSuggestions(provider, [""], 0, 0, true));
          assert.ok(result);
          assert.deepStrictEqual(
            result.items.map((item) => item.label.endsWith("/")),
            [true, true, false],
          );
        }),
      ));
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("quoted path completion", () => {
    let baseDir = "";
    beforeEach(() => {
      baseDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-"));
    });
    afterEach(() => {
      rmSync(baseDir, { recursive: true, force: true });
    });
    test("continues completion inside quoted paths", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          setupFolder(baseDir, {
            files: {
              "my folder/test.txt": "content",
              "my folder/other.txt": "content",
            },
          });

          const provider = new CombinedAutocompleteProvider([], baseDir);
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
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("quoted path completion", () => {
    let baseDir = "";
    beforeEach(() => {
      baseDir = mkdtempSync(join(tmpdir(), "msa-autocomplete-"));
    });
    afterEach(() => {
      rmSync(baseDir, { recursive: true, force: true });
    });
    test("applies quoted completion without duplicating closing quote", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          setupFolder(baseDir, {
            files: {
              "my folder/test.txt": "content",
            },
          });

          const provider = new CombinedAutocompleteProvider([], baseDir);
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
  });
});
