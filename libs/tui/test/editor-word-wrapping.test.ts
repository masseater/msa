import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";

import { wordWrapLine } from "../src/components/editor-wrap.ts";
import { Editor } from "../src/components/editor.ts";
import { visibleWidth } from "../src/utils.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Word wrapping", () => {
    it("does not start lines with leading whitespace after word wrap", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 20;

      editor.setText("Word1 Word2 Word3 Word4 Word5 Word6");
      const lines = editor.render(width);

      const contentLines = lines.slice(1, -1);

      for (let i = 0; i < contentLines.length; i++) {
        const line = stripVTControlCharacters(contentLines[i]!);
        const trimmedStart = line.trimStart();
        if (trimmedStart.length > 0) {
          assert.ok(
            !/^\s+\S/u.test(line.trimEnd()),
            `Line ${i} starts with unexpected whitespace before content`,
          );
        }
      }
    });

    it("breaks long words (URLs) at character level", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 30;

      editor.setText("Check https://example.com/very/long/path/that/exceeds/width here");
      const lines = editor.render(width);

      for (let i = 1; i < lines.length - 1; i++) {
        const lineWidth = visibleWidth(lines[i]!);
        assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
      }
    });
  });
});

describe("Editor component", () => {
  describe("Word wrapping", () => {
    it("preserves multiple spaces within words on same line", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 50;

      editor.setText("Word1   Word2    Word3");
      const lines = editor.render(width);

      const contentLine = stripVTControlCharacters(lines[1]!).trim();
      assert.ok(contentLine.includes("Word1   Word2"), "Multiple spaces should be preserved");
    });

    it("handles empty string", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 40;

      editor.setText("");
      const lines = editor.render(width);

      assert.strictEqual(lines.length, 3);
    });

    it("handles single word that fits exactly", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 10 + 1;

      editor.setText("1234567890");
      const lines = editor.render(width);

      assert.strictEqual(lines.length, 3);
      const contentLine = stripVTControlCharacters(lines[1]!);
      assert.ok(contentLine.includes("1234567890"), "Content should contain the word");
    });
  });
});

describe("Editor component", () => {
  describe("Word wrapping", () => {
    it("wraps word to next line when it ends exactly at terminal width", () => {
      const chunks = wordWrapLine("hello world test", 11);

      assert.strictEqual(chunks.length, 2);
      assert.strictEqual(chunks[0]!.text, "hello ");
      assert.strictEqual(chunks[1]!.text, "world test");
    });

    it("keeps whitespace at terminal width boundary on same line", () => {
      const chunks = wordWrapLine("hello world test", 12);

      assert.strictEqual(chunks.length, 2);
      assert.strictEqual(chunks[0]!.text, "hello world ");
      assert.strictEqual(chunks[1]!.text, "test");
    });

    it("handles unbreakable word filling width exactly followed by space", () => {
      const chunks = wordWrapLine("aaaaaaaaaaaa aaaa", 12);

      assert.strictEqual(chunks.length, 2);
      assert.strictEqual(chunks[0]!.text, "aaaaaaaaaaaa");
      assert.strictEqual(chunks[1]!.text, " aaaa");
    });

    it("wraps word to next line when it fits width but not remaining space", () => {
      const chunks = wordWrapLine("      aaaaaaaaaaaa", 12);

      assert.strictEqual(chunks.length, 2);
      assert.strictEqual(chunks[0]!.text, "      ");
      assert.strictEqual(chunks[1]!.text, "aaaaaaaaaaaa");
    });
  });
});

describe("Editor component", () => {
  describe("Word wrapping", () => {
    it("keeps word with multi-space and following word together when they fit", () => {
      const chunks = wordWrapLine("Lorem ipsum dolor sit amet,    consectetur", 30);

      assert.strictEqual(chunks.length, 2);
      assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
      assert.strictEqual(chunks[1]!.text, "amet,    consectetur");
    });

    it("keeps word with multi-space and following word when they fill width exactly", () => {
      const chunks = wordWrapLine("Lorem ipsum dolor sit amet,              consectetur", 30);

      assert.strictEqual(chunks.length, 2);
      assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
      assert.strictEqual(chunks[1]!.text, "amet,              consectetur");
    });

    it("splits when word plus multi-space plus word exceeds width", () => {
      const chunks = wordWrapLine("Lorem ipsum dolor sit amet,               consectetur", 30);

      assert.strictEqual(chunks.length, 3);
      assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
      assert.strictEqual(chunks[1]!.text, "amet,               ");
      assert.strictEqual(chunks[2]!.text, "consectetur");
    });

    it("breaks long whitespace at line boundary", () => {
      const chunks = wordWrapLine(
        "Lorem ipsum dolor sit amet,                         consectetur",
        30,
      );

      assert.strictEqual(chunks.length, 3);
      assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
      assert.strictEqual(chunks[1]!.text, "amet,                         ");
      assert.strictEqual(chunks[2]!.text, "consectetur");
    });
  });
});

describe("Editor component", () => {
  describe("Word wrapping", () => {
    it("breaks long whitespace at line boundary 2", () => {
      const chunks = wordWrapLine(
        "Lorem ipsum dolor sit amet,                          consectetur",
        30,
      );

      assert.strictEqual(chunks.length, 3);
      assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
      assert.strictEqual(chunks[1]!.text, "amet,                         ");
      assert.strictEqual(chunks[2]!.text, " consectetur");
    });

    it("breaks whitespace spanning full lines", () => {
      const chunks = wordWrapLine(
        "Lorem ipsum dolor sit amet,                                     consectetur",
        30,
      );

      assert.strictEqual(chunks.length, 3);
      assert.strictEqual(chunks[0]!.text, "Lorem ipsum dolor sit ");
      assert.strictEqual(chunks[1]!.text, "amet,                         ");
      assert.strictEqual(chunks[2]!.text, "            consectetur");
    });

    it("force-breaks when wide char after word boundary wrap still overflows", () => {
      const line = ` ${"a".repeat(186)}你`;
      const chunks = wordWrapLine(line, 187);

      for (const chunk of chunks) {
        assert.ok(
          visibleWidth(chunk.text) <= 187,
          `chunk "${chunk.text.slice(0, 20)}..." has visible width ${visibleWidth(chunk.text)}, expected <= 187`,
        );
      }
      const reconstructed = chunks.map((c) => line.slice(c.startIndex, c.endIndex)).join("");
      assert.strictEqual(reconstructed, line);
    });
  });
});

describe("Editor component", () => {
  describe("Word wrapping", () => {
    it("splits oversized atomic segment across multiple chunks", () => {
      const marker = "[paste #1 +20 lines]";
      const line = `A${marker}B`;
      const segments: Intl.SegmentData[] = [
        { segment: "A", index: 0, input: line },
        { segment: marker, index: 1, input: line },
        { segment: "B", index: 1 + marker.length, input: line },
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
