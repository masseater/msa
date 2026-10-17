import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Prompt history navigation", () => {
    it("does nothing on Up arrow when history is empty", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Up arrow
      editor.handleInput("\x1b[A");

      assert.strictEqual(editor.getText(), "");
    });

    it("shows most recent history entry on Up arrow when editor is empty", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first prompt");
      editor.addToHistory("second prompt");

      // Up arrow
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

      // Up - shows "third"
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "third");

      // Up - shows "second"
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "second");

      // Up - shows "first"
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "first");

      // Up - stays at "first" (oldest)
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

      // Up - jumps to start before history browsing
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "draft");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });

      // Up at start - shows "prompt"
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "prompt");

      // Down - restores draft
      editor.handleInput("\x1b[B");
      assert.strictEqual(editor.getText(), "draft");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 0 });
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

      // Go to oldest
      // start of draft
      editor.handleInput("\x1b[A");
      // third
      editor.handleInput("\x1b[A");
      // second
      editor.handleInput("\x1b[A");
      // first
      editor.handleInput("\x1b[A");

      // Navigate back
      // second
      editor.handleInput("\x1b[B");
      assert.strictEqual(editor.getText(), "second");

      // third
      editor.handleInput("\x1b[B");
      assert.strictEqual(editor.getText(), "third");

      // draft
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

      // Up - shows "old prompt"
      editor.handleInput("\x1b[A");
      // Type a character - exits history mode
      editor.handleInput("x");

      assert.strictEqual(editor.getText(), "xold prompt");
    });

    it("exits history mode on setText", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("first");
      editor.addToHistory("second");

      // Up - shows "second"
      editor.handleInput("\x1b[A");
      // External clear
      editor.setText("");

      // Up should start fresh from most recent
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

      // Should not have more entries
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "valid");
    });

    it("does not add consecutive duplicates to history", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("same");
      editor.addToHistory("same");
      editor.addToHistory("same");

      // "same"
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "same");

      // stays at "same" (only one entry)
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
      // Not consecutive, should be added
      editor.addToHistory("first");

      // "first"
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "first");

      // "second"
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "second");

      // "first" (older one)
      editor.handleInput("\x1b[A");
      assert.strictEqual(editor.getText(), "first");
    });

    it("uses cursor movement instead of history when editor has content", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.addToHistory("history item");
      editor.setText("line1\nline2");

      // Cursor is at end of line2, Up should move to line1
      // Up - cursor movement
      editor.handleInput("\x1b[A");

      // Insert character to verify cursor position
      editor.handleInput("X");

      // X should be inserted in line1, not replace with history
      assert.strictEqual(editor.getText(), "line1X\nline2");
    });
  });
});
