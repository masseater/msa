import assert from "node:assert";
import { describe, it } from "node:test";

import { CombinedAutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { createTestTUI, flushAutocomplete, typeText } from "./editor-helpers.ts";
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

      typeText(editor, "/he");
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
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d");
      editor.handleInput("o");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });
    });

    it("jumps forward to next occurrence after cursor", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01");
      for (let i = 0; i < 4; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });

      editor.handleInput("\x1d");
      editor.handleInput("o");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });
    });
  });
});

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("jumps forward across multiple lines", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("abc\ndef\nghi");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d");
      editor.handleInput("g");

      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 0 });
    });

    it("jumps backward to first occurrence before cursor on same line", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

      editor.handleInput("\x1b\x1d");
      editor.handleInput("o");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });
    });
  });
});

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("jumps backward across multiple lines", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("abc\ndef\nghi");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 3 });

      editor.handleInput("\x1b\x1d");
      editor.handleInput("a");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });

    it("does nothing when character is not found (forward)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d");
      editor.handleInput("z");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });
  });
});

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("does nothing when character is not found (backward)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

      editor.handleInput("\x1b\x1d");
      editor.handleInput("z");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });
    });

    it("is case-sensitive", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("Hello World");
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d");
      editor.handleInput("h");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d");
      editor.handleInput("W");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });
    });
  });
});

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("cancels jump mode when Ctrl+] is pressed again", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d");
      editor.handleInput("\x1d");

      editor.handleInput("o");
      assert.strictEqual(editor.getText(), "ohello world");
    });

    it("cancels jump mode on Escape and processes the Escape", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1d");
      editor.handleInput("\x1b");

      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("o");
      assert.strictEqual(editor.getText(), "ohello world");
    });
  });
});
