import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor, wordWrapLine } from "../src/components/editor.ts";
import { visibleWidth } from "../src/utils.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Word wrapping", () => {
    it("splits oversized atomic segment at start of line", () => {
      // 21 chars
      const marker = "[paste #1 +20 lines]";
      const line = `${marker}B`;
      const segments: Intl.SegmentData[] = [
        { segment: marker, index: 0, input: line },
        { segment: "B", index: marker.length, input: line },
      ];

      const chunks = wordWrapLine(line, 10, segments);

      for (const chunk of chunks) {
        assert.ok(visibleWidth(chunk.text) <= 10);
      }
      // "B" ends up on the last line (either alone or with the marker tail)
      assert.strictEqual(chunks[chunks.length - 1]!.text.includes("B"), true);

      const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
      assert.strictEqual(reconstructed, line);
    });

    it("splits oversized atomic segment at end of line", () => {
      // 21 chars
      const marker = "[paste #1 +20 lines]";
      const line = `A${marker}`;
      const segments: Intl.SegmentData[] = [
        { segment: "A", index: 0, input: line },
        { segment: marker, index: 1, input: line },
      ];

      const chunks = wordWrapLine(line, 10, segments);

      for (const chunk of chunks) {
        assert.ok(visibleWidth(chunk.text) <= 10);
      }
      assert.strictEqual(chunks[0]!.text, "A");

      const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
      assert.strictEqual(reconstructed, line);
    });
  });
});

describe("Editor component", () => {
  describe("Word wrapping", () => {
    it("splits consecutive oversized atomic segments", () => {
      // 21 chars
      const m1 = "[paste #1 +20 lines]";
      // 21 chars
      const m2 = "[paste #2 +30 lines]";
      const line = `${m1}${m2}`;
      const segments: Intl.SegmentData[] = [
        { segment: m1, index: 0, input: line },
        { segment: m2, index: m1.length, input: line },
      ];

      const chunks = wordWrapLine(line, 10, segments);

      for (const chunk of chunks) {
        assert.ok(
          visibleWidth(chunk.text) <= 10,
          `chunk "${chunk.text}" has visible width ${visibleWidth(chunk.text)}, expected <= 10`,
        );
      }

      const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
      assert.strictEqual(reconstructed, line);
    });
  });
});

describe("Editor component", () => {
  describe("Word wrapping", () => {
    it("wraps normally after oversized atomic segment", () => {
      // 21 chars
      const marker = "[paste #1 +20 lines]";
      const line = `${marker} hello world`;
      const segments: Intl.SegmentData[] = [
        { segment: marker, index: 0, input: line },
        { segment: " ", index: marker.length, input: line },
        { segment: "h", index: marker.length + 1, input: line },
        { segment: "e", index: marker.length + 2, input: line },
        { segment: "l", index: marker.length + 3, input: line },
        { segment: "l", index: marker.length + 4, input: line },
        { segment: "o", index: marker.length + 5, input: line },
        { segment: " ", index: marker.length + 6, input: line },
        { segment: "w", index: marker.length + 7, input: line },
        { segment: "o", index: marker.length + 8, input: line },
        { segment: "r", index: marker.length + 9, input: line },
        { segment: "l", index: marker.length + 10, input: line },
        { segment: "d", index: marker.length + 11, input: line },
      ];

      const chunks = wordWrapLine(line, 10, segments);

      // All chunks must fit
      for (const chunk of chunks) {
        assert.ok(
          visibleWidth(chunk.text) <= 10,
          `chunk "${chunk.text}" has visible width ${visibleWidth(chunk.text)}, expected <= 10`,
        );
      }

      // Last chunk should contain "world" (normal wrapping resumes)
      assert.strictEqual(chunks[chunks.length - 1]!.text, "world");

      const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
      assert.strictEqual(reconstructed, line);
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("Ctrl+W saves deleted text to kill ring and Ctrl+Y yanks it", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("foo bar baz");
      // Ctrl+W - deletes "baz"
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "foo bar ");

      // Move to beginning and yank
      // Ctrl+A
      editor.handleInput("\x01");
      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "bazfoo bar ");
    });

    it("Ctrl+U saves deleted text to kill ring", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Move cursor to middle
      // Ctrl+A (start)
      editor.handleInput("\x01");
      // Right 5 times
      editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[C");
      // After "hello "
      editor.handleInput("\x1b[C");

      // Ctrl+U - deletes "hello "
      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "world");

      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello world");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("Ctrl+K saves deleted text to kill ring", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      // Ctrl+A (start)
      editor.handleInput("\x01");
      // Ctrl+K - deletes "hello world"
      editor.handleInput("\x0b");

      assert.strictEqual(editor.getText(), "");

      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello world");
    });

    it("Ctrl+Y does nothing when kill ring is empty", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("test");
      // Ctrl+Y
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "test");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
    it("Alt+Y cycles through kill ring after Ctrl+Y", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      // Create kill ring with multiple entries
      editor.setText("first");
      // Ctrl+W - deletes "first"
      editor.handleInput("\x17");
      editor.setText("second");
      // Ctrl+W - deletes "second"
      editor.handleInput("\x17");
      editor.setText("third");
      // Ctrl+W - deletes "third"
      editor.handleInput("\x17");

      // Kill ring now has: [first, second, third]
      assert.strictEqual(editor.getText(), "");

      // Ctrl+Y - yanks "third" (most recent)
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "third");

      // Alt+Y - cycles to "second"
      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "second");

      // Alt+Y - cycles to "first"
      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "first");

      // Alt+Y - cycles back to "third"
      editor.handleInput("\x1by");
      assert.strictEqual(editor.getText(), "third");
    });
  });
});
