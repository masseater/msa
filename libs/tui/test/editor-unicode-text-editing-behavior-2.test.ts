import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Unicode text editing behavior", () => {
    unicodeTextEditingBehaviorCases2();
  });
});

function unicodeTextEditingBehaviorCases2(): void {
  it("navigates words correctly with Ctrl+Left/Right", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("foo bar... baz");

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 14 });

    editor.setText("   foo bar");
    editor.handleInput("\x01");
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });

    editor.setText("foo.bar baz");
    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });
    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });
    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    editor.handleInput("\x01");
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });
  });
}

describe("Editor component", () => {
  describe("Unicode text editing behavior", () => {
    unicodeTextEditingBehaviorCases3();
  });
});

function unicodeTextEditingBehaviorCases3(): void {
  it("stops at fullwidth Chinese punctuation (issue #4972)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("你好，世界");

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });
  });
}

describe("Editor component", () => {
  describe("Unicode text editing behavior", () => {
    unicodeTextEditingBehaviorCases4();
  });
});

function unicodeTextEditingBehaviorCases4(): void {
  it("handles mixed CJK and ASCII word movement", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("hello你好，world世界");

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 13 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 13 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 15 });
  });
}

describe("Editor component", () => {
  describe("Scroll indicators", () => {
    it("centers scroll indicators on wide borders", () => {
      const width = 40;
      const editor = new Editor(createTestTUI(width), defaultEditorTheme);
      editor.setText(Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n"));

      editor.render(width);
      for (let index = 0; index < 10; index++) editor.handleInput("\x1b[A");

      const lines = editor.render(width);
      assert.strictEqual(
        stripVTControlCharacters(lines[0]!),
        `${"─".repeat(15)} ↑ 9 more ${"─".repeat(15)}`,
      );
      assert.strictEqual(
        stripVTControlCharacters(lines.at(-1)!),
        `${"─".repeat(15)} ↓ 4 more ${"─".repeat(15)}`,
      );
    });
  });
});
