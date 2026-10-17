import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Undo", () => {
    it("does nothing when undo stack is empty", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");
    });

    it("coalesces consecutive word characters into one undo unit", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      typeText(editor, "hello world");
      assert.strictEqual(editor.getText(), "hello world");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes spaces one at a time", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      typeText(editor, "hello  ");
      assert.strictEqual(editor.getText(), "hello  ");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello ");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes newlines and signals next word to capture state", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      typeText(editor, "hello");
      editor.handleInput("\n");
      typeText(editor, "world");
      assert.strictEqual(editor.getText(), "hello\nworld");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello\n");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes backspace", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      typeText(editor, "hello");
      editor.handleInput("\x7f");
      assert.strictEqual(editor.getText(), "hell");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");
    });

    it("undoes forward delete", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      typeText(editor, "hello");
      editor.handleInput("\x01");
      editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[3~");
      assert.strictEqual(editor.getText(), "hllo");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes Ctrl+W (delete word backward)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      typeText(editor, "hello world");
      assert.strictEqual(editor.getText(), "hello world");

      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "hello ");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello world");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes Ctrl+K (delete to line end)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      typeText(editor, "hello world");
      editor.handleInput("\x01");
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      editor.handleInput("\x0b");
      assert.strictEqual(editor.getText(), "hello ");

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

      typeText(editor, "hello world");
      editor.handleInput("\x01");
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "world");

      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello world");
    });
  });
});
