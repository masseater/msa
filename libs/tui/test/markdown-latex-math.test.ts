import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import type markdownTypes from "../src/components/markdown.types.ts";
import type tuiComponentTypes from "../src/tui-component.types.ts";
import TuiMainScreen from "../src/tui-main-screen.ts";
import markdownHelpers from "./markdown-helpers.ts";
import markdownLatexMathKit from "./markdown-latex-math-kit.ts";
import testThemes from "./test-themes.ts";
import virtualTerminal from "./virtual-terminal.ts";

const { ansiSequences, Markdown } = markdownLatexMathKit;

const { defaultMarkdownTheme } = testThemes;
const { VirtualTerminal } = virtualTerminal;

const { stripStyleSequences } = ansiSequences;

const { chalk, getCell, stripAnsi } = markdownHelpers;

describe("Markdown component", () => {
  describe("LaTeX math", () => {
    it("allows LaTeX rendering to be disabled", () => {
      const markdown = new Markdown(
        String.raw`$$
\widetilde Y_{sf}
=
(1-w_{sf})\mu_{sf}^{\mathrm{MAR}}
$$

Inline \(A_{sf}\)`,
        0,
        0,
        defaultMarkdownTheme,
        undefined,
        {
          renderLatex: false,
        },
      );

      assert.deepStrictEqual(
        markdown.render(80).map((line) => stripAnsi(line).trimEnd()),
        [
          "$$",
          String.raw`\widetilde Y_{sf}`,
          "=",
          String.raw`(1-w_{sf})\mu_{sf}^{\mathrm{MAR}}`,
          "$$",
          "",
          String.raw`Inline \(A_{sf}\)`,
        ],
      );
    });
  });
});

describe("Markdown component", () => {
  describe("LaTeX math", () => {
    it("switches from raw to rendered math when a streamed delimiter closes", () => {
      const markdown = new Markdown(String.raw`Map $\mathbb{C}^3`, 0, 0, defaultMarkdownTheme);
      assert.deepStrictEqual(
        markdown.render(80).map((line) => stripAnsi(line).trimEnd()),
        [String.raw`Map $\mathbb{C}^3`],
      );

      markdown.setText(String.raw`Map $\mathbb{C}^3$`);

      assert.deepStrictEqual(
        markdown.render(80).map((line) => stripAnsi(line).trimEnd()),
        ["Map ℂ³"],
      );
    });
  });
});

describe("Markdown component", () => {
  describe("Backslash escapes", () => {
    it("should normalize escaped punctuation by default", () => {
      const markdown = new Markdown(String.raw`"\"`, 0, 0, defaultMarkdownTheme);

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, [`""`]);
    });

    it("should preserve source backslash escapes when configured", () => {
      const markdown = new Markdown(String.raw`"\"`, 0, 0, defaultMarkdownTheme, undefined, {
        preserveBackslashEscapes: true,
      });

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, [String.raw`"\"`]);
    });
  });
});

describe("Markdown component", () => {
  describe("Pre-styled text (thinking traces)", () => {
    it("should preserve gray italic styling after inline code", () => {
      const markdown = new Markdown(
        "This is thinking with `inline code` and more text after",
        1,
        0,
        defaultMarkdownTheme,
        {
          color: (text) => chalk.gray(text),
          italic: true,
        },
      );

      const lines = markdown.render(80);
      const joinedOutput = lines.join("\n");

      assert.ok(joinedOutput.includes("inline code"));

      assert.ok(joinedOutput.includes("\x1b[90m"), "Should have gray color code");
      assert.ok(joinedOutput.includes("\x1b[3m"), "Should have italic code");

      const hasCodeColor = joinedOutput.includes("\x1b[33m");
      assert.ok(hasCodeColor, "Should style inline code");
    });
  });
});

describe("Markdown component", () => {
  describe("Pre-styled text (thinking traces)", () => {
    it("should preserve gray italic styling after bold text", () => {
      const markdown = new Markdown(
        "This is thinking with **bold text** and more after",
        1,
        0,
        defaultMarkdownTheme,
        {
          color: (text) => chalk.gray(text),
          italic: true,
        },
      );

      const lines = markdown.render(80);
      const joinedOutput = lines.join("\n");

      assert.ok(joinedOutput.includes("bold text"));

      assert.ok(joinedOutput.includes("\x1b[90m"), "Should have gray color code");
      assert.ok(joinedOutput.includes("\x1b[3m"), "Should have italic code");

      assert.ok(joinedOutput.includes("\x1b[1m"), "Should have bold code");
    });
  });
});

describe("Markdown component", () => {
  describe("Pre-styled text (thinking traces)", () => {
    preStyledTextThinkingCases4();
  });
});

function preStyledTextThinkingCases4(): void {
  it("should not leak styles into following lines when rendered in TUI", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        class MarkdownWithInput implements tuiComponentTypes.Component {
          public markdownLineCount = 0;
          private readonly markdown: markdownTypes.Markdown;

          constructor(markdown: markdownTypes.Markdown) {
            this.markdown = markdown;
          }

          render(width: number): string[] {
            const lines = this.markdown.render(width);
            this.markdownLineCount = lines.length;
            return [...lines, "INPUT"];
          }

          invalidate(): void {
            this.markdown.invalidate();
          }
        }

        const markdown = new Markdown(
          "This is thinking with `inline code`",
          1,
          0,
          defaultMarkdownTheme,
          {
            color: (text) => chalk.gray(text),
            italic: true,
          },
        );

        const terminal = new VirtualTerminal(80, 6);
        const tui = new TuiMainScreen(terminal);
        const component = new MarkdownWithInput(markdown);
        tui.addChild(component);
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        assert.ok(component.markdownLineCount > 0);
        const inputRow = component.markdownLineCount;
        assert.strictEqual(getCell(terminal, inputRow, 0).isItalic(), 0);
        tui.stop();
      }),
    ));
}

describe("Markdown component", () => {
  describe("Spacing after code blocks", () => {
    it("should have only one blank line between code block and following paragraph", () => {
      const markdown = new Markdown(
        `hello world

\`\`\`js
const hello = "world";
\`\`\`

again, hello world`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => stripStyleSequences(line).trimEnd());

      const closingBackticksIndex = plainLines.indexOf("```");
      assert.ok(closingBackticksIndex !== -1, "Should have closing backticks");

      const afterBackticks = plainLines.slice(closingBackticksIndex + 1);
      const emptyLineCount = afterBackticks.findIndex((line) => line !== "");

      assert.strictEqual(
        emptyLineCount,
        1,
        `Expected 1 empty line after code block, but found ${emptyLineCount}. Lines after backticks: ${JSON.stringify(afterBackticks.slice(0, 5))}`,
      );
    });
  });
});
