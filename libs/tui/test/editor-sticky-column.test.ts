import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("resets sticky column on typing", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1234567890\n\n1234567890");

      // Start at line 2, col 8
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");

      // Move up through empty line
      // Up
      editor.handleInput("\x1b[A");
      // Up - line 0, col 8
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

      // Type a character - resets sticky column
      editor.handleInput("X");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 9 });

      // Move down twice
      // Down - line 1, col 0
      editor.handleInput("\x1b[B");
      // Down - line 2, col 9 (new sticky from col 9)
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 9 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("resets sticky column on backspace", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1234567890\n\n1234567890");

      // Start at line 2, col 8
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");

      // Move up through empty line
      // Up
      editor.handleInput("\x1b[A");
      // Up - line 0, col 8
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

      // Backspace - resets sticky column
      // Backspace
      editor.handleInput("\x7f");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

      // Move down twice
      // Down - line 1, col 0
      editor.handleInput("\x1b[B");
      // Down - line 2, col 7 (new sticky from col 7)
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 7 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("resets sticky column on Ctrl+A (move to line start)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1234567890\n\n1234567890");

      // Start at line 2, col 8
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");

      // Move up - establishes sticky col 8
      // Up - line 1, col 0
      editor.handleInput("\x1b[A");

      // Ctrl+A - resets sticky column to 0
      // Ctrl+A
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 0 });

      // Move up
      // Up - line 0, col 0 (new sticky from col 0)
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("resets sticky column on Ctrl+E (move to line end)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("12345\n\n1234567890");

      // Start at line 2, col 3
      // Ctrl+A
      editor.handleInput("\x01");
      for (let i = 0; i < 3; i++) editor.handleInput("\x1b[C");

      // Move up through empty line - establishes sticky col 3
      // Up - line 1, col 0
      editor.handleInput("\x1b[A");
      // Up - line 0, col 3
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

      // Ctrl+E - resets sticky column to end
      // Ctrl+E
      editor.handleInput("\x05");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

      // Move down twice
      // Down - line 1, col 0
      editor.handleInput("\x1b[B");
      // Down - line 2, col 5 (new sticky from col 5)
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("resets sticky column on word movement (Ctrl+Left)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world\n\nhello world");

      // Start at end of line 2 (col 11)
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 11 });

      // Move up through empty line - establishes sticky col 11
      // Up - line 1, col 0
      editor.handleInput("\x1b[A");
      // Up - line 0, col 11
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

      // Ctrl+Left - word movement resets sticky column
      // Ctrl+Left
      editor.handleInput("\x1b[1;5D");
      // Before "world"
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });

      // Move down twice
      // Down - line 1, col 0
      editor.handleInput("\x1b[B");
      // Down - line 2, col 6 (new sticky from col 6)
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 6 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("resets sticky column on word movement (Ctrl+Right)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world\n\nhello world");

      // Start at line 0, col 0
      // Up
      editor.handleInput("\x1b[A");
      // Up
      editor.handleInput("\x1b[A");
      // Ctrl+A
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Move down through empty line - establishes sticky col 0
      // Down - line 1, col 0
      editor.handleInput("\x1b[B");
      // Down - line 2, col 0
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 0 });

      // Ctrl+Right - word movement resets sticky column
      // Ctrl+Right
      editor.handleInput("\x1b[1;5C");
      // After "hello"
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 5 });

      // Move up twice
      // Up - line 1, col 0
      editor.handleInput("\x1b[A");
      // Up - line 0, col 5 (new sticky from col 5)
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });
    });
  });
});
