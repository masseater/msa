import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import type autocompleteTypes from "../src/autocomplete.types.ts";
import Editor from "../src/components/editor.ts";
import editorHelpers from "./editor-helpers.ts";
import testThemes from "./test-themes.ts";

const { defaultEditorTheme } = testThemes;

const { applyCompletion, createTestTUI, flushAutocomplete, typeText } = editorHelpers;

describe("Editor component", () => {
  describe("Autocomplete", () => {
    debouncesAutocompleteWhileTyping();
    debouncesAutocompleteWhileTyping2();
    debouncesCustomTriggerCharactersAutocompleteWhile();
    resetsCustomTriggerCharactersProviderChanges();
    abortsActiveAutocompleteTypingContinues();
  });
});

function debouncesAutocompleteWhileTyping(): void {
  it("debounces @ autocomplete while typing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        let suggestionCalls = 0;

        const mockProvider: autocompleteTypes.AutocompleteProvider = {
          applyCompletion,
          getSuggestions: (lines, _cursorLine, cursorCol) => {
            suggestionCalls += 1;
            const text = (lines[0] || "").slice(0, cursorCol);
            return Promise.resolve({
              items: [{ label: "main.ts", value: "@main.ts" }],
              prefix: text,
            });
          },
        };

        editor.setAutocompleteProvider(mockProvider);

        typeText(editor, "@mai");

        assert.strictEqual(suggestionCalls, 0);
        assert.strictEqual(editor.isShowingAutocomplete(), false);

        yield* Effect.sleep(50);
        yield* flushAutocomplete;

        assert.strictEqual(suggestionCalls, 1);
        assert.strictEqual(editor.isShowingAutocomplete(), true);
      }),
    ));
}

function debouncesAutocompleteWhileTyping2(): void {
  it("debounces # autocomplete while typing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        let suggestionCalls = 0;

        const mockProvider: autocompleteTypes.AutocompleteProvider = {
          applyCompletion,
          getSuggestions: (lines, _cursorLine, cursorCol) => {
            suggestionCalls += 1;
            const text = (lines[0] || "").slice(0, cursorCol);
            return Promise.resolve({
              items: [{ label: "#2983", value: "#2983" }],
              prefix: text,
            });
          },
        };

        editor.setAutocompleteProvider(mockProvider);

        typeText(editor, "#298");

        assert.strictEqual(suggestionCalls, 0);
        assert.strictEqual(editor.isShowingAutocomplete(), false);

        yield* Effect.sleep(50);
        yield* flushAutocomplete;

        assert.strictEqual(suggestionCalls, 1);
        assert.strictEqual(editor.isShowingAutocomplete(), true);
      }),
    ));
}

function debouncesCustomTriggerCharactersAutocompleteWhile(): void {
  it("debounces custom triggerCharacters autocomplete while typing", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        let suggestionCalls = 0;

        editor.setAutocompleteProvider({
          applyCompletion,
          getSuggestions: (lines, _cursorLine, cursorCol) => {
            suggestionCalls += 1;
            const prefix = (lines[0] || "").slice(0, cursorCol);
            return Promise.resolve({
              items: [{ label: "skill-name", value: "$skill-name" }],
              prefix,
            });
          },
          triggerCharacters: ["$"],
        });

        typeText(editor, "$sk");

        assert.strictEqual(suggestionCalls, 0);
        yield* Effect.sleep(50);
        yield* flushAutocomplete;

        assert.strictEqual(suggestionCalls, 1);
        assert.strictEqual(editor.isShowingAutocomplete(), true);
      }),
    ));
}

function resetsCustomTriggerCharactersProviderChanges(): void {
  it("resets custom triggerCharacters when provider changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        let suggestionCalls = 0;

        editor.setAutocompleteProvider({
          applyCompletion,
          getSuggestions: () =>
            Promise.resolve({
              items: [{ label: "skill-name", value: "$skill-name" }],
              prefix: "$",
            }),
          triggerCharacters: ["$"],
        });
        editor.setAutocompleteProvider({
          applyCompletion,
          getSuggestions: () => {
            suggestionCalls += 1;
            return Promise.resolve({
              items: [{ label: "skill-name", value: "$skill-name" }],
              prefix: "$",
            });
          },
        });

        editor.handleInput("$");
        editor.handleInput("s");
        yield* Effect.sleep(50);
        yield* flushAutocomplete;

        assert.strictEqual(suggestionCalls, 0);
        assert.strictEqual(editor.isShowingAutocomplete(), false);
      }),
    ));
}

function abortsActiveAutocompleteTypingContinues(): void {
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
}

function abortableProvider(onAbort: () => void): autocompleteTypes.AutocompleteProvider {
  return {
    applyCompletion,
    getSuggestions: (_lines, _cursorLine, _cursorCol, options) =>
      Effect.runPromise(
        Effect.sleep(500).pipe(
          Effect.as<autocompleteTypes.AutocompleteSuggestions | null>({
            items: [{ label: "main.ts", value: "@main.ts" }],
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
  };
}
