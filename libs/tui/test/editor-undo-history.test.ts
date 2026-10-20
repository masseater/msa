import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import type { AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import editorHelpers from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

const { applyCompletion, createTestTUI, flushAutocomplete, typeText } = editorHelpers;

describe("Editor component", () => {
  describe("Undo", () => {
    clearsUndoStackSubmit();
    exitsHistoryBrowsingModeUndo();
    undoRestoresPreHistoryState();
    undoesAutocomplete();
  });
});

function clearsUndoStackSubmit(): void {
  it("clears undo stack on submit", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    let submitted = "";
    editor.onSubmit = (text) => {
      submitted = text;
    };

    typeText(editor, "hello");
    editor.handleInput("\r");

    assert.strictEqual(submitted, "hello");
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "");
  });
}

function exitsHistoryBrowsingModeUndo(): void {
  it("exits history browsing mode on undo", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.addToHistory("hello");
    assert.strictEqual(editor.getText(), "");

    typeText(editor, "world");
    assert.strictEqual(editor.getText(), "world");

    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "hello");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "world");
  });
}

function undoRestoresPreHistoryState(): void {
  it("undo restores to pre-history state even after multiple history navigations", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.addToHistory("first");
    editor.addToHistory("second");
    editor.addToHistory("third");

    typeText(editor, "current");
    assert.strictEqual(editor.getText(), "current");

    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "third");
    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "second");
    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "first");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "current");
  });
}

function undoesAutocomplete(): void {
  it("undoes autocomplete", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);

        const mockProvider: AutocompleteProvider = {
          applyCompletion,
          getSuggestions: (lines, _cursorLine, cursorCol) => {
            const text = lines[0] || "";
            const prefix = text.slice(0, cursorCol);
            if (prefix === "di") {
              return Promise.resolve({
                items: [{ label: "dist/", value: "dist/" }],
                prefix: "di",
              });
            }
            return Promise.resolve(null);
          },
        };

        editor.setAutocompleteProvider(mockProvider);

        editor.handleInput("d");
        editor.handleInput("i");
        assert.strictEqual(editor.getText(), "di");

        editor.handleInput("\t");
        yield* flushAutocomplete;
        assert.strictEqual(editor.getText(), "dist/");
        assert.strictEqual(editor.isShowingAutocomplete(), false);

        editor.handleInput("\x1b[45;5u");
        assert.strictEqual(editor.getText(), "di");
      }),
    ));
}
