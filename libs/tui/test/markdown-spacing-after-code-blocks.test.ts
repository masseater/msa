import assert from "node:assert";
import { describe, it } from "node:test";

import { Markdown } from "../src/components/markdown.ts";
import { chalk } from "./markdown-helpers.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

describe("Markdown component", () => {
  describe("Spacing after code blocks", () => {
    it("should normalize paragraph and code block spacing to one blank line", () => {
      const cases = [
        `hello this is text
\`\`\`
code block
\`\`\`
more text`,
        `hello this is text

\`\`\`
code block
\`\`\`

more text`,
      ];
      const expectedLines = [
        "hello this is text",
        "",
        "```",
        "  code block",
        "```",
        "",
        "more text",
      ];

      for (const text of cases) {
        const markdown = new Markdown(text, 0, 0, defaultMarkdownTheme);
        const lines = markdown.render(80);
        const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

        assert.deepStrictEqual(
          plainLines,
          expectedLines,
          `Unexpected spacing for markdown: ${JSON.stringify(text)}`,
        );
      }
    });
  });
});

describe("Markdown component", () => {
  describe("Spacing after code blocks", () => {
    it("should not add a trailing blank line when code block is the last rendered block", () => {
      const cases = [
        "```js\nconst hello = 'world';\n```",
        "hello world\n\n```js\nconst hello = 'world';\n```",
      ];

      for (const text of cases) {
        const markdown = new Markdown(text, 0, 0, defaultMarkdownTheme);
        const lines = markdown.render(80);
        const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

        assert.notStrictEqual(
          plainLines.at(-1),
          "",
          `Expected code block to end without a blank line: ${JSON.stringify(plainLines)}`,
        );
      }
    });
  });
});

describe("Markdown component", () => {
  describe("Spacing after dividers", () => {
    it("should have only one blank line between divider and following paragraph", () => {
      const markdown = new Markdown(
        `hello world

---

again, hello world`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      const dividerIndex = plainLines.findIndex((line) => line.includes("─"));
      assert.ok(dividerIndex !== -1, "Should have divider");

      const afterDivider = plainLines.slice(dividerIndex + 1);
      const emptyLineCount = afterDivider.findIndex((line) => line !== "");

      assert.strictEqual(
        emptyLineCount,
        1,
        `Expected 1 empty line after divider, but found ${emptyLineCount}. Lines after divider: ${JSON.stringify(afterDivider.slice(0, 5))}`,
      );
    });

    it("should not add a trailing blank line when divider is the last rendered block", () => {
      const markdown = new Markdown("---", 0, 0, defaultMarkdownTheme);
      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      assert.notStrictEqual(
        plainLines.at(-1),
        "",
        `Expected divider to end without a blank line: ${JSON.stringify(plainLines)}`,
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Spacing after headings", () => {
    it("should have only one blank line between heading and following paragraph", () => {
      const markdown = new Markdown(
        `# Hello

This is a paragraph`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      const headingIndex = plainLines.findIndex((line) => line.includes("Hello"));
      assert.ok(headingIndex !== -1, "Should have heading");

      const afterHeading = plainLines.slice(headingIndex + 1);
      const emptyLineCount = afterHeading.findIndex((line) => line !== "");

      assert.strictEqual(
        emptyLineCount,
        1,
        `Expected 1 empty line after heading, but found ${emptyLineCount}. Lines after heading: ${JSON.stringify(afterHeading.slice(0, 5))}`,
      );
    });

    it("should not add a trailing blank line when heading is the last rendered block", () => {
      const markdown = new Markdown("# Hello", 0, 0, defaultMarkdownTheme);
      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      assert.notStrictEqual(
        plainLines.at(-1),
        "",
        `Expected heading to end without a blank line: ${JSON.stringify(plainLines)}`,
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Spacing after blockquotes", () => {
    it("should have only one blank line between blockquote and following paragraph", () => {
      const markdown = new Markdown(
        `hello world

> This is a quote

again, hello world`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      const quoteIndex = plainLines.findIndex((line) => line.includes("This is a quote"));
      assert.ok(quoteIndex !== -1, "Should have blockquote");

      const afterQuote = plainLines.slice(quoteIndex + 1);
      const emptyLineCount = afterQuote.findIndex((line) => line !== "");

      assert.strictEqual(
        emptyLineCount,
        1,
        `Expected 1 empty line after blockquote, but found ${emptyLineCount}. Lines after quote: ${JSON.stringify(afterQuote.slice(0, 5))}`,
      );
    });

    it("should not add a trailing blank line when blockquote is the last rendered block", () => {
      const markdown = new Markdown("> This is a quote", 0, 0, defaultMarkdownTheme);
      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      assert.notStrictEqual(
        plainLines.at(-1),
        "",
        `Expected blockquote to end without a blank line: ${JSON.stringify(plainLines)}`,
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Blockquotes with multiline content", () => {
    blockquotesWithMultilineContentCases5();
  });
});

function blockquotesWithMultilineContentCases5(): void {
  it("should apply consistent styling to all lines in lazy continuation blockquote", () => {
    const markdown = new Markdown(
      `>Foo
bar`,
      0,
      0,
      defaultMarkdownTheme,
      {
        color: (text) => chalk.magenta(text),
      },
    );

    const lines = markdown.render(80);

    const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));
    const quotedLines = plainLines.filter((line) => line.startsWith("│ "));
    assert.strictEqual(
      quotedLines.length,
      2,
      `Expected 2 quoted lines, got: ${JSON.stringify(plainLines)}`,
    );

    const fooLine = lines.find((line) => line.includes("Foo"));
    const barLine = lines.find((line) => line.includes("bar"));
    assert.ok(fooLine, "Should have Foo line");
    assert.ok(barLine, "Should have bar line");

    assert.ok(fooLine?.includes("\x1b[3m"), `Foo line should have italic: ${fooLine}`);
    assert.ok(barLine?.includes("\x1b[3m"), `bar line should have italic: ${barLine}`);

    assert.ok(!fooLine?.includes("\x1b[35m"), `Foo line should NOT have magenta color: ${fooLine}`);
    assert.ok(!barLine?.includes("\x1b[35m"), `bar line should NOT have magenta color: ${barLine}`);
  });
}
