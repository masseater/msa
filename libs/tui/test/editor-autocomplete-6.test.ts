import assert from "node:assert";
import { describe, it } from "node:test";

import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI, flushAutocomplete } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Autocomplete", () => {
    it("does not show argument completions when command has no argument completer", async () => {
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

      editor.handleInput("/");
      editor.handleInput("h");
      editor.handleInput("e");
      await flushAutocomplete();
      assert.strictEqual(editor.isShowingAutocomplete(), true);

      editor.handleInput("\t");
      assert.strictEqual(editor.getText(), "/help ");
      assert.strictEqual(editor.isShowingAutocomplete(), false);
    });
  });
});

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("jumps forward to first occurrence of character on same line", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Ctrl+] (legacy sequence for ctrl+])
      editor.handleInput("\x1d");
      // Jump to first 'o'
      editor.handleInput("o");

      // 'o' in "hello"
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });
    });

    it("jumps forward to next occurrence after cursor", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      // Move cursor to the 'o' in "hello" (col 4)
      for (let i = 0; i < 4; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });

      // Ctrl+]
      editor.handleInput("\x1d");
      // Jump to next 'o' (in "world")
      editor.handleInput("o");

      // 'o' in "world"
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });
    });
  });
});

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("jumps forward across multiple lines", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("abc\ndef\nghi");
      // Cursor is at end (line 2, col 3). Move to line 0 via up arrows, then Ctrl+A
      // Up
      editor.handleInput("\x1b[A");
      // Up - now on line 0
      editor.handleInput("\x1b[A");
      // Ctrl+A - go to start of line
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Ctrl+]
      editor.handleInput("\x1d");
      // Jump to 'g' on line 3
      editor.handleInput("g");

      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 0 });
    });

    it("jumps backward to first occurrence before cursor on same line", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Cursor at end (col 11)
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

      // Ctrl+Alt+] (ESC followed by Ctrl+])
      editor.handleInput("\x1b\x1d");
      // Jump to last 'o' before cursor
      editor.handleInput("o");

      // 'o' in "world"
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });
    });
  });
});

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("jumps backward across multiple lines", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("abc\ndef\nghi");
      // Cursor at end of line 3
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 3 });

      // Ctrl+Alt+]
      editor.handleInput("\x1b\x1d");
      // Jump to 'a' on line 1
      editor.handleInput("a");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });

    it("does nothing when character is not found (forward)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Ctrl+]
      editor.handleInput("\x1d");
      // 'z' doesn't exist
      editor.handleInput("z");

      // Cursor unchanged
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });
  });
});

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("does nothing when character is not found (backward)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Cursor at end
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

      // Ctrl+Alt+]
      editor.handleInput("\x1b\x1d");
      // 'z' doesn't exist
      editor.handleInput("z");

      // Cursor unchanged
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });
    });

    it("is case-sensitive", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("Hello World");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Search for lowercase 'h' - should not find it (only 'H' exists)
      // Ctrl+]
      editor.handleInput("\x1d");
      editor.handleInput("h");

      // Cursor unchanged
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Search for uppercase 'W' - should find it
      // Ctrl+]
      editor.handleInput("\x1d");
      editor.handleInput("W");

      // 'W' in "World"
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });
    });
  });
});

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("cancels jump mode when Ctrl+] is pressed again", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Ctrl+] - enter jump mode
      editor.handleInput("\x1d");
      // Ctrl+] again - cancel
      editor.handleInput("\x1d");

      // Type 'o' normally - should insert, not jump
      editor.handleInput("o");
      assert.strictEqual(editor.getText(), "ohello world");
    });

    it("cancels jump mode on Escape and processes the Escape", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Ctrl+] - enter jump mode
      editor.handleInput("\x1d");
      // Escape - cancel jump mode
      editor.handleInput("\x1b");

      // Cursor should be unchanged (Escape itself doesn't move cursor in editor)
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Type 'o' normally - should insert, not jump
      editor.handleInput("o");
      assert.strictEqual(editor.getText(), "ohello world");
    });
  });
});
