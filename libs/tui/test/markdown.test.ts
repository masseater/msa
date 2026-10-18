import assert from "node:assert";
import { describe, it } from "node:test";

import { stripStyleSequences } from "../src/ansi-sequences.ts";
import { Markdown } from "../src/components/markdown.ts";
import { stripAnsi } from "./markdown-helpers.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

describe("Markdown component", () => {
  describe("Transforms", () => {
    it("caches transformed Markdown by source and available width", () => {
      const calls: Array<{ source: string; availableWidth: number }> = [];
      const markdown = new Markdown("source", 2, 0, defaultMarkdownTheme, undefined, {
        transform: (source, availableWidth) => {
          calls.push({ source, availableWidth });
          return `${source} ${availableWidth}`;
        },
      });

      assert.deepStrictEqual(
        markdown.render(80).map((line) => stripAnsi(line).trim()),
        ["source 76"],
      );
      markdown.render(80);
      assert.deepStrictEqual(
        markdown.render(60).map((line) => stripAnsi(line).trim()),
        ["source 56"],
      );
      assert.deepStrictEqual(calls, [
        { source: "source", availableWidth: 76 },
        { source: "source", availableWidth: 56 },
      ]);

      markdown.setText("updated");
      assert.deepStrictEqual(
        markdown.render(60).map((line) => stripAnsi(line).trim()),
        ["updated 56"],
      );
      assert.deepStrictEqual(calls.at(-1), { source: "updated", availableWidth: 56 });

      markdown.invalidate();
      markdown.render(60);
      assert.deepStrictEqual(calls.at(-1), { source: "updated", availableWidth: 56 });
      assert.strictEqual(calls.length, 4);
    });
  });
});

describe("Markdown component", () => {
  describe("Lists", () => {
    it("should render simple nested list", () => {
      const markdown = new Markdown(
        `- Item 1
  - Nested 1.1
  - Nested 1.2
- Item 2`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);

      assert.ok(lines.length > 0);

      const plainLines = lines.map((line) => stripStyleSequences(line));

      assert.ok(plainLines.some((line) => line.includes("- Item 1")));
      assert.ok(plainLines.some((line) => line.includes("    - Nested 1.1")));
      assert.ok(plainLines.some((line) => line.includes("    - Nested 1.2")));
      assert.ok(plainLines.some((line) => line.includes("- Item 2")));
    });
  });
});

describe("Markdown component", () => {
  describe("Lists", () => {
    it("should render deeply nested list", () => {
      const markdown = new Markdown(
        `- Level 1
  - Level 2
    - Level 3
      - Level 4`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => stripStyleSequences(line));

      assert.ok(plainLines.some((line) => line.includes("- Level 1")));
      assert.ok(plainLines.some((line) => line.includes("    - Level 2")));
      assert.ok(plainLines.some((line) => line.includes("        - Level 3")));
      assert.ok(plainLines.some((line) => line.includes("            - Level 4")));
    });

    it("should render ordered nested list", () => {
      const markdown = new Markdown(
        `1. First
   1. Nested first
   2. Nested second
2. Second`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => stripStyleSequences(line));

      assert.ok(plainLines.some((line) => line.includes("1. First")));
      assert.ok(plainLines.some((line) => line.includes("    1. Nested first")));
      assert.ok(plainLines.some((line) => line.includes("    2. Nested second")));
      assert.ok(plainLines.some((line) => line.includes("2. Second")));
    });
  });
});

describe("Markdown component", () => {
  describe("Lists", () => {
    it("should normalize ordered list markers by default", () => {
      const markdown = new Markdown("1. alpha\n1. beta\n1. gamma", 0, 0, defaultMarkdownTheme);

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["1. alpha", "2. beta", "3. gamma"]);
    });

    it("should preserve source list markers when configured", () => {
      const markdown = new Markdown(
        "  4. forth\n  3. third\n\n10) ten\n7) seven\n\n+ plus\n* star\n- minus\n+",
        0,
        0,
        defaultMarkdownTheme,
        undefined,
        {
          preserveOrderedListMarkers: true,
        },
      );

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, [
        "4. forth",
        "3. third",
        "",
        "10) ten",
        "7) seven",
        "",
        "+ plus",
        "* star",
        "- minus",
        "+",
      ]);
    });
  });
});

describe("Markdown component", () => {
  describe("Lists", () => {
    it("should render mixed ordered and unordered nested lists", () => {
      const markdown = new Markdown(
        `1. Ordered item
   - Unordered nested
   - Another nested
2. Second ordered
   - More nested`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => stripStyleSequences(line));

      assert.ok(plainLines.some((line) => line.includes("1. Ordered item")));
      assert.ok(plainLines.some((line) => line.includes("    - Unordered nested")));
      assert.ok(plainLines.some((line) => line.includes("2. Second ordered")));
    });
  });
});

describe("Markdown component", () => {
  describe("Lists", () => {
    it("should render blank lines between loose list items", () => {
      const markdown = new Markdown(
        `1. Lorem ipsum dolor sit amet.

   Ut enim ad minim veniam.

2. Duis aute irure dolor.

   Excepteur sint occaecat cupidatat.

3. Beep boop`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, [
        "1. Lorem ipsum dolor sit amet.",
        "",
        "   Ut enim ad minim veniam.",
        "",
        "2. Duis aute irure dolor.",
        "",
        "   Excepteur sint occaecat cupidatat.",
        "",
        "3. Beep boop",
      ]);
    });

    it("should render task list markers", () => {
      const markdown = new Markdown("- [ ] beep\n- [x] boop", 0, 0, defaultMarkdownTheme);

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["- [ ] beep", "- [x] boop"]);
    });
  });
});
