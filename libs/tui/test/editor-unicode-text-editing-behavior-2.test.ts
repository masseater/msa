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
    // Cursor at end

    // Move left over baz
    // Ctrl+Left
    editor.handleInput("\x1b[1;5D");
    // after '...'
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 11 });

    // Move left over punctuation
    // Ctrl+Left
    editor.handleInput("\x1b[1;5D");
    // after 'bar'
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    // Move left over bar
    // Ctrl+Left
    editor.handleInput("\x1b[1;5D");
    // after 'foo '
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });

    // Move right over bar
    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // at end of 'bar'
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    // Move right over punctuation run
    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // after '...'
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 10 });

    // Move right skips space and lands after baz
    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // end of line
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 14 });

    // Test forward from start with leading whitespace
    editor.setText("   foo bar");
    // Ctrl+A to go to start
    editor.handleInput("\x01");
    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // after 'foo'
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 6 });

    // ASCII punctuation inside Intl word-like segments preserves old boundaries
    editor.setText("foo.bar baz");
    // Ctrl+Left over baz
    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });
    // Ctrl+Left over bar
    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });
    // Ctrl+Left over .
    editor.handleInput("\x1b[1;5D");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    // Ctrl+A
    editor.handleInput("\x01");
    // Ctrl+Right over foo
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });
    // Ctrl+Right over .
    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 4 });
    // Ctrl+Right over bar
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

    // 你好，世界 = 你好(0-2) ，(2-3) 世界(3-5)
    editor.setText("你好，世界");
    // Cursor at end (col 5)

    // Move left over 世界
    // Ctrl+Left
    editor.handleInput("\x1b[1;5D");
    // after ，
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    // Move left over ，
    // Ctrl+Left
    editor.handleInput("\x1b[1;5D");
    // after 你好
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });

    // Move left over 你好
    // Ctrl+Left
    editor.handleInput("\x1b[1;5D");
    // start
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

    // Move right over 你好
    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // after 你好
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 });

    // Move right over ，
    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // after ，
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 3 });

    // Move right over 世界
    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // end
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

    // "hello你好，world世界" = hello(0-5) 你好(5-7) ，(7-8) world(8-13) 世界(13-15)
    editor.setText("hello你好，world世界");
    // Cursor at end (col 15)

    // Move left over 世界
    // Ctrl+Left
    editor.handleInput("\x1b[1;5D");
    // after 'world'
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 13 });

    // Move left over world
    // Ctrl+Left
    editor.handleInput("\x1b[1;5D");
    // after ，
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    // Move left over ，
    // Ctrl+Left
    editor.handleInput("\x1b[1;5D");
    // after 你好
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    // Move left over 你好
    // Ctrl+Left
    editor.handleInput("\x1b[1;5D");
    // after 'hello'
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    // Move left over hello
    // Ctrl+Left
    editor.handleInput("\x1b[1;5D");
    // start
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

    // Forward from start
    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // after 'hello'
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 5 });

    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // after 你好
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 7 });

    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // after ，
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 8 });

    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // after 'world'
    assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 13 });

    // Ctrl+Right
    editor.handleInput("\x1b[1;5C");
    // end
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
