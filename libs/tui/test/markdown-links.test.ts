import assert from "node:assert";
import { afterEach, describe, it } from "node:test";

import { Markdown } from "../src/components/markdown.ts";
import { resetCapabilitiesCache, setCapabilities } from "../src/terminal-image.ts";
import { stripAnsi } from "./markdown-helpers.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

describe("Markdown component", () => {
  describe("Links", () => {
    afterEach(() => {
      resetCapabilitiesCache();
    });
    it("should use OSC 8 for mailto links when terminal supports hyperlinks", () => {
      setCapabilities({ images: null, trueColor: false, hyperlinks: true });
      const markdown = new Markdown(
        "[Email me](mailto:test@example.com)",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const joined = lines.join("");

      assert.ok(
        joined.includes("\x1b]8;;mailto:test@example.com\x1b\\"),
        "Should contain OSC 8 open with mailto URL",
      );
      assert.ok(joined.includes("\x1b]8;;\x1b\\"), "Should contain OSC 8 close sequence");
    });
  });
});

describe("Markdown component", () => {
  describe("Links", () => {
    afterEach(() => {
      resetCapabilitiesCache();
    });
    it("should use OSC 8 for bare URLs when terminal supports hyperlinks", () => {
      setCapabilities({ images: null, trueColor: false, hyperlinks: true });
      const markdown = new Markdown(
        "Visit https://example.com for more",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const joined = lines.join("");

      assert.ok(
        joined.includes("\x1b]8;;https://example.com\x1b\\"),
        "Should contain OSC 8 hyperlink",
      );
      // URL should not also appear as raw parenthetical text
      const rawPlain = lines.map((line) =>
        line.replace(/\x1b\]8;;[^\x1b]*\x1b\\/gu, "").replace(/\x1b\[[0-9;]*m/gu, ""),
      );
      assert.ok(
        !rawPlain.join("").includes("(https://example.com)"),
        "URL should not appear twice",
      );
    });
  });
});

describe("Markdown component", () => {
  describe("HTML-like tags in text", () => {
    it("should render content with HTML-like tags as text", () => {
      // When the model emits something like <thinking>content</thinking> in regular text,
      // marked might treat it as HTML and hide the content
      const markdown = new Markdown(
        "This is text with <thinking>hidden content</thinking> that should be visible",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));
      const joinedPlain = plainLines.join(" ");

      // The content inside the tags should be visible
      assert.ok(
        joinedPlain.includes("hidden content") || joinedPlain.includes("<thinking>"),
        "Should render HTML-like tags or their content as text, not hide them",
      );
    });

    it("should render HTML tags in code blocks correctly", () => {
      const markdown = new Markdown(
        "```html\n<div>Some HTML</div>\n```",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));
      const joinedPlain = plainLines.join("\n");

      // HTML in code blocks should be visible
      assert.ok(
        joinedPlain.includes("<div>") && joinedPlain.includes("</div>"),
        "Should render HTML in code blocks",
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Streaming code fences", () => {
    it("stabilizes partial closing fence rendering", () => {
      const cases = [
        {
          input: "```ts\nconst x = 1;\n``",
          expected: ["```ts", "  const x = 1;", "```"],
        },
        {
          input: "```md\nnot a closing fence:\n``\n```",
          expected: ["```md", "  not a closing fence:", "  ``", "```"],
        },
        {
          input: "```ts\n``",
          expected: ["```ts", "", "```"],
        },
        {
          input: "````\n```",
          expected: ["```", "", "```"],
        },
        {
          input: "~~~~~\n~~~~",
          expected: ["```", "", "```"],
        },
        {
          input: "```md\nnot a closing fence:\n``\n```\n\nafter",
          expected: ["```md", "  not a closing fence:", "  ``", "```", "", "after"],
        },
      ];

      for (const { input, expected } of cases) {
        const markdown = new Markdown(input, 0, 0, defaultMarkdownTheme);
        const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

        assert.deepStrictEqual(lines, expected);
      }

      const partial = new Markdown("```ts\nconst x = 1;\n``", 0, 0, defaultMarkdownTheme);
      const complete = new Markdown("```ts\nconst x = 1;\n```", 0, 0, defaultMarkdownTheme);

      assert.strictEqual(partial.render(80).length, complete.render(80).length);
    });
  });
});
