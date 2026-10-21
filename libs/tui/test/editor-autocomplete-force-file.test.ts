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
    autoAppliesSingleForceFile();
    showsMenuForceFileHas();
    keepsSuggestionsOpenTypingForce();
  });
});

function autoAppliesSingleForceFile(): void {
  it("auto-applies single force-file suggestion without showing menu", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);

        const mockProvider: autocompleteTypes.AutocompleteProvider = {
          applyCompletion,
          getSuggestions: (lines, _cursorLine, cursorCol, options) => {
            if (options.force !== true) {
              return Promise.resolve(null);
            }
            const text = lines[0] || "";
            const prefix = text.slice(0, cursorCol);
            if (prefix === "Work") {
              return Promise.resolve({
                items: [{ label: "Workspace/", value: "Workspace/" }],
                prefix: "Work",
              });
            }
            return Promise.resolve(null);
          },
        };

        editor.setAutocompleteProvider(mockProvider);

        typeText(editor, "Work");
        assert.strictEqual(editor.getText(), "Work");

        editor.handleInput("\t");
        yield* flushAutocomplete;
        assert.strictEqual(editor.getText(), "Workspace/");
        assert.strictEqual(editor.isShowingAutocomplete(), false);

        editor.handleInput("\x1b[45;5u");
        assert.strictEqual(editor.getText(), "Work");
      }),
    ));
}

function showsMenuForceFileHas(): void {
  it("shows menu when force-file has multiple suggestions", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);

        const mockProvider: autocompleteTypes.AutocompleteProvider = {
          applyCompletion,
          getSuggestions: (lines, _cursorLine, cursorCol, options) => {
            if (options.force !== true) {
              return Promise.resolve(null);
            }
            const text = lines[0] || "";
            const prefix = text.slice(0, cursorCol);
            if (prefix === "src") {
              return Promise.resolve({
                items: [
                  { label: "src/", value: "src/" },
                  { label: "src.txt", value: "src.txt" },
                ],
                prefix: "src",
              });
            }
            return Promise.resolve(null);
          },
        };

        editor.setAutocompleteProvider(mockProvider);

        typeText(editor, "src");
        assert.strictEqual(editor.getText(), "src");

        editor.handleInput("\t");
        yield* flushAutocomplete;
        assert.strictEqual(editor.getText(), "src");
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("\t");
        assert.strictEqual(editor.getText(), "src/");
        assert.strictEqual(editor.isShowingAutocomplete(), false);
      }),
    ));
}

function keepsSuggestionsOpenTypingForce(): void {
  it("keeps suggestions open when typing in force mode (Tab-triggered)", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        const mockProvider = forceModeFileProvider();

        editor.setAutocompleteProvider(mockProvider);

        editor.handleInput("\t");
        yield* flushAutocomplete;
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("r");
        yield* flushAutocomplete;
        assert.strictEqual(editor.getText(), "r");
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("e");
        yield* flushAutocomplete;
        assert.strictEqual(editor.getText(), "re");
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("\t");
        assert.strictEqual(editor.getText(), "readme.md");
        assert.strictEqual(editor.isShowingAutocomplete(), false);
      }),
    ));
}

function forceModeFileProvider(): autocompleteTypes.AutocompleteProvider {
  const allFiles = [
    { label: "readme.md", value: "readme.md" },
    { label: "package.json", value: "package.json" },
    { label: "src/", value: "src/" },
    { label: "dist/", value: "dist/" },
  ];

  return {
    applyCompletion,
    getSuggestions: (lines, _cursorLine, cursorCol, options) => {
      const text = lines[0] || "";
      const prefix = text.slice(0, cursorCol);
      const shouldMatch = options.force || prefix.includes("/") || prefix.startsWith(".");
      if (!shouldMatch) {
        return Promise.resolve(null);
      }
      const filtered = allFiles.filter((f) =>
        f.value.toLowerCase().startsWith(prefix.toLowerCase()),
      );
      if (filtered.length > 0) {
        return Promise.resolve({ items: filtered, prefix });
      }
      return Promise.resolve(null);
    },
  };
}
