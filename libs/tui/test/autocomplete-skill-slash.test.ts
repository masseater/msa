import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";

const commands = [
  { description: "Multi-agent deep research", name: "skill:deep-research" },
  { description: "Refine a raw idea into a falsifiable seed", name: "skill:research-idea" },
  { description: "Route work to a sidecar", name: "skill:to-sidecar" },
  { description: "Generate ideas", name: "skill:brainstorm" },
  { description: "Select the active model", name: "model" },
];

function suggestionsFor(prefix: string): Promise<string[]> {
  return Effect.runPromise(
    Effect.gen(function* () {
      const provider = new CombinedAutocompleteProvider(commands, process.cwd());
      const line = `/${prefix}`;
      const result = yield* Effect.promise(() =>
        provider.getSuggestions([line], 0, line.length, {
          signal: new AbortController().signal,
        }),
      );
      assert.ok(result, `expected suggestions for "/${prefix}"`);
      return result.items.map((item) => item.value);
    }),
  );
}

describe("CombinedAutocompleteProvider slash-command filter", () => {
  it("ranks skill:research-idea first for query 'idea'", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const items = yield* Effect.promise(() => suggestionsFor("idea"));
        assert.equal(items[0], "skill:research-idea");
        assert.ok(items.indexOf("skill:deep-research") > items.indexOf("skill:research-idea"));
      }),
    ));

  it("keeps ordinary slash commands matching", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const items = yield* Effect.promise(() => suggestionsFor("mod"));
        assert.ok(items.includes("model"));
      }),
    ));
});

describe("CombinedAutocompleteProvider slash-command filter", () => {
  it("completes commands after leading whitespace and preserves it", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = new CombinedAutocompleteProvider([{ name: "model" }], process.cwd());
        for (const [line, expected] of [
          [" /", " /model "],
          ["  /mod", "  /model "],
          ["\t/mod", "\t/model "],
        ] as const) {
          const result = yield* Effect.promise(() =>
            provider.getSuggestions([line], 0, line.length, {
              signal: new AbortController().signal,
            }),
          );
          assert.ok(result);
          assert.equal(result.prefix, line.trimStart());
          assert.deepStrictEqual(
            result.items.map((item) => item.value),
            ["model"],
          );
          const applied = provider.applyCompletion(
            [line],
            0,
            line.length,
            result.items[0]!,
            result.prefix,
          );
          assert.equal(applied.lines[0], expected);
          assert.equal(applied.cursorCol, expected.length);
        }
      }),
    ));
});

describe("CombinedAutocompleteProvider slash-command filter", () => {
  it("completes command arguments after leading whitespace", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const provider = new CombinedAutocompleteProvider(
          [
            {
              getArgumentCompletions: (prefix: string) => {
                assert.equal(prefix, "son");
                return [{ label: "sonnet", value: "sonnet" }];
              },
              name: "model",
            },
          ],
          process.cwd(),
        );
        const line = "  /model son";
        const result = yield* Effect.promise(() =>
          provider.getSuggestions([line], 0, line.length, {
            signal: new AbortController().signal,
          }),
        );
        assert.ok(result);
        assert.equal(result.prefix, "son");
        const applied = provider.applyCompletion(
          [line],
          0,
          line.length,
          result.items[0]!,
          result.prefix,
        );
        assert.equal(applied.lines[0], "  /model sonnet");
      }),
    ));

  it("keeps explicit skill: queries working", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const items = yield* Effect.promise(() => suggestionsFor("skill:side"));
        assert.ok(items.includes("skill:to-sidecar"));
      }),
    ));
});

describe("CombinedAutocompleteProvider slash-command filter", () => {
  it("lists skills while typing the skill prefix", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const items = yield* Effect.promise(() => suggestionsFor("skill"));
        assert.deepStrictEqual(
          items.filter((item) => item.startsWith("skill:")),
          commands
            .filter((command) => command.name.startsWith("skill:"))
            .map((command) => command.name),
        );
      }),
    ));

  it("keeps fuzzy skill-prefix shorthand working", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const items = yield* Effect.promise(() => suggestionsFor("skbra"));
        assert.ok(items.includes("skill:brainstorm"));
      }),
    ));
});
