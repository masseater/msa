import assert from "node:assert";
import { describe, it } from "node:test";

import Editor from "../src/components/editor.ts";
import editorHelpers from "./editor-helpers.ts";
import testThemes from "./test-themes.ts";

const { defaultEditorTheme } = testThemes;

const { createTestTUI } = editorHelpers;

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("cancels backward jump mode when Ctrl+Alt+] is pressed again", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      assert.deepStrictEqual(editor.getCursor(), { col: 11, line: 0 });

      editor.handleInput("\x1b\x1d");
      editor.handleInput("\x1b\x1d");

      editor.handleInput("o");
      assert.strictEqual(editor.getText(), "hello worldo");
    });

    it("searches for special characters", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("foo(bar) = baz;");
      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

      editor.handleInput("\x1d");
      editor.handleInput("(");

      assert.deepStrictEqual(editor.getCursor(), { col: 3, line: 0 });

      editor.handleInput("\x1d");
      editor.handleInput("=");

      assert.deepStrictEqual(editor.getCursor(), { col: 9, line: 0 });
    });
  });
});

describe("Editor component", () => {
  describe("Character jump (Ctrl+])", () => {
    it("handles empty text gracefully", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("");
      assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

      editor.handleInput("\x1d");
      editor.handleInput("x");

      assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });
    });

    it("resets lastAction when jumping", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01");

      editor.handleInput("x");
      assert.strictEqual(editor.getText(), "xhello world");

      editor.handleInput("\x1d");
      editor.handleInput("o");

      editor.handleInput("Y");
      assert.strictEqual(editor.getText(), "xhellYo world");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "xhello world");
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("preserves target column when moving up through a shorter line", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("2222222222x222\n\n1111111111_111111111111");

      assert.deepStrictEqual(editor.getCursor(), { col: 23, line: 2 });
      editor.handleInput("\x01");
      for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 2 });

      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 1 });

      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 0 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("preserves target column when moving down through a shorter line", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1111111111_111\n\n2222222222x222222222222");

      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x01");
      for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 0 });

      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 1 });

      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 2 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("resets sticky column on horizontal movement (left arrow)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1234567890\n\n1234567890");

      editor.handleInput("\x01");
      for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { col: 5, line: 2 });

      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { col: 5, line: 0 });

      editor.handleInput("\x1b[D");
      assert.deepStrictEqual(editor.getCursor(), { col: 4, line: 0 });

      editor.handleInput("\x1b[B");
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { col: 4, line: 2 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("resets sticky column on horizontal movement (right arrow)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1234567890\n\n1234567890");

      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x01");
      for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { col: 5, line: 0 });

      editor.handleInput("\x1b[B");
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { col: 5, line: 2 });

      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { col: 6, line: 2 });

      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { col: 6, line: 0 });
    });
  });
});
