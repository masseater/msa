import assert from "node:assert";
import { describe, it } from "node:test";
import { stripVTControlCharacters } from "node:util";

import { Editor } from "../src/components/editor.ts";
import { FAKE_CURSOR_START, renderFakeCursor } from "../src/tui-component.ts";
import { stripTerminalSequences, visibleWidth } from "../src/utils.ts";
import { createTestTUI } from "./editor-helpers.ts";
import { defaultEditorTheme } from "./test-themes.ts";

describe("Editor component", () => {
  describe("Scroll indicators", () => {
    it("keeps truncated scroll indicators within width and preserves their color (issue #6962)", () => {
      const width = 10;
      const borderColor = (text: string) => `\x1b[35m${text}\x1b[39m`;
      const editor = new Editor(createTestTUI(width), { ...defaultEditorTheme, borderColor });
      editor.setText(Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n"));

      editor.render(width);
      for (let index = 0; index < 10; index++) editor.handleInput("\x1b[A");

      const lines = editor.render(width);
      const topBorder = lines[0]!;
      const bottomBorder = lines.at(-1)!;

      assert.match(stripVTControlCharacters(topBorder), /^─── ↑/u);
      assert.match(stripVTControlCharacters(bottomBorder), /^─── ↓/u);
      assert.strictEqual(topBorder, borderColor(stripVTControlCharacters(topBorder)));
      assert.strictEqual(bottomBorder, borderColor(stripVTControlCharacters(bottomBorder)));
      for (const line of lines) {
        assert.strictEqual(
          visibleWidth(line),
          width,
          `line exceeds width ${width}: ${JSON.stringify(line)}`,
        );
      }
    });
  });
});

describe("Editor component", () => {
  describe("Grapheme-aware text wrapping", () => {
    it("wraps lines correctly when text contains wide emojis", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 20;

      editor.setText("Hello ✅ World");
      const lines = editor.render(width);

      for (let i = 1; i < lines.length - 1; i++) {
        const lineWidth = visibleWidth(lines[i]!);
        assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
      }
    });

    it("wraps long text with emojis at correct positions", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 10;

      editor.setText("✅✅✅✅✅✅");
      const lines = editor.render(width);

      for (let i = 1; i < lines.length - 1; i++) {
        const lineWidth = visibleWidth(lines[i]!);
        assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
      }
    });
  });
});

describe("Editor component", () => {
  describe("Grapheme-aware text wrapping", () => {
    it("renders isolated Thai and Lao AM clusters without width drift", () => {
      for (const text of ["ำabc", "ຳabc"]) {
        const editor = new Editor(createTestTUI(), defaultEditorTheme);
        const width = 8;
        editor.setText(text);

        for (const line of editor.render(width)) {
          assert.strictEqual(
            visibleWidth(line),
            width,
            `line width drift for ${JSON.stringify(text)}: ${line}`,
          );
        }
      }
    });

    it("wraps CJK characters correctly (each is 2 columns wide)", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 10 + 1;

      editor.setText("日本語テスト");
      const lines = editor.render(width);

      for (let i = 1; i < lines.length - 1; i++) {
        const lineWidth = visibleWidth(lines[i]!);
        assert.strictEqual(lineWidth, width, `Line ${i} has width ${lineWidth}, expected ${width}`);
      }

      const contentLines = lines.slice(1, -1).map((l) => stripTerminalSequences(l).trim());
      assert.strictEqual(contentLines.length, 2);
      assert.strictEqual(contentLines[0], "日本語テス");
      assert.strictEqual(contentLines[1], "ト");
    });
  });
});

describe("Editor component", () => {
  describe("Grapheme-aware text wrapping", () => {
    it("handles mixed ASCII and wide characters in wrapping", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 15 + 1;

      editor.setText("Test ✅ OK 日本");
      const lines = editor.render(width);

      const contentLines = lines.slice(1, -1);
      assert.strictEqual(contentLines.length, 1);

      const lineWidth = visibleWidth(contentLines[0]!);
      assert.strictEqual(lineWidth, width);
    });

    it("renders cursor correctly on wide characters", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 20;

      editor.setText("A✅B");
      const lines = editor.render(width);

      const contentLine = lines[1]!;
      assert.ok(contentLine.includes(FAKE_CURSOR_START), "Should have fake cursor");

      assert.strictEqual(visibleWidth(contentLine), width);
    });
  });
});

describe("Editor component", () => {
  describe("Grapheme-aware text wrapping", () => {
    it("does not exceed terminal width with emoji at wrap boundary", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 11;

      editor.setText("0123456789✅");
      const lines = editor.render(width);

      for (let i = 1; i < lines.length - 1; i++) {
        const lineWidth = visibleWidth(lines[i]!);
        assert.ok(lineWidth <= width, `Line ${i} has width ${lineWidth}, exceeds max ${width}`);
      }
    });

    it("shows cursor at end of line before wrap, wraps on next char", () => {
      const width = 10;
      for (const paddingX of [0, 1]) {
        const editor = new Editor(createTestTUI(width + paddingX), defaultEditorTheme, {
          paddingX,
        });

        for (const ch of "aaaaaaaaa") editor.handleInput(ch);
        let lines = editor.render(width + paddingX);
        let contentLines = lines.slice(1, -1);
        assert.strictEqual(contentLines.length, 1, "Should be 1 content line before wrap");
        assert.ok(
          contentLines[0]!.endsWith(renderFakeCursor(" ")),
          "Cursor should be at end of line",
        );

        editor.handleInput("a");
        lines = editor.render(width + paddingX);
        contentLines = lines.slice(1, -1);
        assert.strictEqual(contentLines.length, 2, "Should wrap to 2 content lines");
      }
    });
  });
});

describe("Editor component", () => {
  describe("Word wrapping", () => {
    it("wraps at word boundaries instead of mid-word", () => {
      const editor = new Editor(createTestTUI(), defaultEditorTheme);
      const width = 40;

      editor.setText("Hello world this is a test of word wrapping functionality");
      const lines = editor.render(width);

      const contentLines = lines.slice(1, -1).map((l) => stripTerminalSequences(l).trim());

      assert.ok(
        !contentLines[0]!.endsWith("-"),
        "Line should not end with hyphen (mid-word break)",
      );

      for (const line of contentLines) {
        const lastChar = line.trimEnd().slice(-1);
        assert.ok(
          lastChar === "" || /[\w.,!?;:]/u.test(lastChar),
          `Line ends unexpectedly with: "${lastChar}"`,
        );
      }
    });
  });
});
