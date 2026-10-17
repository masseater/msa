import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { type AutocompleteProvider, type AutocompleteSuggestions } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

function abortableProvider(onAbort: () => void): AutocompleteProvider {
  return {
    getSuggestions: (_lines, _cursorLine, _cursorCol, options) =>
      Effect.runPromise(
        Effect.sleep(500).pipe(
          Effect.as<AutocompleteSuggestions | null>({
            items: [{ value: "@main.ts", label: "main.ts" }],
            prefix: "@main",
          }),
          Effect.race(
            Effect.callback<null>((resume) => {
              options.signal.addEventListener(
                "abort",
                () => {
                  onAbort();
                  resume(Effect.succeed(null));
                },
                { once: true },
              );
            }),
          ),
        ),
      ),
    applyCompletion,
  };
}

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("aborts active @ autocomplete when typing continues", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new Editor(createTestTUI(), defaultEditorTheme);
          let aborts = 0;

          const mockProvider = abortableProvider(() => {
            aborts += 1;
          });

          editor.setAutocompleteProvider(mockProvider);

          typeText(editor, "@mai");
          yield* Effect.sleep(250);
          editor.handleInput("n");
          yield* Effect.sleep(50);

          assert.strictEqual(aborts, 1);
        }),
      ));
  });
});

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("hides autocomplete when backspacing slash command to empty", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const editor = new Editor(createTestTUI(), defaultEditorTheme);

          const mockProvider: AutocompleteProvider = {
            getSuggestions: (lines, _cursorLine, cursorCol) => {
              const text = lines[0] || "";
              const prefix = text.slice(0, cursorCol);
              if (prefix.startsWith("/")) {
                const commands = [
                  { value: "/model", label: "model", description: "Change model" },
                  { value: "/help", label: "help", description: "Show help" },
                ];
                const query = prefix.slice(1);
                const filtered = commands.filter((c) => c.value.startsWith(query));
                if (filtered.length > 0) {
                  return Promise.resolve({ items: filtered, prefix });
                }
              }
              return Promise.resolve(null);
            },
            applyCompletion,
          };

          editor.setAutocompleteProvider(mockProvider);

          editor.handleInput("/");
          yield* flushAutocomplete;
          assert.strictEqual(editor.getText(), "/");
          assert.strictEqual(editor.isShowingAutocomplete(), true);

          editor.handleInput("\x7f");
          yield* flushAutocomplete;
          assert.strictEqual(editor.getText(), "");
          assert.strictEqual(editor.isShowingAutocomplete(), false);
        }),
      ));
  });
});

describe("Editor component", () => {
  describe("Autocomplete", () => {
    autocompleteCases12();
  });
});

function autocompleteCases12(): void {
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

describe("Editor component", () => {
  describe("Autocomplete", () => {
    autocompleteCases13();
  });
});

function autocompleteCases13(): void {
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
