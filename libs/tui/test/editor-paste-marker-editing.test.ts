import assert from "node:assert";
import { describe, it } from "node:test";

import Editor from "../src/components/editor.ts";
import utils from "../src/utils.ts";
import editorHelpers from "./editor-helpers.ts";
import testThemes from "./test-themes.ts";

const { defaultEditorTheme } = testThemes;
const { visibleWidth } = utils;

const { createTestTUI, pasteWithMarker } = editorHelpers;

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    createsPasteMarkerLargePastes();
    treatsPasteMarkerSingleUnit();
    treatsPasteMarkerSingleUnit2();
    treatsPasteMarkerSingleUnit3();
    treatsPasteMarkerSingleUnit4();
    handlesMultiplePasteMarkersSame();
    doesNotTreatManuallyTyped();
  });
});

function createsPasteMarkerLargePastes(): void {
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
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: 1, line: 0 });

    editor.handleInput("\x1b[C");
    const marker = editor.getText().match(/\[paste #\d+ \+\d+ lines\]/u)![0];
    assert.deepStrictEqual(editor.getCursor(), { col: 1 + marker.length, line: 0 });

    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: 1 + marker.length + 1, line: 0 });
  });
}

function treatsPasteMarkerSingleUnit(): void {
  it("treats paste marker as single unit for left arrow", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.handleInput("A");
    pasteWithMarker(editor);
    editor.handleInput("B");

    editor.handleInput("\x1b[D");
    const text = editor.getText();
    const marker = text.match(/\[paste #\d+ \+\d+ lines\]/u)![0];
    assert.deepStrictEqual(editor.getCursor(), { col: 1 + marker.length, line: 0 });

    editor.handleInput("\x1b[D");
    assert.deepStrictEqual(editor.getCursor(), { col: 1, line: 0 });

    editor.handleInput("\x1b[D");
    assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });
  });
}

function treatsPasteMarkerSingleUnit2(): void {
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
    assert.deepStrictEqual(editor.getCursor(), { col: 1 + marker.length, line: 0 });

    editor.handleInput("\x7f");
    assert.strictEqual(editor.getText(), "AB");
    assert.deepStrictEqual(editor.getCursor(), { col: 1, line: 0 });
  });
}

function treatsPasteMarkerSingleUnit3(): void {
  it("treats paste marker as single unit for forward delete", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.handleInput("A");
    pasteWithMarker(editor);
    editor.handleInput("B");

    editor.handleInput("\x01");
    editor.handleInput("\x1b[C");

    editor.handleInput("\x1b[3~");
    assert.strictEqual(editor.getText(), "AB");
    assert.deepStrictEqual(editor.getCursor(), { col: 1, line: 0 });
  });
}

function treatsPasteMarkerSingleUnit4(): void {
  it("treats paste marker as single unit for word movement", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    editor.handleInput("X");
    editor.handleInput(" ");
    pasteWithMarker(editor);
    editor.handleInput(" ");
    editor.handleInput("Y");

    const text = editor.getText();
    const marker = text.match(/\[paste #\d+ \+\d+ lines\]/u)![0];

    editor.handleInput("\x01");

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { col: 1, line: 0 });

    editor.handleInput("\x1b[1;5C");
    assert.deepStrictEqual(editor.getCursor(), { col: 2 + marker.length, line: 0 });
  });
}

function handlesMultiplePasteMarkersSame(): void {
  it("handles multiple paste markers in same line", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    pasteWithMarker(editor);
    editor.handleInput(" ");
    pasteWithMarker(editor);

    const text = editor.getText();
    const markers = [...text.matchAll(/\[paste #\d+ \+\d+ lines\]/gu)];
    assert.strictEqual(markers.length, 2);

    editor.handleInput("\x01");

    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: markers[0]![0].length, line: 0 });

    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: markers[0]![0].length + 1, line: 0 });

    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), {
      col: markers[0]![0].length + 1 + markers[1]![0].length,
      line: 0,
    });
  });
}

function doesNotTreatManuallyTyped(): void {
  it("does not treat manually typed marker-like text as atomic (no valid paste ID)", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);
    const fakeMarker = "[paste #99 +5 lines]";
    for (const ch of fakeMarker) editor.handleInput(ch);

    assert.strictEqual(editor.getText(), fakeMarker);

    editor.handleInput("\x01");
    editor.handleInput("\x1b[C");
    assert.deepStrictEqual(editor.getCursor(), { col: 1, line: 0 });
  });
  it("does not crash when paste marker is wider than terminal width", () => {
    const tui = createTestTUI();
    const editor = new Editor(tui, defaultEditorTheme);
    const bigContent = "line\n".repeat(47).trimEnd();
    editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);

    const text = editor.getText();
    const marker = text.match(/\[paste #\d+ \+\d+ lines\]/u);
    assert.ok(marker, "paste marker should be created");
    assert.ok(visibleWidth(marker[0]) > 8, "marker should be wider than render width");

    const lines = editor.render(8);
    for (const line of lines) {
      assert.ok(
        visibleWidth(line) <= 8,
        `line exceeds width 8: visible=${visibleWidth(line)} text=${JSON.stringify(line)}`,
      );
    }
  });
}
