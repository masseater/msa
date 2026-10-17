import assert from "node:assert";
import { describe, it } from "node:test";

import { Markdown } from "../src/components/markdown.ts";
import { stripAnsi } from "./markdown-helpers.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

describe("Markdown component", () => {
  describe("Lists", () => {
    listsCases1();
  });
});

function listsCases1(): void {
  it("should maintain numbering when code blocks are not indented (LLM output)", () => {
    const markdown = new Markdown(
      `1. First item

\`\`\`typescript
// code block
\`\`\`

2. Second item

\`\`\`typescript
// another code block
\`\`\`

3. Third item`,
      0,
      0,
      defaultMarkdownTheme,
    );

    const lines = markdown.render(80);
    const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trim());

    const numberedLines = plainLines.filter((line) => /^\d+\./u.test(line));

    assert.strictEqual(
      numberedLines.length,
      3,
      `Expected 3 numbered items, got: ${numberedLines.join(", ")}`,
    );

    assert.ok(
      numberedLines[0]?.startsWith("1."),
      `First item should be "1.", got: ${numberedLines[0]}`,
    );
    assert.ok(
      numberedLines[1]?.startsWith("2."),
      `Second item should be "2.", got: ${numberedLines[1]}`,
    );
    assert.ok(
      numberedLines[2]?.startsWith("3."),
      `Third item should be "3.", got: ${numberedLines[2]}`,
    );
  });
}

describe("Markdown component", () => {
  describe("Lists", () => {
    it("should indent wrapped unordered list lines", () => {
      const markdown = new Markdown("- alpha beta gamma delta epsilon", 0, 0, defaultMarkdownTheme);

      const lines = markdown.render(20).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["- alpha beta gamma", "  delta epsilon"]);
    });

    it("should indent wrapped ordered list lines", () => {
      const markdown = new Markdown(
        "1. alpha beta gamma delta epsilon",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(20).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["1. alpha beta gamma", "   delta epsilon"]);
    });

    it("should indent wrapped ordered list lines with multi-digit markers", () => {
      const markdown = new Markdown(
        "10. alpha beta gamma delta epsilon",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(21).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["10. alpha beta gamma", "    delta epsilon"]);
    });
  });
});

describe("Markdown component", () => {
  describe("Lists", () => {
    it("should indent wrapped nested list lines", () => {
      const markdown = new Markdown(
        `- parent\n  - alpha beta gamma delta epsilon`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(24).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["- parent", "    - alpha beta gamma", "      delta epsilon"]);
    });

    it("should indent wrapped nested list lines under ordered parents", () => {
      const markdown = new Markdown(
        `1. parent\n   - alpha beta gamma delta epsilon`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(24).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["1. parent", "    - alpha beta gamma", "      delta epsilon"]);
    });

    it("should render and wrap blockquotes inside list items", () => {
      const markdown = new Markdown(
        "- > alpha beta gamma delta epsilon zeta",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(24).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["- │ alpha beta gamma", "  │ delta epsilon zeta"]);
    });
  });
});

describe("Markdown component", () => {
  describe("Lists", () => {
    it("should render and wrap code blocks inside list items", () => {
      const markdown = new Markdown(
        "- ```ts\n  alpha beta gamma delta epsilon zeta\n  ```",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(24).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, [
        "- ```ts",
        "    alpha beta gamma",
        "  delta epsilon zeta",
        "  ```",
      ]);
    });
  });
});

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should render simple table", () => {
      const markdown = new Markdown(
        `| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));

      assert.ok(plainLines.some((line) => line.includes("Name")));
      assert.ok(plainLines.some((line) => line.includes("Age")));
      assert.ok(plainLines.some((line) => line.includes("Alice")));
      assert.ok(plainLines.some((line) => line.includes("Bob")));
      assert.ok(plainLines.some((line) => line.includes("│")));
      assert.ok(plainLines.some((line) => line.includes("─")));
    });

    it("should render row dividers between data rows", () => {
      const markdown = new Markdown(
        `| Name | Age |
| --- | --- |
| Alice | 30 |
| Bob | 25 |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));
      const dividerLines = plainLines.filter((line) => line.includes("┼"));

      assert.strictEqual(dividerLines.length, 2, "Expected header + row divider");
    });
  });
});

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should keep column width at least the longest word", () => {
      const longestWord = "superlongword";
      const markdown = new Markdown(
        `| Column One | Column Two |
| --- | --- |
| ${longestWord} short | otherword |
| small | tiny |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(32);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));
      const dataLine = plainLines.find((line) => line.includes(longestWord));
      assert.ok(dataLine, "Expected data row containing longest word");

      const segments = dataLine.split("│").slice(1, -1);
      const [firstSegment] = segments;
      assert.ok(firstSegment, "Expected first column segment");
      const firstColumnWidth = firstSegment.length - 2;

      assert.ok(
        firstColumnWidth >= longestWord.length,
        `Expected first column width >= ${longestWord.length}, got ${firstColumnWidth}`,
      );
    });
  });
});
