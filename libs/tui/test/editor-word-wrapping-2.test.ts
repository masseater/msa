import assert from "node:assert";
import { describe, it } from "node:test";

import { Editor, wordWrapLine } from "../src/components/editor.ts";
import { visibleWidth } from "../src/utils.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Word wrapping", () => {
    it("splits oversized atomic segment at start of line", () => {
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
      assert.strictEqual(chunks[chunks.length - 1]!.text.includes("B"), true);

      const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
      assert.strictEqual(reconstructed, line);
    });

    it("splits oversized atomic segment at end of line", () => {
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
      const m1 = "[paste #1 +20 lines]";
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

      for (const chunk of chunks) {
        assert.ok(
          visibleWidth(chunk.text) <= 10,
          `chunk "${chunk.text}" has visible width ${visibleWidth(chunk.text)}, expected <= 10`,
        );
      }

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
      editor.handleInput("\x17");
      assert.strictEqual(editor.getText(), "foo bar ");

      editor.handleInput("\x01");
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "bazfoo bar ");
    });

    it("Ctrl+U saves deleted text to kill ring", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("hello world");
      editor.handleInput("\x01");
      editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[C");
      editor.handleInput("\x1b[C");

      editor.handleInput("\x15");
      assert.strictEqual(editor.getText(), "world");

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
      editor.handleInput("\x01");
      editor.handleInput("\x0b");

      assert.strictEqual(editor.getText(), "");

      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "hello world");
    });

    it("Ctrl+Y does nothing when kill ring is empty", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);

      editor.setText("test");
      editor.handleInput("\x19");
      assert.strictEqual(editor.getText(), "test");
    });
  });
});

describe("Editor component", () => {
  describe("Kill ring", () => {
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
  });
});
