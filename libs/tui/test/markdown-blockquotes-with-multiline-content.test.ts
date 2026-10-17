import assert from "node:assert";
import { describe, it } from "node:test";

import { Markdown } from "../src/components/markdown.ts";
import { chalk } from "./markdown-helpers.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

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
          // This should NOT be applied to blockquotes
          color: (text) => chalk.cyan(text),
        },
      );

      const lines = markdown.render(80);

      // Both lines should have the quote border
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));
      const quotedLines = plainLines.filter((line) => line.startsWith("│ "));
      assert.strictEqual(
        quotedLines.length,
        2,
        `Expected 2 quoted lines, got: ${JSON.stringify(plainLines)}`,
      );

      // Both lines should have italic (from theme.quote styling)
      const fooLine = lines.find((line) => line.includes("Foo"));
      const barLine = lines.find((line) => line.includes("bar"));
      assert.ok(fooLine?.includes("\x1b[3m"), `Foo line should have italic: ${fooLine}`);
      assert.ok(barLine?.includes("\x1b[3m"), `bar line should have italic: ${barLine}`);

      // Blockquotes should NOT have the default message color (cyan)
      assert.ok(!fooLine?.includes("\x1b[36m"), `Foo line should NOT have cyan color: ${fooLine}`);
      assert.ok(!barLine?.includes("\x1b[36m"), `bar line should NOT have cyan color: ${barLine}`);
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
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));
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

      // Render at narrow width to force wrapping
      const lines = markdown.render(30);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      // Filter to non-empty lines (exclude trailing blank line after blockquote)
      const contentLines = plainLines.filter((line) => line.length > 0);

      // Should have multiple lines due to wrapping
      assert.ok(
        contentLines.length > 1,
        `Expected multiple wrapped lines, got: ${JSON.stringify(contentLines)}`,
      );

      // Every content line should start with the quote border
      for (const line of contentLines) {
        assert.ok(line.startsWith("│ "), `Wrapped line should have quote border: "${line}"`);
      }

      // All content should be preserved
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
          // This should NOT be applied to blockquotes
          color: (text) => chalk.yellow(text),
          italic: true,
        },
      );

      const lines = markdown.render(25);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      // Filter to non-empty lines
      const contentLines = plainLines.filter((line) => line.length > 0);

      // All lines should have the quote border
      for (const line of contentLines) {
        assert.ok(line.startsWith("│ "), `Line should have quote border: "${line}"`);
      }

      // Check that italic is applied (from theme.quote)
      const allOutput = lines.join("\n");
      assert.ok(allOutput.includes("\x1b[3m"), "Should have italic");

      // Blockquotes should NOT have the default message color (yellow)
      assert.ok(!allOutput.includes("\x1b[33m"), "Should NOT have yellow color from default style");
    });
  });
});

describe("Markdown component", () => {
  describe("Blockquotes with multiline content", () => {
    it("should render inline formatting inside blockquotes and reapply quote styling after", () => {
      const markdown = new Markdown("> Quote with **bold** and `code`", 0, 0, defaultMarkdownTheme);

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));

      // Should have the quote border
      assert.ok(
        plainLines.some((line) => line.startsWith("│ ")),
        "Should have quote border",
      );

      // Content should be preserved
      const allPlain = plainLines.join(" ");
      assert.ok(allPlain.includes("Quote with"), "Should preserve 'Quote with'");
      assert.ok(allPlain.includes("bold"), "Should preserve 'bold'");
      assert.ok(allPlain.includes("code"), "Should preserve 'code'");

      const allOutput = lines.join("\n");

      // Should have bold styling (\x1b[1m)
      assert.ok(allOutput.includes("\x1b[1m"), "Should have bold styling");

      // Should have code styling (yellow = \x1b[33m from defaultMarkdownTheme)
      assert.ok(allOutput.includes("\x1b[33m"), "Should have code styling (yellow)");

      // Should have italic from quote styling (\x1b[3m)
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

      // The heading theme is bold+cyan. After the yellow inline code, the heading
      // styling (bold+cyan) must be restored so subsequent text is styled correctly.
      // bold = \x1b[1m, cyan = \x1b[36m, yellow = \x1b[33m
      assert.ok(joinedOutput.includes("\x1b[33m"), "Should have yellow for inline code");

      // Find the position of "should not be optional" in the raw output.
      // It must be preceded by heading style codes (bold+cyan), not appear unstyled.
      const afterCodeIndex = joinedOutput.indexOf("should not be optional");
      assert.ok(afterCodeIndex > 0, "Should contain text after inline code");

      // Look at the ANSI codes between the code span end and "should not be optional".
      // There should be bold (\x1b[1m) and cyan (\x1b[36m) re-applied.
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
      // H1 uses heading + bold + underline
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
