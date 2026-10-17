import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor } from "../src/components/editor.ts";
import { visibleWidth } from "../src/utils.ts";
import { bigPaste, createTestTUI, pasteWithMarker } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("treats paste marker as single unit for word movement", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.handleInput("X");
      editor.handleInput(" ");
      pasteWithMarker(editor);
      editor.handleInput(" ");
      editor.handleInput("Y");
      // Text: "X [paste #1 +20 lines] Y"

      const text = editor.getText();
      const marker = text.match(/\[paste #\d+ \+\d+ lines\]/u)![0];

      // Go to start
      // Ctrl+A
      editor.handleInput("\x01");

      // Ctrl+Right: skip "X"
      editor.handleInput("\x1b[1;5C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });

      // Ctrl+Right: skip whitespace + marker (marker treated as single non-ws, non-punct unit)
      editor.handleInput("\x1b[1;5C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 2 + marker.length });
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("undo restores marker after backspace deletion", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      editor.handleInput("A");
      pasteWithMarker(editor);
      editor.handleInput("B");

      const textBefore = editor.getText();

      // Position after marker
      editor.handleInput("\x01");
      // past A
      editor.handleInput("\x1b[C");
      // past marker
      editor.handleInput("\x1b[C");

      // Delete marker
      editor.handleInput("\x7f");
      assert.strictEqual(editor.getText(), "AB");

      // Undo
      editor.handleInput("\x1b[45;5u");
      assert.strictEqual(editor.getText(), textBefore);
    });

    it("undo after paste marker deletion restores the paste registry", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let submitted = "";
      editor.onSubmit = (t) => {
        submitted = t;
      };

      const paste = bigPaste("alpha");
      editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
      // delete the marker
      editor.handleInput("\x7f");
      // undo: restores marker text and registry
      editor.handleInput("\x1b[45;5u");
      editor.handleInput("\r");
      assert.strictEqual(submitted, paste);
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("undo after deleting the first of two paste markers restores both registry entries", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let submitted = "";
      editor.onSubmit = (t) => {
        submitted = t;
      };

      const pasteA = bigPaste("alpha");
      const pasteB = bigPaste("beta");
      // #1 = A
      editor.handleInput(`\x1b[200~${pasteA}\x1b[201~`);
      // #2 = B, cursor at end
      editor.handleInput(`\x1b[200~${pasteB}\x1b[201~`);
      // Ctrl+A
      editor.handleInput("\x01");
      // right over marker #1
      editor.handleInput("\x1b[C");
      // delete marker #1, renumbers #2 -> #1
      editor.handleInput("\x7f");
      // undo
      editor.handleInput("\x1b[45;5u");
      editor.handleInput("\r");
      assert.strictEqual(submitted, pasteA + pasteB);
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("renumbers the paste registry in ascending id order when markers are out of order in text", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let submitted = "";
      editor.onSubmit = (t) => {
        submitted = t;
      };

      const pasteA = bigPaste("alpha");
      const pasteB = bigPaste("beta");
      const pasteC = bigPaste("gamma");
      // #1 = A
      editor.handleInput(`\x1b[200~${pasteA}\x1b[201~`);
      // Ctrl+A
      editor.handleInput("\x01");
      // #2 = B, text: [#2][#1]
      editor.handleInput(`\x1b[200~${pasteB}\x1b[201~`);
      // Ctrl+A
      editor.handleInput("\x01");
      // #3 = C, text: [#3][#2][#1]
      editor.handleInput(`\x1b[200~${pasteC}\x1b[201~`);
      // Ctrl+E
      editor.handleInput("\x05");
      // delete marker #1, renumber #3 -> #2 and #2 -> #1
      editor.handleInput("\x7f");
      editor.handleInput("\r");
      assert.strictEqual(submitted, pasteC + pasteB);
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("undo after setText restores paste markers and registry", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      let submitted = "";
      editor.onSubmit = (t) => {
        submitted = t;
      };

      const paste = bigPaste("alpha");
      editor.handleInput(`\x1b[200~${paste}\x1b[201~`);
      editor.setText("replacement");
      // undo
      editor.handleInput("\x1b[45;5u");
      editor.handleInput("\r");
      assert.strictEqual(submitted, paste);
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("handles multiple paste markers in same line", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      pasteWithMarker(editor);
      editor.handleInput(" ");
      pasteWithMarker(editor);

      const text = editor.getText();
      const markers = [...text.matchAll(/\[paste #\d+ \+\d+ lines\]/gu)];
      assert.strictEqual(markers.length, 2);

      // Go to start
      editor.handleInput("\x01");

      // Right arrow: should skip first marker atomically
      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: markers[0]![0].length });

      // Right arrow: past space
      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: markers[0]![0].length + 1 });

      // Right arrow: should skip second marker atomically
      editor.handleInput("\x1b[C");
      assert.deepStrictEqual(editor.getCursor(), {
        line: 0,
        col: markers[0]![0].length + 1 + markers[1]![0].length,
      });
    });
  });
});

describe("Editor component", () => {
  describe("Paste marker atomic behavior", () => {
    it("does not treat manually typed marker-like text as atomic (no valid paste ID)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      // Type text that matches the pattern but was typed manually (no paste entry)
      const fakeMarker = "[paste #99 +5 lines]";
      for (const ch of fakeMarker) editor.handleInput(ch);

      assert.strictEqual(editor.getText(), fakeMarker);

      // No paste with ID 99 exists, so the marker is NOT treated atomically.
      // Right arrow should move one grapheme at a time.
      // Ctrl+A
      editor.handleInput("\x01");
      // Right
      editor.handleInput("\x1b[C");
      // Just past "["
      assert.deepStrictEqual(editor.getCursor(), { line: 0, col: 1 });
    });

    it("does not crash when paste marker is wider than terminal width", () => {
      // Reproduce: terminal width 8, paste marker "[paste #1 +47 lines]" (21 chars)
      const tui = createTestTUI();
      const editor = new Editor(tui, defaultEditorTheme);
      const bigContent = "line\n".repeat(47).trimEnd();
      editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);

      const text = editor.getText();
      const marker = text.match(/\[paste #\d+ \+\d+ lines\]/u);
      assert.ok(marker, "paste marker should be created");
      assert.ok(visibleWidth(marker[0]) > 8, "marker should be wider than render width");

      // Render at very narrow width - should not throw
      const lines = editor.render(8);
      // Every rendered line must fit within the width (marker is split)
      for (const line of lines) {
        assert.ok(
          visibleWidth(line) <= 8,
          `line exceeds width 8: visible=${visibleWidth(line)} text=${JSON.stringify(line)}`,
        );
      }
    });
  });
});
