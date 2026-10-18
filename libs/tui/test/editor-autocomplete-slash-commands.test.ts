import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";

import { Effect } from "effect";

import { CombinedAutocompleteProvider, type AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

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
}

function doesNotShowArgumentCompletions(): void {
  it("does not show argument completions when command has no argument completer", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        const provider = new CombinedAutocompleteProvider(
          [
            { name: "help", description: "Show help" },
            {
              name: "model",
              description: "Switch model",
              getArgumentCompletions: () => [{ value: "claude-opus", label: "claude-opus" }],
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

function commandArgumentProvider(): AutocompleteProvider {
  return {
    getSuggestions: (lines, _cursorLine, cursorCol) => {
      const before = (lines[0] || "").slice(0, cursorCol);
      if (!before.startsWith("/")) return Promise.resolve(null);
      if (before.includes(" ")) {
        return Promise.resolve({
          items: [
            { value: "repo", label: "repo" },
            { value: "message", label: "message" },
            { value: "help", label: "help" },
          ],
          prefix: before.slice(before.indexOf(" ") + 1),
        });
      }
      return Promise.resolve({ items: [{ value: "cmd", label: "cmd" }], prefix: before });
    },
    applyCompletion,
  };
}
