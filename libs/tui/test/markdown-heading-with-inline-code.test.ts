import assert from "node:assert";
import { afterEach, describe, it } from "node:test";

import { Effect } from "effect";

import ansiSequences from "../src/ansi-sequences.ts";
import tuiModule from "../src/index.ts";
import type tuiTypes from "../src/index.types.ts";
import markdownHelpers from "./markdown-helpers.ts";
import testThemes from "./test-themes.ts";
import virtualTerminal from "./virtual-terminal.ts";

const { Markdown, TuiMainScreen, resetCapabilitiesCache, setCapabilities } = tuiModule;
const { defaultMarkdownTheme } = testThemes;
const { VirtualTerminal } = virtualTerminal;
const { stripEscapeSequences, stripHyperlinkSequences, stripStyleSequences } = ansiSequences;

const { getCell } = markdownHelpers;

describe("Markdown component", () => {
  describe("Heading with inline code", () => {
    it("should not leak h1 underline into padding when inline code is the last token", () =>
      Effect.runPromise(
        Effect.gen(function* () {
          const markdown = new Markdown(
            "# Important distinction from `open()`",
            0,
            0,
            defaultMarkdownTheme,
          );
          const terminal = new VirtualTerminal(80, 4);
          const tui: tuiTypes.TUI = new TuiMainScreen(terminal);
          tui.addChild(markdown);
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());

          const renderedLine = markdown.render(80)[0];
          assert.ok(renderedLine, "Should render heading line");
          const contentWidth = stripStyleSequences(renderedLine).trimEnd().length;
          assert.ok(contentWidth > 0, "Should have visible heading content");

          for (let col = contentWidth; col < 80; col++) {
            assert.strictEqual(
              getCell(terminal, 0, col).isUnderline(),
              0,
              `Expected no underline in padding at col ${col}`,
            );
          }

          tui.stop();
        }),
      ));
  });
});

describe("Markdown component", () => {
  describe("Heading with inline code", () => {
    it("should preserve heading styling after bold text", () => {
      const markdown = new Markdown(
        "## Heading with **bold** and more",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const joinedOutput = lines.join("\n");

      const afterBoldIndex = joinedOutput.indexOf("and more");
      assert.ok(afterBoldIndex > 0, "Should contain text after bold");

      const precedingChunk = joinedOutput.slice(Math.max(0, afterBoldIndex - 40), afterBoldIndex);
      assert.ok(
        precedingChunk.includes("\x1b[1m"),
        `Should re-apply bold for h2: ${precedingChunk}`,
      );
      assert.ok(
        precedingChunk.includes("\x1b[36m"),
        `Should re-apply cyan for h2: ${precedingChunk}`,
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Strikethrough syntax", () => {
    it("should render ~~text~~ as strikethrough", () => {
      const markdown = new Markdown("Use ~~strikethrough~~ here", 0, 0, defaultMarkdownTheme);

      const lines = markdown.render(80);
      const joinedOutput = lines.join("\n");
      const joinedPlain = lines.map((line) => stripStyleSequences(line)).join(" ");

      assert.ok(joinedOutput.includes("\x1b[9m"), "Should apply strikethrough styling");
      assert.ok(joinedPlain.includes("strikethrough"), "Should include struck text content");
      assert.ok(!joinedPlain.includes("~~strikethrough~~"), "Should not render delimiters as text");
    });

    it("should keep ~text~ as plain text", () => {
      const markdown = new Markdown("Use ~strikethrough~ literally", 0, 0, defaultMarkdownTheme);

      const lines = markdown.render(80);
      const joinedOutput = lines.join("\n");
      const joinedPlain = lines.map((line) => stripStyleSequences(line)).join(" ");

      assert.ok(
        joinedPlain.includes("~strikethrough~"),
        "Single-tilde delimiters should remain visible",
      );
      assert.ok(
        !joinedOutput.includes("\x1b[9m"),
        "Single-tilde text should not use strikethrough styling",
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Links", () => {
    afterEach(() => {
      resetCapabilitiesCache();
    });
    it("should not duplicate URL for autolinked emails", () => {
      setCapabilities({ hyperlinks: false, images: null, trueColor: false });
      const markdown = new Markdown(
        "Contact user@example.com for help",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => stripStyleSequences(line));
      const joinedPlain = plainLines.join(" ");

      assert.ok(joinedPlain.includes("user@example.com"), "Should contain email");
      assert.ok(
        !joinedPlain.includes("mailto:"),
        "Should not show mailto: prefix for autolinked emails",
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Links", () => {
    afterEach(() => {
      resetCapabilitiesCache();
    });
    it("should not duplicate URL for bare URLs", () => {
      setCapabilities({ hyperlinks: false, images: null, trueColor: false });
      const markdown = new Markdown(
        "Visit https://example.com for more",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => stripStyleSequences(line));
      const joinedPlain = plainLines.join(" ");

      const urlCount = (joinedPlain.match(/https:\/\/example\.com/gu) || []).length;
      assert.strictEqual(urlCount, 1, "URL should appear exactly once");
    });

    it("should show URL in parentheses when hyperlinks are not supported", () => {
      setCapabilities({ hyperlinks: false, images: null, trueColor: false });
      const markdown = new Markdown(
        "[click here](https://example.com)",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => stripStyleSequences(line));
      const joinedPlain = plainLines.join(" ");

      assert.ok(joinedPlain.includes("click here"), "Should contain link text");
      assert.ok(joinedPlain.includes("(https://example.com)"), "Should show URL in parentheses");
    });
  });
});

describe("Markdown component", () => {
  describe("Links", () => {
    afterEach(() => {
      resetCapabilitiesCache();
    });
    it("should show mailto URL in parentheses when hyperlinks are not supported", () => {
      setCapabilities({ hyperlinks: false, images: null, trueColor: false });
      const markdown = new Markdown(
        "[Email me](mailto:test@example.com)",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => stripStyleSequences(line));
      const joinedPlain = plainLines.join(" ");

      assert.ok(joinedPlain.includes("Email me"), "Should contain link text");
      assert.ok(
        joinedPlain.includes("(mailto:test@example.com)"),
        "Should show mailto URL in parentheses",
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Links", () => {
    afterEach(() => {
      resetCapabilitiesCache();
    });
    it("should emit OSC 8 hyperlink sequence when terminal supports hyperlinks", () => {
      setCapabilities({ hyperlinks: true, images: null, trueColor: false });
      const markdown = new Markdown(
        "[click here](https://example.com)",
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const joined = lines.join("");

      assert.ok(
        joined.includes("\x1b]8;;https://example.com\x1b\\"),
        "Should contain OSC 8 open sequence",
      );
      assert.ok(joined.includes("\x1b]8;;\x1b\\"), "Should contain OSC 8 close sequence");
      const plainLines = lines.map((line) => stripEscapeSequences(line));
      assert.ok(plainLines.join("").includes("click here"), "Should contain link text");
      const rawPlain = lines.map((line) => stripStyleSequences(stripHyperlinkSequences(line)));
      assert.ok(
        !rawPlain.join("").includes("(https://example.com)"),
        "URL should not appear inline in parentheses",
      );
    });
  });
});
