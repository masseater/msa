import assert from "node:assert";
import { describe, it } from "node:test";

import { stripStyleSequences } from "../src/ansi-sequences.ts";
import { Markdown } from "../src/components/markdown.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should render table with alignment", () => {
      const markdown = new Markdown(
        `| Left | Center | Right |
| :--- | :---: | ---: |
| A | B | C |
| Long text | Middle | End |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => stripStyleSequences(line));

      assert.ok(plainLines.some((line) => line.includes("Left")));
      assert.ok(plainLines.some((line) => line.includes("Center")));
      assert.ok(plainLines.some((line) => line.includes("Right")));
      assert.ok(plainLines.some((line) => line.includes("Long text")));
    });
  });
});

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should handle tables with varying column widths", () => {
      const markdown = new Markdown(
        `| Short | Very long column header |
| --- | --- |
| A | This is a much longer cell content |
| B | Short |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);

      assert.ok(lines.length > 0);

      const plainLines = lines.map((line) => stripStyleSequences(line));
      assert.ok(plainLines.some((line) => line.includes("Very long column header")));
      assert.ok(plainLines.some((line) => line.includes("This is a much longer cell content")));
    });
  });
});

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should wrap table cells when table exceeds available width", () => {
      const markdown = new Markdown(
        `| Command | Description | Example |
| --- | --- | --- |
| npm install | Install all dependencies | npm install |
| npm run build | Build the project | npm run build |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(50);
      const plainLines = lines.map((line) => stripStyleSequences(line).trimEnd());

      for (const line of plainLines) {
        assert.ok(line.length <= 50, `Line exceeds width 50: "${line}" (length: ${line.length})`);
      }

      const allText = plainLines.join(" ");
      assert.ok(allText.includes("Command"), "Should contain 'Command'");
      assert.ok(allText.includes("Description"), "Should contain 'Description'");
      assert.ok(allText.includes("npm install"), "Should contain 'npm install'");
      assert.ok(allText.includes("Install"), "Should contain 'Install'");
    });
  });
});
