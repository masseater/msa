import type { Token } from "marked";

import terminalImageKitty from "../terminal-image-kitty.ts";
import textWrap from "../text-wrap.ts";
import type tuiComponentTypes from "../tui-component.types.ts";
import utils from "../utils.ts";
import MarkdownTokenRenderer from "./markdown-token-renderer.ts";
import markdownTokenizer from "./markdown-tokenizer.ts";

const { flattenLines, visibleWidth } = utils;
const { markdownParser, trimPartialClosingFences } = markdownTokenizer;
const { isImageLine } = terminalImageKitty;
const { applyBackgroundToLine, wrapTextWithAnsi } = textWrap;

export default class Markdown extends MarkdownTokenRenderer implements tuiComponentTypes.Component {
  render(width: number): string[] {
    if (
      this.cachedLines !== undefined &&
      this.cachedText === this.text &&
      this.cachedWidth === width
    ) {
      return this.cachedLines;
    }

    const contentWidth = Math.max(1, width - this.paddingX * 2);
    const text = this.options.transform?.(this.text, contentWidth) ?? this.text;

    if (text === "" || text.trim() === "") {
      const result: string[] = [];
      this.cachedText = this.text;
      this.cachedWidth = width;
      this.cachedLines = result;
      return result;
    }

    const wrappedLines = this.renderWrappedLines(text, contentWidth);
    const contentLines = this.addMargins(wrappedLines, width);
    const emptyLines = this.renderEmptyLines(width);

    const result = emptyLines.concat(contentLines, emptyLines);
    flattenLines(result);

    this.cachedText = this.text;
    this.cachedWidth = width;
    this.cachedLines = result;

    return result.length > 0 ? result : [""];
  }

  private lexTokens(normalizedText: string): Token[] {
    const cached = this.cachedTokens?.deref();
    if (cached?.source === normalizedText) return cached.tokens;
    const tokens = markdownParser.lexer(normalizedText);
    trimPartialClosingFences(tokens);
    this.cachedTokens = new WeakRef({ source: normalizedText, tokens });
    return tokens;
  }

  private renderWrappedLines(text: string, contentWidth: number): string[] {
    const tokens = this.lexTokens(text.replace(/\t/gu, "   "));

    const renderedLines: string[] = [];
    for (const [i, token] of tokens.entries()) {
      for (const tokenLine of this.renderToken(token, contentWidth, tokens[i + 1]?.type)) {
        renderedLines.push(tokenLine);
      }
    }

    const wrappedLines: string[] = [];
    for (const line of renderedLines) {
      if (isImageLine(line)) {
        wrappedLines.push(line);
        continue;
      }
      for (const wrappedLine of wrapTextWithAnsi(line, contentWidth)) {
        wrappedLines.push(wrappedLine);
      }
    }
    return wrappedLines;
  }

  private addMargins(wrappedLines: readonly string[], width: number): string[] {
    const margin = " ".repeat(this.paddingX);
    const bgFn = this.defaultTextStyle?.bgColor;
    const contentLines: string[] = [];

    for (const line of wrappedLines) {
      if (isImageLine(line)) {
        contentLines.push(line);
        continue;
      }

      const lineWithMargins = margin + line + margin;
      if (bgFn === undefined) {
        const paddingNeeded = Math.max(0, width - visibleWidth(lineWithMargins));
        contentLines.push(lineWithMargins + " ".repeat(paddingNeeded));
      } else {
        contentLines.push(applyBackgroundToLine(lineWithMargins, width, bgFn));
      }
    }
    return contentLines;
  }

  private renderEmptyLines(width: number): string[] {
    const bgFn = this.defaultTextStyle?.bgColor;
    const emptyLine = " ".repeat(width);
    const emptyLines: string[] = [];
    for (let i = 0; i < this.paddingY; i++) {
      emptyLines.push(
        bgFn === undefined ? emptyLine : applyBackgroundToLine(emptyLine, width, bgFn),
      );
    }
    return emptyLines;
  }
}
