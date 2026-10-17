import assert from "node:assert";
import { describe, it } from "node:test";

import { Markdown } from "../src/components/markdown.ts";
import { stripAnsi } from "./markdown-helpers.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";

describe("Markdown component", () => {
  describe("Combined features", () => {
    it("should render lists and tables together", () => {
      const markdown = new Markdown(
        `# Test Document

- Item 1
  - Nested item
- Item 2

| Col1 | Col2 |
| --- | --- |
| A | B |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80);
      const plainLines = lines.map((line) => line.replace(/\x1b\[[0-9;]*m/gu, ""));

      assert.ok(plainLines.some((line) => line.includes("Test Document")));
      assert.ok(plainLines.some((line) => line.includes("- Item 1")));
      assert.ok(plainLines.some((line) => line.includes("    - Nested item")));
      assert.ok(plainLines.some((line) => line.includes("Col1")));
      assert.ok(plainLines.some((line) => line.includes("│")));
    });
  });
});

describe("Markdown component", () => {
  describe("LaTeX math", () => {
    it("renders inline dollar and parenthesis delimiters", () => {
      const markdown = new Markdown(
        String.raw`A map $\mathbb{C}^3 \to \mathbb{C}^3$, $xy$, $x-y$, $-x$, $\frac{1}{2}$, $\rightarrow$, and \(s \to \infty\).`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["A map ℂ³ → ℂ³, xy, x-y, -x, 1/2, →, and s → ∞."]);
    });

    it("renders display dollar delimiters without Markdown escape corruption", () => {
      const markdown = new Markdown(
        String.raw`Before

$$\{3x+2y,\; x \in \{0, \pm 1\}\}$$

after`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["Before", "", "{3x+2y, x ∈ {0, ± 1}}", "", "after"]);
    });
  });
});

describe("Markdown component", () => {
  describe("LaTeX math", () => {
    it("renders display bracket delimiters", () => {
      const markdown = new Markdown(
        String.raw`Before

\[
E \approx \frac{0.1\ \text{lux}}{100\ \text{lm/W}}
\]

after`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, [
        "Before",
        "",
        "    0.1 lux",
        "E ≈ ────────",
        "    100 lm/W",
        "",
        "after",
      ]);
    });
  });
});

describe("Markdown component", () => {
  describe("LaTeX math", () => {
    it("aligns matrix rows with the opening delimiter", () => {
      const markdown = new Markdown(
        String.raw`Consider the matrix

\[
A=
\begin{pmatrix}
\pi & 0\\
0 & \frac{1}{\pi}
\end{pmatrix}.
\]`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, [
        "Consider the matrix",
        "",
        "A = ⎛ π │ 0   ⎞",
        "    ⎝ 0 │ 1/π ⎠.",
      ]);
    });
  });
});

describe("Markdown component", () => {
  describe("LaTeX math", () => {
    it("renders lower limits beneath display operators", () => {
      const markdown = new Markdown(
        String.raw`\[
\lim_{x\to 0}\frac{\frac{\sin x}{x}-1}{\frac{e^x-1}{x}-1}=0
\]`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, [
        "     (sin x)/x-1",
        "lim  ─────────── = 0",
        "x→0  (eˣ-1)/x-1",
      ]);
    });

    it("renders math inside lists and tables", () => {
      const markdown = new Markdown(
        String.raw`- Formula: $F_1 = u^2$

| Value |
| --- |
| $\mathbb{C}^3$ |`,
        0,
        0,
        defaultMarkdownTheme,
      );

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());
      const output = lines.join("\n");

      assert.ok(output.includes("- Formula: F₁ = u²"));
      assert.ok(output.includes("│ ℂ³"));
    });
  });
});

describe("Markdown component", () => {
  describe("LaTeX math", () => {
    it("does not treat currency, shell variables, or code spans as math", () => {
      const source = "Costs $5 and $10 or $8k–$12k; use `$x$`, $HOME, and ${PATH}.";
      const markdown = new Markdown(source, 0, 0, defaultMarkdownTheme);

      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["Costs $5 and $10 or $8k–$12k; use $x$, $HOME, and ${PATH}."]);

      const shellVariables = "Paths: $HOME/$USER and $XDG_CONFIG_HOME/$APP_CONFIG";
      const shellLines = new Markdown(shellVariables, 0, 0, defaultMarkdownTheme)
        .render(80)
        .map((line) => stripAnsi(line).trimEnd());
      assert.deepStrictEqual(shellLines, [shellVariables]);
    });

    it("preserves unsupported and incomplete LaTeX exactly", () => {
      const cases = [
        String.raw`Unknown $x + \unknown{y}$ after`,
        String.raw`Streaming $\mathbb{C}^3`,
      ];

      for (const source of cases) {
        const markdown = new Markdown(source, 0, 0, defaultMarkdownTheme);
        const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());
        assert.deepStrictEqual(lines, [source]);
      }
    });

    it("preserves incomplete backslash delimiters while streaming", () => {
      const inline = new Markdown(String.raw`Map \(\mathbb{C}^3`, 0, 0, defaultMarkdownTheme);
      assert.deepStrictEqual(
        inline.render(80).map((line) => stripAnsi(line).trimEnd()),
        [String.raw`Map \(\mathbb{C}^3`],
      );

      const display = new Markdown("\\[\nx^2", 0, 0, defaultMarkdownTheme);
      assert.deepStrictEqual(
        display.render(80).map((line) => stripAnsi(line).trimEnd()),
        ["\\[", "x^2"],
      );
    });
  });
});

describe("Markdown component", () => {
  describe("LaTeX math", () => {
    it("does not render LaTeX inside escaped delimiters or code fences", () => {
      const source = [
        String.raw`Escaped \$x-y\$.`,
        "",
        "```text",
        String.raw`$\mathbb{C}^3$`,
        "```",
      ].join("\n");
      const markdown = new Markdown(source, 0, 0, defaultMarkdownTheme);
      const lines = markdown.render(80).map((line) => stripAnsi(line).trimEnd());

      assert.deepStrictEqual(lines, ["Escaped $x-y$.", "", "```text", "  $\\mathbb{C}^3$", "```"]);
    });
  });
});
