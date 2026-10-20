import assert from "node:assert";
import { describe, it } from "node:test";

import { stripStyleSequences } from "../src/ansi-sequences.ts";
import { Markdown } from "../src/components/markdown.ts";
import markdownHelpers from "./markdown-helpers.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

const { chalk } = markdownHelpers;

describe("Markdown component", () => {
  describe("Blockquotes with multiline content", () => {
    it("should apply consistent styling to explicit multiline blockquote", () => {
      const markdown = new Markdown(
        `>Foo
>bar`,
        0,
        0,
        defaultMarkdownTheme,
        {
          color: (text) => chalk.cyan(text),
        },
      );

      const lines = markdown.render(80);

      const plainLines = lines.map((line) => stripStyleSequences(line));
      const quotedLines = plainLines.filter((line) => line.startsWith("│ "));
      assert.strictEqual(
        quotedLines.length,
        2,
        `Expected 2 quoted lines, got: ${JSON.stringify(plainLines)}`,
      );

      const fooLine = lines.find((line) => line.includes("Foo"));
      const barLine = lines.find((line) => line.includes("bar"));
      assert.ok(fooLine?.includes("\x1b[3m"), `Foo line should have italic: ${fooLine}`);
      assert.ok(barLine?.includes("\x1b[3m"), `bar line should have italic: ${barLine}`);

      assert.ok(
        fooLine?.includes("\x1b[36m") !== true,
        `Foo line should NOT have cyan color: ${fooLine}`,
      );
      assert.ok(
        barLine?.includes("\x1b[36m") !== true,
        `bar line should NOT have cyan color: ${barLine}`,
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Blockquotes with multiline content", () => {
    it("should render list content inside blockquotes", () => {
      const markdown = new Markdown(
        `> 1. bla bla
> - nested bullet`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => stripStyleSequences(line));
      const quotedLines = plainLines.filter((line) => line.startsWith("│ "));

      assert.ok(
        quotedLines.some((line) => line.includes("1. bla bla")),
        `Missing ordered list item: ${JSON.stringify(quotedLines)}`,
      );
      assert.ok(
        quotedLines.some((line) => line.includes("- nested bullet")),
        `Missing unordered list item: ${JSON.stringify(quotedLines)}`,
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Blockquotes with multiline content", () => {
    it("should wrap long blockquote lines and add border to each wrapped line", () => {
      const longText =
        "This is a very long blockquote line that should wrap to multiple lines when rendered";
      const markdown = new Markdown(`> ${longText}`, 0, 0, defaultMarkdownTheme);

      const lines = markdown.render(30);
      const plainLines = lines.map((line) => stripStyleSequences(line).trimEnd());

      const contentLines = plainLines.filter((line) => line.length > 0);

      assert.ok(
        contentLines.length > 1,
        `Expected multiple wrapped lines, got: ${JSON.stringify(contentLines)}`,
      );

      for (const line of contentLines) {
        assert.ok(line.startsWith("│ "), `Wrapped line should have quote border: "${line}"`);
      }

      const allText = contentLines.join(" ");
      assert.ok(allText.includes("very long"), "Should preserve 'very long'");
      assert.ok(allText.includes("blockquote"), "Should preserve 'blockquote'");
      assert.ok(allText.includes("multiple"), "Should preserve 'multiple'");
    });
  });
});

describe("Markdown component", () => {
  describe("Blockquotes with multiline content", () => {
    it("should properly indent wrapped blockquote lines with styling", () => {
      const markdown = new Markdown(
        "> This is styled text that is long enough to wrap",
        0,
        0,
        defaultMarkdownTheme,
        {
          color: (text) => chalk.yellow(text),
          italic: true,
        },
      );

      const lines = markdown.render(25);
      const plainLines = lines.map((line) => stripStyleSequences(line).trimEnd());

      const contentLines = plainLines.filter((line) => line.length > 0);

      for (const line of contentLines) {
        assert.ok(line.startsWith("│ "), `Line should have quote border: "${line}"`);
      }

      const allOutput = lines.join("\n");
      assert.ok(allOutput.includes("\x1b[3m"), "Should have italic");

      assert.ok(!allOutput.includes("\x1b[33m"), "Should NOT have yellow color from default style");
    });
  });
});

describe("Markdown component", () => {
  describe("Blockquotes with multiline content", () => {
    it("should render inline formatting inside blockquotes and reapply quote styling after", () => {
      const markdown = new Markdown("> Quote with **bold** and `code`", 0, 0, defaultMarkdownTheme);

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => stripStyleSequences(line));

      assert.ok(
        plainLines.some((line) => line.startsWith("│ ")),
        "Should have quote border",
      );

      const allPlain = plainLines.join(" ");
      assert.ok(allPlain.includes("Quote with"), "Should preserve 'Quote with'");
      assert.ok(allPlain.includes("bold"), "Should preserve 'bold'");
      assert.ok(allPlain.includes("code"), "Should preserve 'code'");

      const allOutput = lines.join("\n");

      assert.ok(allOutput.includes("\x1b[1m"), "Should have bold styling");

      assert.ok(allOutput.includes("\x1b[33m"), "Should have code styling (yellow)");

      assert.ok(allOutput.includes("\x1b[3m"), "Should have italic from quote styling");
    });
  });
});

describe("Markdown component", () => {
  describe("Heading with inline code", () => {
    it("should preserve heading styling after inline code", () => {
      const markdown = new Markdown(
        "### Why `sourceInfo` should not be optional",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const joinedOutput = lines.join("\n");

      assert.ok(joinedOutput.includes("\x1b[33m"), "Should have yellow for inline code");

      const afterCodeIndex = joinedOutput.indexOf("should not be optional");
      assert.ok(afterCodeIndex > 0, "Should contain text after inline code");

      const precedingChunk = joinedOutput.slice(Math.max(0, afterCodeIndex - 40), afterCodeIndex);
      assert.ok(
        precedingChunk.includes("\x1b[1m"),
        `Should re-apply bold before text after code: ${precedingChunk}`,
      );
      assert.ok(
        precedingChunk.includes("\x1b[36m"),
        `Should re-apply cyan before text after code: ${precedingChunk}`,
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Heading with inline code", () => {
    it("should preserve heading styling after inline code for h1", () => {
      const markdown = new Markdown("# Title with `code` inside", 0, 0, defaultMarkdownTheme);

      const lines = markdown.render(80);
      const joinedOutput = lines.join("\n");

      const afterCodeIndex = joinedOutput.indexOf("inside");
      assert.ok(afterCodeIndex > 0, "Should contain text after inline code");

      const precedingChunk = joinedOutput.slice(Math.max(0, afterCodeIndex - 40), afterCodeIndex);
      assert.ok(
        precedingChunk.includes("\x1b[1m"),
        `Should re-apply bold for h1: ${precedingChunk}`,
      );
      assert.ok(
        precedingChunk.includes("\x1b[36m"),
        `Should re-apply cyan for h1: ${precedingChunk}`,
      );
      assert.ok(
        precedingChunk.includes("\x1b[4m"),
        `Should re-apply underline for h1: ${precedingChunk}`,
      );
    });
  });
});
