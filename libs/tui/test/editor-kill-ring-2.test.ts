import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("consecutive deletions across lines coalesce into one entry", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1\n2\n3");
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "1\n2\n");

      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "1\n2");

      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "1\n");

      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "1");

      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "1\n2\n3");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("Ctrl+K at line end deletes newline and coalesces", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("");
      editor.handleInput("a");
      editor.handleInput("b");
      editor.handleInput("\n");
      editor.handleInput("c");
      editor.handleInput("d");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x05");

      editor.handleInput("\x0b");
      assert.strictEqual(editor.getText(), "abcd");

      editor.handleInput("\x0b");
      assert.strictEqual(editor.getText(), "ab");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "ab\ncd");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("handles yank in middle of text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("word");
      editor.handleInput("\x17");
      editor.setText("hello world");

      editor.handleInput("\x01");
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello wordworld");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("handles yank-pop in middle of text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("FIRST");
      editor.handleInput("\x17");
      editor.setText("SECOND");
      editor.handleInput("\x17");

      editor.setText("hello world");
      editor.handleInput("\x01");
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello SECONDworld");

      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "hello FIRSTworld");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("multiline yank and yank-pop in middle of text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("SINGLE");
      editor.handleInput("\x17");

      editor.setText("A\nB");
      editor.handleInput("\x15");
      editor.handleInput("\x15");
      editor.handleInput("\x15");

      editor.setText("hello world");
      editor.handleInput("\x01");
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello A\nBworld");

      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "hello SINGLEworld");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("Alt+D deletes word forward and saves to kill ring", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world test");
      editor.handleInput("\x01");

      editor.handleInput("\x1bd");
      assert.strictEqual(editor.getText(), " world test");

      editor.handleInput("\x1bd");
      assert.strictEqual(editor.getText(), " test");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello world test");
    });

    it("Alt+D at end of line deletes newline", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("line1\nline2");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x05");

      editor.handleInput("\x1bd");
      assert.strictEqual(editor.getText(), "line1line2");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "line1\nline2");
    });
  });
});
