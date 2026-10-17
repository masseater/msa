import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { stripStyleSequences } from "../src/ansi-sequences.ts";
import { Markdown, type MarkdownTheme } from "../src/components/markdown.ts";
import { resetCapabilitiesCache, setCapabilities } from "../src/terminal-image.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import type { TUI } from "../src/tui.ts";
import { toJson } from "./effect-helpers.ts";
import { getCell } from "./markdown-helpers.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

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

describe("Markdown component", () => {
  describe("Tables", () => {
    tablesCases2();
  });
});

function tablesCases2(): void {
  it("should not leak wrapped link styles into table borders or plain cells", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const source = `| Link | Plain |
| --- | --- |
| [**one two three four five six**](https://example.com) | normal text |`;

        yield* Effect.gen(function* () {
          for (const hyperlinks of [true, false]) {
            setCapabilities({ images: null, trueColor: false, hyperlinks });
            const terminal = new VirtualTerminal(24, 16);
            const tui: TUI = new TuiMainScreen(terminal);
            tui.addChild(new Markdown(source, 0, 0, defaultMarkdownTheme));
            tui.start();

            yield* Effect.gen(function* () {
              yield* Effect.promise(() => terminal.waitForRender());
              const viewport = terminal.getViewport();
              const row = viewport.findIndex(
                (line) => line.includes("one") && line.includes("norm"),
              );
              assert.notStrictEqual(
                row,
                -1,
                `Missing wrapped table row: ${yield* toJson(viewport)}`,
              );
              const line = viewport[row];
              assert.ok(line !== undefined);
              const linkCol = line.indexOf("one");
              const separatorCol = line.indexOf("│", linkCol);
              const plainCol = line.indexOf("norm");
              assert.ok(linkCol >= 0 && separatorCol > linkCol && plainCol > separatorCol);
              assert.strictEqual(getCell(terminal, row, linkCol).isFgDefault(), false);
              assert.strictEqual(getCell(terminal, row, separatorCol).isFgDefault(), true);
              assert.strictEqual(getCell(terminal, row, plainCol).isFgDefault(), true);
              assert.notStrictEqual(getCell(terminal, row, linkCol).isBold(), 0);
              assert.strictEqual(getCell(terminal, row, separatorCol).isBold(), 0);
              assert.strictEqual(getCell(terminal, row, plainCol).isBold(), 0);

              if (!hyperlinks) {
                const urlRow = viewport.findIndex((viewportLine) => viewportLine.includes("https"));
                assert.notStrictEqual(
                  urlRow,
                  -1,
                  `Missing fallback URL row: ${yield* toJson(viewport)}`,
                );
                const urlLine = viewport[urlRow];
                assert.ok(urlLine !== undefined);
                const urlCol = urlLine.indexOf("https");
                const urlSeparatorCol = urlLine.indexOf("│", urlCol);
                const urlBorderCol = urlLine.lastIndexOf("│");
                assert.ok(
                  urlCol >= 0 && urlSeparatorCol > urlCol && urlBorderCol > urlSeparatorCol,
                );
                assert.notStrictEqual(getCell(terminal, urlRow, urlCol).isDim(), 0);
                assert.strictEqual(getCell(terminal, urlRow, urlSeparatorCol).isDim(), 0);
                assert.strictEqual(getCell(terminal, urlRow, urlBorderCol).isDim(), 0);
              }
            }).pipe(
              Effect.ensuring(
                Effect.sync(() => {
                  tui.stop();
                }),
              ),
            );
          }
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              resetCapabilitiesCache();
            }),
          ),
        );
      }),
    ));
}

describe("Markdown component", () => {
  describe("Tables", () => {
    tablesCases3();
  });
});

function tablesCases3(): void {
  it("should restore the enclosing style after a wrapped table link", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const quoteColor = 0x123456;
        const theme: MarkdownTheme = {
          ...defaultMarkdownTheme,
          quote: (text) => `\x1b[38;2;18;52;86m${text}\x1b[39m`,
          link: (text) => `\x1b[38;2;129;162;190m${text}\x1b[39m`,
        };
        const source = `> | Link | Plain |
> | --- | --- |
> | [one two three four five six](https://example.com) | normal text |`;

        setCapabilities({ images: null, trueColor: true, hyperlinks: true });
        const terminal = new VirtualTerminal(28, 10);
        const tui: TUI = new TuiMainScreen(terminal);
        tui.addChild(new Markdown(source, 0, 0, theme));
        tui.start();

        yield* Effect.gen(function* () {
          yield* Effect.promise(() => terminal.waitForRender());
          const viewport = terminal.getViewport();
          const row = viewport.findIndex((line) => line.includes("one") && line.includes("normal"));
          assert.notStrictEqual(
            row,
            -1,
            `Missing wrapped blockquote table row: ${yield* toJson(viewport)}`,
          );
          const line = viewport[row];
          assert.ok(line !== undefined);
          const linkCol = line.indexOf("one");
          const separatorCol = line.indexOf("│", linkCol);
          const plainCol = line.indexOf("normal");
          assert.ok(linkCol >= 0 && separatorCol > linkCol && plainCol > separatorCol);

          assert.notStrictEqual(getCell(terminal, row, linkCol).getFgColor(), quoteColor);
          assert.strictEqual(getCell(terminal, row, separatorCol).getFgColor(), quoteColor);
          assert.strictEqual(getCell(terminal, row, plainCol).getFgColor(), quoteColor);

          const finalRow = viewport.findIndex((viewportLine) => viewportLine.includes("five six"));
          assert.notStrictEqual(
            finalRow,
            -1,
            `Missing final wrapped link row: ${yield* toJson(viewport)}`,
          );
          const finalLine = viewport[finalRow];
          assert.ok(finalLine !== undefined);
          const finalLinkCol = finalLine.indexOf("five six");
          const finalSeparatorCol = finalLine.indexOf("│", finalLinkCol);
          const finalBorderCol = finalLine.lastIndexOf("│");
          assert.ok(
            finalLinkCol >= 0 &&
              finalSeparatorCol > finalLinkCol &&
              finalBorderCol > finalSeparatorCol,
          );
          assert.strictEqual(
            getCell(terminal, finalRow, finalSeparatorCol).getFgColor(),
            quoteColor,
          );
          assert.strictEqual(getCell(terminal, finalRow, finalBorderCol).getFgColor(), quoteColor);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              tui.stop();
              resetCapabilitiesCache();
            }),
          ),
        );
      }),
    ));
}
