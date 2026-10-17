import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI, pasteWithMarker, positionCursor } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Sticky column", () => {
    stickyColumnCases18();
  });
});

function stickyColumnCases18(): void {
  it("handles editor resizes when preferredVisualCol is on a different line", () => {
    const tui = createTestTUI(80);
    const editor = new Editor(tui, defaultEditorTheme);

    editor.setText("short\n12345678901234567890");

    editor.handleInput("\x01");
    for (let i = 0; i < 15; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 15 });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    editor.render(10);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    editor.render(80);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 15 });
  });
}

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("rewrapped lines: target fits current visual column", () => {
      const tui = createTestTUI(80);
      const editor = new Editor(tui, defaultEditorTheme);
      editor.setText("abcdefghijklmnopqr\n123456789012345678");

      positionCursor(editor, 0, 18);
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 18 });

      editor.render(10);

      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

      editor.render(80);
      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });
    });
  });
});

describe("Editor component", () => {
  describe("Sticky column", () => {
    it("rewrapped lines: target shorter than current visual column", () => {
      const tui = createTestTUI(80);
      const editor = new Editor(tui, defaultEditorTheme);
      editor.setText("abcdefghijklmnopqr\n123456789012345678\nab");

      positionCursor(editor, 0, 18);
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 18 });

      editor.render(10);
      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });

      editor.render(80);

      editor.handleInput("\x1b[B");
      assert.deepStrictEqual(editor.getCursor(), { line: 2, col: 2 });

      editor.handleInput("\x1b[A");
      assert.deepStrictEqual(editor.getCursor(), { line: 1, col: 8 });
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("creates a paste marker for large pastes", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const text = pasteWithMarker(editor);
      assert.match(text, /\[paste #\d+ \+\d+ lines\]/u);
    });

    it("treats paste marker as single unit for right arrow", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.handleInput("A");
      pasteWithMarker(editor);
      editor.handleInput("B");

      editor.handleInput("\x01");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });

      editor.handleInput("\x1b[C");
      const marker = editor.getText().match(/\[paste #\d+ \+\d+ lines\]/u)![0];
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length });

      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length + 1 });
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("treats paste marker as single unit for left arrow", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.handleInput("A");
      pasteWithMarker(editor);
      editor.handleInput("B");

      editor.handleInput("\x1b[D");
      const text = editor.getText();
      const marker = text.match(/\[paste #\d+ \+\d+ lines\]/u)![0];
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length });

      editor.handleInput("\x1b[D");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });

      editor.handleInput("\x1b[D");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("treats paste marker as single unit for backspace", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.handleInput("A");
      pasteWithMarker(editor);
      editor.handleInput("B");

      const text = editor.getText();
      const marker = text.match(/\[paste #\d+ \+\d+ lines\]/u)![0];

      editor.handleInput("\x01");
      editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 + marker.length });

      editor.handleInput("\x7f");
      assert.strictEqual(editor.getText(), "AB");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("treats paste marker as single unit for forward delete", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.handleInput("A");
      pasteWithMarker(editor);
      editor.handleInput("B");

      editor.handleInput("\x01");
      editor.handleInput("\x1b[C");

      editor.handleInput("\x1b[3~");
      assert.strictEqual(editor.getText(), "AB");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });
    });
  });
});
