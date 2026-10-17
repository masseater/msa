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
    splitsOversizedAtomicSegmentStart();
    splitsConsecutiveOversizedAtomicSegments();
    wrapsNormallyAfterOversizedAtomic();
    splitsOversizedAtomicSegmentAcross();
  });
  describe("Scroll indicators", () => {
    centersScrollIndicatorsWideBorders();
  });
});

function splitsOversizedAtomicSegmentStart(): void {
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
}

function splitsConsecutiveOversizedAtomicSegments(): void {
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
}

function wrapsNormallyAfterOversizedAtomic(): void {
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
}

function splitsOversizedAtomicSegmentAcross(): void {
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
}

function centersScrollIndicatorsWideBorders(): void {
  it("centers scroll indicators on wide borders", () => {
    const width = 40;
    const editor = new Editor(createTestTUI(width), defaultEditorTheme);
    editor.setText(Array.from({ length: 20 }, (_, index) => `line ${index}`).join("\n"));

    editor.render(width);
    for (let index = 0; index < 10; index++) editor.handleInput("\x1b[A");

    const lines = editor.render(width);
    assert.strictEqual(
      stripVTControlCharacters(lines[0]!),
      `${"─".repeat(15)} ↑ 9 more ${"─".repeat(15)}`,
    );
    assert.strictEqual(
      stripVTControlCharacters(lines.at(-1)!),
      `${"─".repeat(15)} ↓ 4 more ${"─".repeat(15)}`,
    );
  });
}
