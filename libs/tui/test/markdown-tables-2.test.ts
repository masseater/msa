import assert from "node:assert";
import { describe, it } from "node:test";

import { Markdown } from "../src/components/markdown.ts";
import { resetCapabilitiesCache, setCapabilities } from "../src/terminal-image.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should wrap long cell content to multiple lines", () => {
      const markdown = new Markdown(
        `| Header |
| --- |
| This is a very long cell content that should wrap |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      // Render at width that forces the cell to wrap
      const lines = markdown.render(25);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      // Should have multiple data rows due to wrapping
      const dataRows = plainLines.filter((line) => line.startsWith("│") && !line.includes("─"));
      assert.ok(dataRows.length > 2, `Expected wrapped rows, got ${dataRows.length} rows`);

      // All content should be preserved (may be split across lines)
      const allText = plainLines.join(" ");
      assert.ok(allText.includes("very long"), "Should preserve 'very long'");
      assert.ok(allText.includes("cell content"), "Should preserve 'cell content'");
      assert.ok(allText.includes("should wrap"), "Should preserve 'should wrap'");
    });
  });
});

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should wrap long unbroken tokens inside table cells (not only at line start)", () => {
      // Pin to no-hyperlinks so width checks work on plain text without OSC 8 sequences.
      setCapabilities({ images: null, trueColor: false, hyperlinks: false });
      const url = "https://example.com/this/is/a/very/long/url/that/should/wrap";
      const markdown = new Markdown(
        `| Value |
| --- |
| prefix ${url} |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const width = 30;
      const lines = markdown.render(width);
      resetCapabilitiesCache();
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      for (const line of plainLines) {
        assert.ok(
          line.length <= width,
          `Line exceeds width ${width}: "${line}" (length: ${line.length})`,
        );
      }

      // Borders should stay intact (exactly 2 vertical borders for a 1-col table)
      const tableLines = plainLines.filter((line) => line.startsWith("│"));
      assert.ok(tableLines.length > 0, "Expected table rows to render");
      for (const line of tableLines) {
        const borderCount = line.split("│").length - 1;
        assert.strictEqual(borderCount, 2, `Expected 2 borders, got ${borderCount}: "${line}"`);
      }

      // Strip box drawing characters + whitespace so we can assert the URL is preserved
      // even if it was split across multiple wrapped lines.
      const extracted = plainLines.join("").replace(/[│├┤─\s]/gu, "");
      assert.ok(extracted.includes("prefix"), "Should preserve 'prefix'");
      assert.ok(extracted.includes(url), "Should preserve URL");
    });
  });
});

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should wrap styled inline code inside table cells without breaking borders", () => {
      const markdown = new Markdown(
        `| Code |
| --- |
| \`averyveryveryverylongidentifier\` |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const width = 20;
      const lines = markdown.render(width);
      const joinedOutput = lines.join("\n");
      assert.ok(joinedOutput.includes("\x1b[33m"), "Inline code should be styled (yellow)");

      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());
      for (const line of plainLines) {
        assert.ok(
          line.length <= width,
          `Line exceeds width ${width}: "${line}" (length: ${line.length})`,
        );
      }

      const tableLines = plainLines.filter((line) => line.startsWith("│"));
      for (const line of tableLines) {
        const borderCount = line.split("│").length - 1;
        assert.strictEqual(borderCount, 2, `Expected 2 borders, got ${borderCount}: "${line}"`);
      }
    });
  });
});

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should handle extremely narrow width gracefully", () => {
      const markdown = new Markdown(
        `| A | B | C |
| --- | --- | --- |
| 1 | 2 | 3 |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      // Very narrow width
      const lines = markdown.render(15);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      // Should not crash and should produce output
      assert.ok(lines.length > 0, "Should produce output");

      // Lines should not exceed width
      for (const line of plainLines) {
        assert.ok(line.length <= 15, `Line exceeds width 15: "${line}" (length: ${line.length})`);
      }
    });
  });
});

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should render table correctly when it fits naturally", () => {
      const markdown = new Markdown(
        `| A | B |
| --- | --- |
| 1 | 2 |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      // Wide width where table fits naturally
      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      // Should have proper table structure
      const headerLine = plainLines.find((line) => line.includes("A") && line.includes("B"));
      assert.ok(headerLine, "Should have header row");
      assert.ok(headerLine?.includes("│"), "Header should have borders");

      const separatorLine = plainLines.find((line) => line.includes("├") && line.includes("┼"));
      assert.ok(separatorLine, "Should have separator row");

      const dataLine = plainLines.find((line) => line.includes("1") && line.includes("2"));
      assert.ok(dataLine, "Should have data row");
    });
  });
});

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should respect paddingX when calculating table width", () => {
      const markdown = new Markdown(
        `| Column One | Column Two |
| --- | --- |
| Data 1 | Data 2 |`,
        // paddingX = 2
        2,
        0,
        defaultMarkdownTheme,
      );

      // Width 40 with paddingX=2 means contentWidth=36
      const lines = markdown.render(40);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      // All lines should respect width
      for (const line of plainLines) {
        assert.ok(line.length <= 40, `Line exceeds width 40: "${line}" (length: ${line.length})`);
      }

      // Table rows should have left padding
      const tableRow = plainLines.find((line) => line.includes("│"));
      assert.ok(tableRow?.startsWith("  "), "Table should have left padding");
    });
  });
});

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should not add a trailing blank line when table is the last rendered block", () => {
      const markdown = new Markdown(
        `| Name |
| --- |
| Alice |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, "").trimEnd());

      assert.notStrictEqual(
        plainLines.at(-1),
        "",
        `Expected table to end without a blank line: ${JSON.stringify(plainLines)}`,
      );
    });
  });
});
