import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Undo", () => {
    it("does nothing when undo stack is empty", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");
    });

    it("coalesces consecutive word characters into one undo unit", () => {
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

      // Undo removes " world" (space captured state before it, so we restore to "hello")
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");

      // Undo removes "hello"
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes spaces one at a time", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("h");
      editor.handleInput("e");
      editor.handleInput("l");
      editor.handleInput("l");
      editor.handleInput("o");
      editor.handleInput(" ");
      editor.handleInput(" ");
      assert.strictEqual(editor.getText(), "hello  ");

      // Ctrl+- (undo) - removes second " "
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello ");

      // Ctrl+- (undo) - removes first " "
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");

      // Ctrl+- (undo) - removes "hello"
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes newlines and signals next word to capture state", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("h");
      editor.handleInput("e");
      editor.handleInput("l");
      editor.handleInput("l");
      editor.handleInput("o");
      editor.handleInput("\n");
      editor.handleInput("w");
      editor.handleInput("o");
      editor.handleInput("r");
      editor.handleInput("l");
      editor.handleInput("d");
      assert.strictEqual(editor.getText(), "hello\nworld");

      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello\n");

      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");

      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes backspace", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("h");
      editor.handleInput("e");
      editor.handleInput("l");
      editor.handleInput("l");
      editor.handleInput("o");
      // Backspace
      editor.handleInput("\x7f");
      assert.strictEqual(editor.getText(), "hell");

      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");
    });

    it("undoes forward delete", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("h");
      editor.handleInput("e");
      editor.handleInput("l");
      editor.handleInput("l");
      editor.handleInput("o");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      // Right arrow
      editor.handleInput("\x1b[C");
      // Delete key
      editor.handleInput("\x1b[3~");
      assert.strictEqual(editor.getText(), "hllo");

      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes Ctrl+W (delete word backward)", () => {
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

      // Ctrl+W
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "hello ");

      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello world");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes Ctrl+K (delete to line end)", () => {
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
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      // Move right 6 times
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      // Ctrl+K
      editor.handleInput("\x0b");
      assert.strictEqual(editor.getText(), "hello ");

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
    it("undoes Ctrl+U (delete to line start)", () => {
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
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      // Move right 6 times
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      // Ctrl+U
      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "world");

      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello world");
    });
  });
});
