import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { type AutocompleteProvider, CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Autocomplete", () => {
    autocompleteCases14();
  });
});

function autocompleteCases14(): void {
  it("highlights unique prefix match as user types (before full exact match)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);

        const mockProvider: AutocompleteProvider = {
          getSuggestions: (lines, _cursorLine, cursorCol) => {
            const text = lines[0] || "";
            const beforeCursor = text.slice(0, cursorCol);

            const argtestMatch = beforeCursor.match(/^\/argtest\s+(\S+)$/u);
            if (argtestMatch !== null) {
              const argumentText = argtestMatch[1]!;
              const allArguments = [
                { value: "one", label: "one" },
                { value: "two", label: "two" },
                { value: "three", label: "three" },
              ];
              return Promise.resolve({ items: allArguments, prefix: argumentText });
            }
            return Promise.resolve(null);
          },
          applyCompletion,
        };

        editor.setAutocompleteProvider(mockProvider);

        typeText(editor, "/argtest tw");

        assert.strictEqual(editor.getText(), "/argtest tw");
        yield* flushAutocomplete;
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("\r");
        assert.strictEqual(editor.getText(), "/argtest two");
      }),
    ));
}

describe("Editor component", () => {
  describe("Autocomplete", () => {
    autocompleteCases15();
  });
});

function autocompleteCases15(): void {
  it("selects first prefix match when multiple items match", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);

        const mockProvider: AutocompleteProvider = {
          getSuggestions: (lines, _cursorLine, cursorCol) => {
            const text = lines[0] || "";
            const beforeCursor = text.slice(0, cursorCol);

            const argtestMatch = beforeCursor.match(/^\/argtest\s+(\S+)$/u);
            if (argtestMatch !== null) {
              const argumentText = argtestMatch[1]!;
              const allArguments = [
                { value: "one", label: "one" },
                { value: "two", label: "two" },
                { value: "three", label: "three" },
              ];
              return Promise.resolve({ items: allArguments, prefix: argumentText });
            }
            return Promise.resolve(null);
          },
          applyCompletion,
        };

        editor.setAutocompleteProvider(mockProvider);

        typeText(editor, "/argtest t");

        yield* flushAutocomplete;
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("\r");
        assert.strictEqual(editor.getText(), "/argtest two");
      }),
    ));
}

describe("Editor component", () => {
  describe("Autocomplete", () => {
    autocompleteCases16();
  });
});

function autocompleteCases16(): void {
  it("works for built-in-style command argument completion path (model-like)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);

        const mockProvider: AutocompleteProvider = {
          getSuggestions: (lines, _cursorLine, cursorCol) => {
            const text = lines[0] || "";
            const beforeCursor = text.slice(0, cursorCol);

            const modelMatch = beforeCursor.match(/^\/model\s+(\S+)$/u);
            if (modelMatch !== null) {
              const modelText = modelMatch[1]!;
              const allModels = [
                { value: "gpt-4o", label: "gpt-4o" },
                { value: "gpt-4o-mini", label: "gpt-4o-mini" },
                { value: "claude-sonnet", label: "claude-sonnet" },
              ];
              const filtered = allModels.filter((m) => m.value.startsWith(modelText));
              if (filtered.length > 0) {
                return Promise.resolve({ items: filtered, prefix: modelText });
              }
            }
            return Promise.resolve(null);
          },
          applyCompletion,
        };

        editor.setAutocompleteProvider(mockProvider);

        typeText(editor, "/model gpt-4o-mini");

        assert.strictEqual(editor.getText(), "/model gpt-4o-mini");
        yield* flushAutocomplete;
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("\r");

        assert.strictEqual(editor.getText(), "/model gpt-4o-mini");
      }),
    ));
}

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("awaits async slash command argument completions", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new Editor(createTestTUI(), defaultEditorTheme);
          const provider = new CombinedAutocompleteProvider(
            [
              {
                name: "load-skills",
                description: "Load skills",
                getArgumentCompletions: (prefix) =>
                  prefix.startsWith("s") ? [{ value: "skill-a", label: "skill-a" }] : null,
              },
            ],
            process.cwd(),
          );
          editor.setAutocompleteProvider(provider);
          editor.setText("/load-skills ");

          editor.handleInput("s");
          yield* flushAutocomplete;
          assert.strictEqual(editor.isShowingAutocomplete(), true);

          editor.handleInput("\t");
          assert.strictEqual(editor.getText(), "/load-skills skill-a");
          assert.strictEqual(editor.isShowingAutocomplete(), false);
        }),
      ));
  });
});

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("ignores invalid slash command argument completion results", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new Editor(createTestTUI(), defaultEditorTheme);
          const provider = new CombinedAutocompleteProvider(
            [
              {
                name: "load-skills",
                description: "Load skills",
                getArgumentCompletions: (() => "not-an-array") as unknown as (
                  argumentPrefix: string,
                ) => Promise<{ value: string; label: string }[] | null>,
              },
            ],
            process.cwd(),
          );
          editor.setAutocompleteProvider(provider);
          editor.setText("/load-skills ");

          editor.handleInput("s");
          yield* flushAutocomplete;
          assert.strictEqual(editor.isShowingAutocomplete(), false);
          assert.strictEqual(editor.getText(), "/load-skills s");
        }),
      ));
  });
});
