import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";

import { Effect } from "effect";

import CombinedAutocompleteProvider from "../src/autocomplete.ts";
import type autocompleteTypes from "../src/autocomplete.types.ts";
import Editor from "../src/components/editor.ts";
import editorHelpers from "./editor-helpers.ts";
import testThemes from "./test-themes.ts";

const { defaultEditorTheme } = testThemes;

const { applyCompletion, createTestTUI, flushAutocomplete, typeText } = editorHelpers;

describe("Editor component", () => {
  describe("Autocomplete", () => {
    reQueriesAutocompletePickerCursor();
    hidesAutocompleteBackspacingSlashCommand();
    doesNotShowArgumentCompletions();
  });
});

function reQueriesAutocompletePickerCursor(): void {
  it("re-queries the autocomplete picker when the cursor moves back into the command name", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        editor.setAutocompleteProvider(commandArgumentProvider());

        for (const ch of "/cmd ") {
          editor.handleInput(ch);
          yield* flushAutocomplete;
        }
        assert.strictEqual(editor.getText(), "/cmd ");
        assert.strictEqual(editor.isShowingAutocomplete(), true);
        const atArg = editor
          .render(80)
          .map((l) => stripVTControlCharacters(l))
          .join("\n");
        assert.ok(atArg.includes("repo"), "argument menu should be visible at `/cmd `");

        editor.handleInput("\x1b[D");
        yield* flushAutocomplete;

        const afterMove = editor
          .render(80)
          .map((l) => stripVTControlCharacters(l))
          .join("\n");
        assert.ok(
          !afterMove.includes("repo"),
          "stale argument menu must not survive the cursor move",
        );
        assert.ok(
          !afterMove.includes("message"),
          "stale argument menu must not survive the cursor move",
        );
      }),
    ));
}

function hidesAutocompleteBackspacingSlashCommand(): void {
  it("hides autocomplete when backspacing slash command to empty", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);

        const mockProvider: autocompleteTypes.AutocompleteProvider = {
          applyCompletion,
          getSuggestions: (lines, _cursorLine, cursorCol) => {
            const text = lines[0] || "";
            const prefix = text.slice(0, cursorCol);
            if (prefix.startsWith("/")) {
              const commands = [
                { description: "Change model", label: "model", value: "/model" },
                { description: "Show help", label: "help", value: "/help" },
              ];
              const query = prefix.slice(1);
              const filtered = commands.filter((c) => c.value.startsWith(query));
              if (filtered.length > 0) {
                return Promise.resolve({ items: filtered, prefix });
              }
            }
            return Promise.resolve(null);
          },
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
}

function doesNotShowArgumentCompletions(): void {
  it("does not show argument completions when command has no argument completer", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        const provider = new CombinedAutocompleteProvider(
          [
            { description: "Show help", name: "help" },
            {
              description: "Switch model",
              getArgumentCompletions: () => [{ label: "claude-opus", value: "claude-opus" }],
              name: "model",
            },
          ],
          process.cwd(),
        );
        editor.setAutocompleteProvider(provider);

        typeText(editor, "/he");
        yield* flushAutocomplete;
        assert.strictEqual(editor.isShowingAutocomplete(), true);

        editor.handleInput("\t");
        assert.strictEqual(editor.getText(), "/help ");
        assert.strictEqual(editor.isShowingAutocomplete(), false);
      }),
    ));
}

function commandArgumentProvider(): autocompleteTypes.AutocompleteProvider {
  return {
    applyCompletion,
    getSuggestions: (lines, _cursorLine, cursorCol) => {
      const before = (lines[0] || "").slice(0, cursorCol);
      if (!before.startsWith("/")) return Promise.resolve(null);
      if (before.includes(" ")) {
        return Promise.resolve({
          items: [
            { label: "repo", value: "repo" },
            { label: "message", value: "message" },
            { label: "help", value: "help" },
          ],
          prefix: before.slice(before.indexOf(" ") + 1),
        });
      }
      return Promise.resolve({ items: [{ label: "cmd", value: "cmd" }], prefix: before });
    },
  };
}
