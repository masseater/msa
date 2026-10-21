import assert from "node:assert";
import { describe, it } from "node:test";

import Editor from "../src/components/editor.ts";
import editorHelpers from "./editor-helpers.ts";
import testThemes from "./test-themes.ts";

const { defaultEditorTheme } = testThemes;

const { createTestTUI } = editorHelpers;

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("does nothing on Up arrow when history is empty", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.handleInput("\x1b[A");

      assert.strictEqual(editor.getText(), "");
    });

    it("shows most recent history entry on Up arrow when editor is empty", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first prompt");
      editor.addToHistory("second prompt");

      editor.handleInput("\x1b[A");

      assert.strictEqual(editor.getText(), "second prompt");
    });
  });
});

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("cycles through history entries on repeated Up arrow", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first");
      editor.addToHistory("second");
      editor.addToHistory("third");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "third");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "second");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "first");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "first");
    });
  });
});

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("jumps to start before entering history from a non-empty draft", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("prompt");
      editor.setText("draft");
      editor.handleInput("\x1b[D");
      editor.handleInput("\x1b[D");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "draft");
      assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "prompt");

      editor.handleInput("\x1b[B");
      assert.strictEqual(editor.getText(), "draft");
      assert.deepStrictEqual(editor.getCursor(), { col: 0, line: 0 });
    });
  });
});

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("navigates forward through history with Down arrow", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first");
      editor.addToHistory("second");
      editor.addToHistory("third");
      editor.setText("draft");

      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");
      editor.handleInput("\x1b[A");

      editor.handleInput("\x1b[B");
      assert.strictEqual(editor.getText(), "second");

      editor.handleInput("\x1b[B");
      assert.strictEqual(editor.getText(), "third");

      editor.handleInput("\x1b[B");
      assert.strictEqual(editor.getText(), "draft");
    });
  });
});

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("exits history mode when typing a character", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("old prompt");

      editor.handleInput("\x1b[A");
      editor.handleInput("x");

      assert.strictEqual(editor.getText(), "xold prompt");
    });

    it("exits history mode on setText", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first");
      editor.addToHistory("second");

      editor.handleInput("\x1b[A");
      editor.setText("");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "second");
    });
  });
});

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("does not add empty strings to history", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("");
      editor.addToHistory("   ");
      editor.addToHistory("valid");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "valid");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "valid");
    });

    it("does not add consecutive duplicates to history", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("same");
      editor.addToHistory("same");
      editor.addToHistory("same");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "same");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "same");
    });
  });
});

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("allows non-consecutive duplicates in history", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first");
      editor.addToHistory("second");
      editor.addToHistory("first");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "first");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "second");

      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "first");
    });

    it("uses cursor movement instead of history when editor has content", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("history item");
      editor.setText("line1\nline2");

      editor.handleInput("\x1b[A");

      editor.handleInput("X");

      assert.strictEqual(editor.getText(), "line1X\nline2");
    });
  });
});
