import assert from "node:assert";
import { describe, it } from "node:test";

import { type AutocompleteProvider } from "../src/autocomplete.ts";
import { Editor } from "../src/components/editor.ts";
import { applyCompletion, createTestTUI, typeText } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes yank", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      typeText(editor, "hello ");
      // Ctrl+W - delete "hello "
      editor.handleInput("\x17");
      // Ctrl+Y - yank
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello ");

      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");
    });

    it("undoes single-line paste atomically", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      // Move right 5 (after "hello", before space)
      for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");

      // Simulate bracketed paste of "beep boop"
      editor.handleInput("\x1b[200~beep boop\x1b[201~");
      assert.strictEqual(editor.getText(), "hellobeep boop world");

      // Single undo should restore entire pre-paste state
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello world");

      editor.handleInput("|");
      assert.strictEqual(editor.getText(), "hello| world");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("does not trigger autocomplete during single-line paste", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let suggestionCalls = 0;

      const mockProvider: AutocompleteProvider = {
        getSuggestions: () => {
          suggestionCalls += 1;
          return Promise.resolve(null);
        },
        applyCompletion,
      };

      editor.setAutocompleteProvider(mockProvider);
      editor.handleInput("\x1b[200~look at @node_modules/react/index.js please\x1b[201~");

      assert.strictEqual(editor.getText(), "look at @node_modules/react/index.js please");
      assert.strictEqual(suggestionCalls, 0);
      assert.strictEqual(editor.isShowingAutocomplete(), false);
    });

    it("decodes CSI-u Ctrl+letter sequences inside bracketed paste (tmux popup)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // tmux popups with extended-keys-format=csi-u re-encode \n in pastes as
      // \x1b[106;5u (Ctrl+J). Without decoding, the per-char filter strips ESC
      // and leaks "[106;5u" between lines. See issue #3599.
      editor.handleInput("\x1b[200~line1\x1b[106;5uline2\x1b[106;5uline3\x1b[201~");
      assert.strictEqual(editor.getText(), "line1\nline2\nline3");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes multi-line paste atomically", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      // Move right 5 (after "hello", before space)
      for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");

      // Simulate bracketed paste of multi-line text
      editor.handleInput("\x1b[200~line1\nline2\nline3\x1b[201~");
      assert.strictEqual(editor.getText(), "helloline1\nline2\nline3 world");

      // Single undo should restore entire pre-paste state
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello world");

      editor.handleInput("|");
      assert.strictEqual(editor.getText(), "hello| world");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("undoes insertTextAtCursor atomically", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      // Move right 5 (after "hello", before space)
      for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");

      // Programmatic insertion (e.g., clipboard image path)
      editor.insertTextAtCursor("/tmp/image.png");
      assert.strictEqual(editor.getText(), "hello/tmp/image.png world");

      // Single undo should restore entire pre-insert state
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello world");

      editor.handleInput("|");
      assert.strictEqual(editor.getText(), "hello| world");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("insertTextAtCursor handles multiline text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Ctrl+A - go to start
      editor.handleInput("\x01");
      // Move right 5 (after "hello", before space)
      for (let i = 0; i < 5; i++) editor.handleInput("\x1b[C");

      // Insert multiline text
      editor.insertTextAtCursor("line1\nline2\nline3");
      assert.strictEqual(editor.getText(), "helloline1\nline2\nline3 world");

      // Cursor should be at end of inserted text (after "line3", before " world")
      const cursor = editor.getCursor();
      assert.strictEqual(cursor.line, 2);
      // "line3".length
      assert.strictEqual(cursor.col, 5);

      // Single undo should restore entire pre-insert state
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello world");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("insertTextAtCursor normalizes CRLF and CR line endings", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("");

      // Insert text with CRLF
      editor.insertTextAtCursor("a\r\nb\r\nc");
      assert.strictEqual(editor.getText(), "a\nb\nc");

      // Undo
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");

      // Insert text with CR only
      editor.insertTextAtCursor("x\ry\rz");
      assert.strictEqual(editor.getText(), "x\ny\nz");
    });

    it("undoes setText to empty string", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      typeText(editor, "hello world");
      assert.strictEqual(editor.getText(), "hello world");

      editor.setText("");
      assert.strictEqual(editor.getText(), "");

      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "hello world");
    });
  });
});

describe("Editor component", () => {
  describe("Undo", () => {
    it("clears undo stack on submit", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let submitted = "";
      editor.onSubmit = (text) => {
        submitted = text;
      };

      typeText(editor, "hello");
      // Enter - submit
      editor.handleInput("\r");

      assert.strictEqual(submitted, "hello");
      assert.strictEqual(editor.getText(), "");

      // Undo should do nothing - stack was cleared
      // Ctrl+- (undo)
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), "");
    });
  });
});
