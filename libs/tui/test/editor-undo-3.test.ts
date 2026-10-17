import assert from "node:assert";
import { describe, it } from "node:test";

import { type AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, flushAutocomplete } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Undo", () => {
    it("exits history browsing mode on undo", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Add "hello" to history
      editor.addToHistory("hello");
      assert.strictEqual(editor.getText(), "");

      // Type "world"
      editor.handleInput("w");
      editor.handleInput("o");
      editor.handleInput("r");
      editor.handleInput("l");
      editor.handleInput("d");
      assert.strictEqual(editor.getText(), "world");

      // Ctrl+W - delete word
      // Ctrl+W
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "");

      // Press Up - enter history browsing, shows "hello"
      // Up arrow
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "hello");

      // Undo should restore to "" (state before entering history browsing)
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");

      // Undo again should restore to "world" (state before Ctrl+W)
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "world");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    undoCases5();
  });
});

function undoCases5(): void {
  it("undo restores to pre-history state even after multiple history navigations", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    // Add history entries
    editor.addToHistory("first");
    editor.addToHistory("second");
    editor.addToHistory("third");

    // Type something
    editor.handleInput("c");
    editor.handleInput("u");
    editor.handleInput("r");
    editor.handleInput("r");
    editor.handleInput("e");
    editor.handleInput("n");
    editor.handleInput("t");
    assert.strictEqual(editor.getText(), "current");

    // Clear editor
    // Ctrl+W
    editor.handleInput("\x17");
    assert.strictEqual(editor.getText(), "");

    // Navigate through history multiple times
    // Up - "third"
    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "third");
    // Up - "second"
    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "second");
    // Up - "first"
    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getText(), "first");

    // Undo should go back to "" (state before we started browsing), not intermediate states
    // Ctrl+- (undo)
    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "");

    // Another undo goes back to "current"
    // Ctrl+- (undo)
    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "current");
  });
}

describe("Editor component", () => {
  describe("Undo", () => {
    it("cursor movement starts new undo unit", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("h");
      editor.handleInput("e");
      editor.handleInput("l");
      editor.handleInput("l");
      editor.handleInput("o");
      editor.handleInput(" ");
      editor.handleInput("w");
      editor.handleInput("o");
      editor.handleInput("r");
      editor.handleInput("l");
      editor.handleInput("d");
      assert.strictEqual(editor.getText(), "hello world");

      // Move cursor left 5 (to after "hello ")
      for (let i = 0; i < 5; i++) editor.handleInput("\x1b[D");

      // Type "lol" in the middle
      editor.handleInput("l");
      editor.handleInput("o");
      editor.handleInput("l");
      assert.strictEqual(editor.getText(), "hello lolworld");

      // Undo should restore to "hello world" (before inserting "lol")
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello world");

      editor.handleInput("|");
      assert.strictEqual(editor.getText(), "hello |world");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("no-op delete operations do not push undo snapshots", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("h");
      editor.handleInput("e");
      editor.handleInput("l");
      editor.handleInput("l");
      editor.handleInput("o");
      assert.strictEqual(editor.getText(), "hello");

      // Delete word on empty - multiple times (should be no-ops)
      // Ctrl+W - deletes "hello"
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "");
      // Ctrl+W - no-op (nothing to delete)
      editor.handleInput("\x17");
      // Ctrl+W - no-op
      editor.handleInput("\x17");

      // Single undo should restore "hello"
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes autocomplete", async () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Create a mock autocomplete provider
      const mockProvider: AutocompleteProvider = {
        getSuggestions: (lines, _cursorLine, cursorCol) => {
          const text = lines[0] || "";
          const prefix = text.slice(0, cursorCol);
          if (prefix === "di") {
            return Promise.resolve({
              items: [{ value: "dist/", label: "dist/" }],
              prefix: "di",
            });
          }
          return Promise.resolve(null);
        },
        applyCompletion,
      };

      editor.setAutocompleteProvider(mockProvider);

      // Type "di"
      editor.handleInput("d");
      editor.handleInput("i");
      assert.strictEqual(editor.getText(), "di");

      // Press Tab to trigger autocomplete
      editor.handleInput("\t");
      await flushAutocomplete();
      assert.strictEqual(editor.getText(), "dist/");
      assert.strictEqual(editor.isShowingAutocomplete(), false);

      // Undo should restore to "di"
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "di");
    });
  });
});
