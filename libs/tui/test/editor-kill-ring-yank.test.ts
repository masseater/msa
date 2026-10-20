import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import editorHelpers from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

const { createTestTUI } = editorHelpers;

describe("Editor component", () => {
  describe("Kill ring", () => {
    altYCyclesThroughKill();
    handlesYankMiddleText();
    handlesYankPopMiddleText();
    multilineYankYankPopMiddle();
    altYDoesNothingIf();
    nonYankActionsBreakAlt();
    killRingRotationPersistsAfter();
  });
});

function altYCyclesThroughKill(): void {
  it("Alt+Y cycles through kill ring after Ctrl+Y", () => {
    const editor = new Editor(createTestTUI(), defaultEditorTheme);

    editor.setText("first");
    editor.handleInput("\x17");
    editor.setText("second");
    editor.handleInput("\x17");
    editor.setText("third");
    editor.handleInput("\x17");

    assert.strictEqual(editor.getText(), "");

    editor.handleInput("\x19");
    assert.strictEqual(editor.getText(), "third");

    editor.handleInput("\x1by");
    assert.strictEqual(editor.getText(), "second");

    editor.handleInput("\x1by");
    assert.strictEqual(editor.getText(), "first");

    editor.handleInput("\x1by");
    assert.strictEqual(editor.getText(), "third");
  });
}

function handlesYankMiddleText(): void {
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
}

function handlesYankPopMiddleText(): void {
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
}

function multilineYankYankPopMiddle(): void {
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
}

function altYDoesNothingIf(): void {
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
}

function nonYankActionsBreakAlt(): void {
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
}

function killRingRotationPersistsAfter(): void {
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
}
