import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { CombinedAutocompleteProvider, type AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Autocomplete", () => {
    appliesExactTypedSlashArgument();
    selectsFirstPrefixMatchEnter();
    highlightsUniquePrefixMatchUser();
    selectsFirstPrefixMatchMultiple();
    worksBuiltStyleCommandArgument();
    awaitsAsyncSlashCommandArgument();
    ignoresInvalidSlashCommandArgument();
  });
});

function appliesExactTypedSlashArgument(): void {
  it("applies exact typed slash-argument value on Enter even when first item is highlighted", () =>
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
              const filtered = allArguments.filter((arg) => arg.value.startsWith(argumentText));
              if (filtered.length > 0) {
                return Promise.resolve({ items: filtered, prefix: argumentText });
              }
            }
            return Promise.resolve(null);
          },
          applyCompletion,
        };

        editor.setAutocompleteProvider(mockProvider);

        typeText(editor, "/argtest two");

        assert.strictEqual(editor.getText(), "/argtest two");
        yield* flushAutocomplete;
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("\r");

        assert.strictEqual(editor.getText(), "/argtest two");
      }),
    ));
}

function selectsFirstPrefixMatchEnter(): void {
  it("selects first prefix match on Enter when typed arg is not exact match", () =>
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
                { value: "two", label: "two" },
                { value: "three", label: "three" },
                { value: "twelve", label: "twelve" },
              ];
              const filtered = allArguments.filter((arg) => arg.value.startsWith(argumentText));
              if (filtered.length > 0) {
                return Promise.resolve({ items: filtered, prefix: argumentText });
              }
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

function highlightsUniquePrefixMatchUser(): void {
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

function selectsFirstPrefixMatchMultiple(): void {
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

function worksBuiltStyleCommandArgument(): void {
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

function awaitsAsyncSlashCommandArgument(): void {
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
}

function ignoresInvalidSlashCommandArgument(): void {
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
}
