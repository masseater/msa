import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Sticky column", () => {
    stickyColumnCases17();
  });
});

function stickyColumnCases17(): void {
  it("resets sticky column on undo", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("1234567890\n\n1234567890");

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    editor.handleInput("\x1b[B");
    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 8 });

    editor.handleInput("X");
    assert.strictEqual(editor.getText(), "1234567890\n\n12345678X90");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 9 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 9 });

    editor.handleInput("\x1b[45;5u");
    assert.strictEqual(editor.getText(), "1234567890\n\n1234567890");
    assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 8 });

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });
  });
}

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("handles multiple consecutive up/down movements", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1234567890\nab\ncd\nef\n1234567890");

      editor.handleInput("\x01");
      for (let i = 0; i < 7; i++) editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 4, col: 7 });

      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

      editor.handleInput("\x1b[B");
      editor.handleInput("\x1b[B");
      editor.handleInput("\x1b[B");
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 4, col: 7 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("moves correctly through wrapped visual lines without getting stuck", () => {
      const tui = createTestTUI(15);
      const editor = new Editor(tui, defaultEditorTheme);

      editor.setText("short\n123456789012345678901234567890");
      editor.render(15);

      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 30 });

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getCursor().line, 1);

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getCursor().line, 1);

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getCursor().line, 0);
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("handles setText resetting sticky column", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("1234567890\n\n1234567890");

      editor.handleInput("\x01");
      for (let i = 0; i < 8; i++) editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[A");

      editor.setText("abcdefghij\n\nabcdefghij");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("sets preferredVisualCol when pressing right at end of prompt (last line)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("111111111x1111111111\n\n333333333_");

      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x05");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 20 });

      editor.handleInput("\x1b[B");
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 10 });

      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("handles editor resizes when preferredVisualCol is on the same line", () => {
      const tui = createTestTUI(80);
      const editor = new Editor(tui, defaultEditorTheme);

      editor.setText("12345678901234567890\n\n12345678901234567890");

      editor.handleInput("\x01");
      for (let i = 0; i < 15; i++) editor.handleInput("\x1b[C");

      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 15 });

      editor.render(12);

      editor.handleInput("\x1b[B");
      editor.handleInput("\x1b[B");
      assert.equal(editor.getCursor().col, 4);
    });
  });
});
