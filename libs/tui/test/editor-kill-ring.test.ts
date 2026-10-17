import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("Alt+Y does nothing if not preceded by yank", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("test");
      editor.handleInput("\x17");
      editor.setText("other");

      editor.handleInput("x");
      assert.strictEqual(editor.getText(), "otherx");

      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "otherx");
    });

    it("Alt+Y does nothing if kill ring has ≤1 entry", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("only");
      editor.handleInput("\x17");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "only");

      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "only");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("consecutive Ctrl+W accumulates into one kill ring entry", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("one two three");
      editor.handleInput("\x17");
      editor.handleInput("\x17");
      editor.handleInput("\x17");

      assert.strictEqual(editor.getText(), "");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "one two three");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("Ctrl+U accumulates multiline deletes including newlines", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("line1\nline2\nline3");

      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "line1\nline2\n");

      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "line1\nline2");

      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "line1\n");

      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "line1");

      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "line1\nline2\nline3");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("backward deletions prepend, forward deletions append during accumulation", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("prefix|suffix");
      editor.handleInput("\x01");
      for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");

      editor.handleInput("\x0b");
      editor.handleInput("\x0b");
      assert.strictEqual(editor.getText(), "prefix");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "prefix|suffix");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("non-delete actions break kill accumulation", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("foo bar baz");
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "foo bar ");

      editor.handleInput("x");
      assert.strictEqual(editor.getText(), "foo bar x");

      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "foo bar ");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "foo bar x");

      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "foo bar baz");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("non-yank actions break Alt+Y chain", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("first");
      editor.handleInput("\x17");
      editor.setText("second");
      editor.handleInput("\x17");
      editor.setText("");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "second");

      editor.handleInput("x");
      assert.strictEqual(editor.getText(), "secondx");

      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "secondx");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("kill ring rotation persists after cycling", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("first");
      editor.handleInput("\x17");
      editor.setText("second");
      editor.handleInput("\x17");
      editor.setText("third");
      editor.handleInput("\x17");
      editor.setText("");

      editor.handleInput("\x19");
      editor.handleInput("\x1by");

      assert.strictEqual(editor.getText(), "second");

      editor.handleInput("x");
      editor.setText("");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "second");
    });
  });
});
