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
} from "./autocomplete-helpers.ts";

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
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
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
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
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
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
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
    test("ranks shallower same-score @ matches before deeper matches", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* setupFolder(ws.baseDir, {
            dirs: [
              "scope/aaa/venv/lib/python3.12/site-packages/pkg/core/profile",
              "scope/projects",
            ],
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
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
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
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
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
  });
});

describe("CombinedAutocompleteProvider", () => {
  describe("fd @ file suggestions", { skip: !isFdInstalled }, () => {
    const ws = useTempWorkspace();
    test("includes hidden paths but excludes .git", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          yield* setupFolder(ws.baseDir, {
            dirs: [".msa", ".github", ".git"],
            files: {
              ".msa/config.json": "{}",
              ".github/workflows/ci.yml": "name: ci",
              ".git/config": "[core]",
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
  });
});
