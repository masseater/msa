import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { type MarkdownTheme } from "../src/components/markdown.ts";
import { resetCapabilitiesCache, setCapabilities } from "../src/terminal-capabilities.ts";
import markdownHelpers from "./markdown-helpers.ts";
import markdownTerminalHelpers from "./markdown-terminal-helpers.ts";
import { defaultMarkdownTheme } from "./test-themes.ts";
import type { VirtualTerminal } from "./virtual-terminal.ts";

const { getCell } = markdownHelpers;
const { findViewportRow, renderMarkdownInTerminal } = markdownTerminalHelpers;

const wrappedLinkSource = `| Link | Plain |
| --- | --- |
| [**one two three four five six**](https://example.com) | normal text |`;

const assertWrappedLinkRow = (terminal: VirtualTerminal): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { row, line } = yield* findViewportRow(
      terminal.getViewport(),
      (viewportLine) => viewportLine.includes("one") && viewportLine.includes("norm"),
      "Missing wrapped table row",
    );
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
  });

const assertFallbackUrlRow = (terminal: VirtualTerminal): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { row, line } = yield* findViewportRow(
      terminal.getViewport(),
      (viewportLine) => viewportLine.includes("https"),
      "Missing fallback URL row",
    );
    const urlCol = line.indexOf("https");
    const urlSeparatorCol = line.indexOf("│", urlCol);
    const urlBorderCol = line.lastIndexOf("│");
    assert.ok(urlCol >= 0 && urlSeparatorCol > urlCol && urlBorderCol > urlSeparatorCol);
    assert.notStrictEqual(getCell(terminal, row, urlCol).isDim(), 0);
    assert.strictEqual(getCell(terminal, row, urlSeparatorCol).isDim(), 0);
    assert.strictEqual(getCell(terminal, row, urlBorderCol).isDim(), 0);
  });

const quoteColor = 0x123456;

const quoteTheme: MarkdownTheme = {
  ...defaultMarkdownTheme,
  link: (text) => `\x1b[38;2;129;162;190m${text}\x1b[39m`,
  quote: (text) => `\x1b[38;2;18;52;86m${text}\x1b[39m`,
};

const quotedLinkSource = `> | Link | Plain |
> | --- | --- |
> | [one two three four five six](https://example.com) | normal text |`;

const assertQuotedLinkRow = (terminal: VirtualTerminal): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { row, line } = yield* findViewportRow(
      terminal.getViewport(),
      (viewportLine) => viewportLine.includes("one") && viewportLine.includes("normal"),
      "Missing wrapped blockquote table row",
    );
    const linkCol = line.indexOf("one");
    const separatorCol = line.indexOf("│", linkCol);
    const plainCol = line.indexOf("normal");
    assert.ok(linkCol >= 0 && separatorCol > linkCol && plainCol > separatorCol);
    assert.notStrictEqual(getCell(terminal, row, linkCol).getFgColor(), quoteColor);
    assert.strictEqual(getCell(terminal, row, separatorCol).getFgColor(), quoteColor);
    assert.strictEqual(getCell(terminal, row, plainCol).getFgColor(), quoteColor);
  });

const assertQuotedFinalRow = (terminal: VirtualTerminal): Effect.Effect<void> =>
  Effect.gen(function* () {
    const { row, line } = yield* findViewportRow(
      terminal.getViewport(),
      (viewportLine) => viewportLine.includes("five six"),
      "Missing final wrapped link row",
    );
    const finalLinkCol = line.indexOf("five six");
    const finalSeparatorCol = line.indexOf("│", finalLinkCol);
    const finalBorderCol = line.lastIndexOf("│");
    assert.ok(
      finalLinkCol >= 0 && finalSeparatorCol > finalLinkCol && finalBorderCol > finalSeparatorCol,
    );
    assert.strictEqual(getCell(terminal, row, finalSeparatorCol).getFgColor(), quoteColor);
    assert.strictEqual(getCell(terminal, row, finalBorderCol).getFgColor(), quoteColor);
  });

const resetCapabilities = Effect.ensuring(
  Effect.sync(() => {
    resetCapabilitiesCache();
  }),
);

describe("Markdown component", () => {
  describe("Tables", () => {
    it("should not leak wrapped link styles into table borders or plain cells", () =>
      Effect.runPromise(
        Effect.forEach(
          [true, false],
          (hyperlinks) => {
            setCapabilities({ hyperlinks, images: null, trueColor: false });
            return renderMarkdownInTerminal(
              { height: 16, source: wrappedLinkSource, theme: defaultMarkdownTheme, width: 24 },
              (terminal) =>
                Effect.andThen(
                  assertWrappedLinkRow(terminal),
                  hyperlinks ? Effect.void : assertFallbackUrlRow(terminal),
                ),
            );
          },
          { discard: true },
        ).pipe(resetCapabilities),
      ));

    it("should restore the enclosing style after a wrapped table link", () =>
      Effect.runPromise(
        Effect.suspend(() => {
          setCapabilities({ hyperlinks: true, images: null, trueColor: true });
          return renderMarkdownInTerminal(
            { height: 10, source: quotedLinkSource, theme: quoteTheme, width: 28 },
            (terminal) =>
              Effect.andThen(assertQuotedLinkRow(terminal), assertQuotedFinalRow(terminal)),
          );
        }).pipe(resetCapabilities),
      ));
  });
});
