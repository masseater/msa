import assert from "node:assert";
import { describe, it } from "node:test";

import Editor from "../src/components/editor.ts";
import utils from "../src/utils.ts";
import editorHelpers from "./editor-helpers.ts";
import testThemes from "./test-themes.ts";

const { defaultEditorTheme } = testThemes;
const { visibleWidth } = utils;

const { createTestTUI } = editorHelpers;

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    doesNotCrashTextPaste();
    wordwraplineReChecksOverflowAfter();
    snapsPasteMarkerStartNavigating();
    preservesStickyColumnNavigatingThrough();
    doesNotGetStuckMoving();
    skipsMarkerContinuationVLsPreferred();
  });
});

function doesNotCrashTextPaste(): void {
  it("does not crash when text + paste marker exceeds terminal width with cursor on marker", () => {
    const tui = createTestTUI();
    const editor = new Editor(tui, defaultEditorTheme);

    for (let i = 0; i < 35; i++) editor.handleInput("b");

    const bigContent = "line\n".repeat(27).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);

    for (let i = 0; i < 4; i++) editor.handleInput("b");

    editor.handleInput("\x1b[D");
    editor.handleInput("\x1b[D");
    editor.handleInput("\x1b[D");
    editor.handleInput("\x1b[D");
    editor.handleInput("\x1b[D");

    const renderWidth = 54;
    const lines = editor.render(renderWidth);
    for (const line of lines) {
      assert.ok(
        visibleWidth(line) <= renderWidth,
        `line exceeds width ${renderWidth}: visible=${visibleWidth(line)} text=${JSON.stringify(line)}`,
      );
    }
  });
}

function wordwraplineReChecksOverflowAfter(): void {
  it("wordWrapLine re-checks overflow after backtracking to wrap opportunity", () => {
    const tui = createTestTUI();
    const editor = new Editor(tui, defaultEditorTheme);

    editor.handleInput(" ");
    for (let i = 0; i < 35; i++) editor.handleInput("b");

    const bigContent = "line\n".repeat(27).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);

    for (let i = 0; i < 4; i++) editor.handleInput("b");

    const renderWidth = 54;
    const lines = editor.render(renderWidth);
    for (const line of lines) {
      assert.ok(
        visibleWidth(line) <= renderWidth,
        `line exceeds width ${renderWidth}: visible=${visibleWidth(line)} text=${JSON.stringify(line)}`,
      );
    }
  });
}

function snapsPasteMarkerStartNavigating(): void {
  it("snaps to the paste marker start when navigating down into it", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("12345678901234567890\n\nhello ");

    const bigContent = "x".repeat(2000);
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
    editor.render(80);

    const text = editor.getText();
    assert.match(text, /\[paste #\d+ \d+ chars\]/u);

    editor.handleInput("\x1b[A");
    editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 0 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 1 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 6, line: 2 });
  });
}

function preservesStickyColumnNavigatingThrough(): void {
  it("preserves sticky column when navigating through paste marker line", () => {
    const tui = createTestTUI(30);
    const editor = new Editor(tui, defaultEditorTheme);

    for (const ch of "1234567890123456") editor.handleInput(ch);
    editor.handleInput("\n");
    editor.handleInput("\n");
    editor.handleInput(`\x1b[200~${"x".repeat(2000)}\x1b[201~`);
    editor.handleInput("\n");
    editor.handleInput("\n");
    for (const ch of "abcdefghijklmnop") editor.handleInput(ch);
    editor.render(30);

    for (let i = 0; i < 4; i++) editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    for (let i = 0; i < 10; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 0 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 1 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 2 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 3 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 10, line: 4 });
  });
}

function doesNotGetStuckMoving(): void {
  it("does not get stuck moving down from a multi-visual-line paste marker", () => {
    const tui = createTestTUI(20);
    const editor = new Editor(tui, defaultEditorTheme);

    for (const ch of "abcdefgh") editor.handleInput(ch);
    const bigContent = "line\n".repeat(100).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
    for (const ch of "ijklmnopqr") editor.handleInput(ch);
    editor.handleInput("\n");
    for (const ch of "123456789012345678") editor.handleInput(ch);
    editor.render(20);

    const text = editor.getText();
    const markerMatch = text.match(/\[paste #\d+ \+\d+ lines\]/u);
    assert.ok(markerMatch, "paste marker should be created");
    const markerLen = markerMatch[0].length;
    assert.ok(markerLen > 20, "marker should be wider than terminal");
    const markerStart = 8;
    const markerEnd = markerStart + markerLen;

    editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    for (let i = 0; i < 6; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: 6, line: 0 });

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: markerStart, line: 0 });

    editor.handleInput("\x1b[B");
    assert.strictEqual(editor.getCursor().line, 0);
    assert.strictEqual(editor.getCursor().col, markerEnd);

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: markerStart, line: 0 });

    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 6, line: 0 });
  });
}

function skipsMarkerContinuationVLsPreferred(): void {
  it("skips marker continuation VLs when preferred col falls in marker tail", () => {
    const tui = createTestTUI(20);
    const editor = new Editor(tui, defaultEditorTheme);

    for (const ch of "abcdefgh") editor.handleInput(ch);
    const bigContent = "line\n".repeat(100).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
    for (const ch of "ijklmnopqr") editor.handleInput(ch);
    editor.handleInput("\n");
    for (const ch of "123456789012345678") editor.handleInput(ch);
    editor.render(20);

    editor.handleInput("\x1b[A");
    editor.handleInput("\x01");
    for (let i = 0; i < 3; i++) editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: 3, line: 0 });

    editor.handleInput("\x1b[B");
    assert.strictEqual(editor.getCursor().col, 8);

    editor.handleInput("\x1b[B");
    assert.deepStrictEqual(editor.getCursor(), { col: 3, line: 1 });

    editor.handleInput("\x1b[A");
    assert.strictEqual(editor.getCursor().col, 8);
    editor.handleInput("\x1b[A");
    assert.deepStrictEqual(editor.getCursor(), { col: 3, line: 0 });
  });
}
