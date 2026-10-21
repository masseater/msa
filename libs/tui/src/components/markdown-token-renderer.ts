import type { Token, Tokens } from "marked";

import latex from "../latex.ts";
import textWrap from "../text-wrap.ts";
import utils from "../utils.ts";
import MarkdownTableRenderer from "./markdown-table-renderer.ts";
import type markdownThemeTypes from "./markdown-theme.ts";
import markdownTokenizer from "./markdown-tokenizer.ts";
import type markdownTokenizerTypes from "./markdown-tokenizer.types.ts";

const { renderLatex } = latex;
const { RESET_STYLE } = markdownTokenizer;
const { wrapTextWithAnsi } = textWrap;
const { visibleWidth } = utils;

export default class MarkdownTokenRenderer extends MarkdownTableRenderer {
  protected renderHeading(
    token: Tokens.Heading | Tokens.Generic,
    nextTokenType?: string,
  ): string[] {
    const headingLevel = token.depth;
    const headingStyleFn =
      headingLevel === 1
        ? (text: string) => this.theme.heading(this.theme.bold(this.theme.underline(text)))
        : (text: string) => this.theme.heading(this.theme.bold(text));

    const headingStyleContext: markdownThemeTypes.InlineStyleContext = {
      applyText: headingStyleFn,
      stylePrefix: this.getStylePrefix(headingStyleFn),
    };

    const headingText = this.renderInlineTokens(token.tokens || [], headingStyleContext);
    const styledHeading =
      headingLevel >= 3
        ? headingStyleFn(`${"#".repeat(headingLevel)} `) + headingText
        : headingText;
    return this.addTrailingBlank([styledHeading], nextTokenType);
  }

  protected renderParagraph(
    token: Tokens.Paragraph | Tokens.Generic,
    nextTokenType?: string,
    styleContext?: markdownThemeTypes.InlineStyleContext,
  ): string[] {
    const lines = [this.renderInlineTokens(token.tokens || [], styleContext)];
    if (nextTokenType === "list") return lines;
    return this.addTrailingBlank(lines, nextTokenType);
  }

  protected renderLatexBlock(
    token: markdownTokenizerTypes.LatexToken,
    nextTokenType?: string,
  ): string[] {
    const rendered =
      token.pending !== true && this.options.renderLatex !== false
        ? (renderLatex(token.text, { display: true }) ?? token.raw.trim())
        : token.raw.trim();
    const lines = rendered.split("\n").map((line) => this.applyDefaultStyle(line));
    return this.addTrailingBlank(lines, nextTokenType);
  }

  protected renderCodeBlock(token: Tokens.Code | Tokens.Generic, nextTokenType?: string): string[] {
    const indent = this.theme.codeBlockIndent ?? "  ";
    const lines = [this.theme.codeBlockBorder(`\`\`\`${token.lang || ""}`)];
    if (this.theme.highlightCode === undefined) {
      for (const codeLine of token.text.split("\n")) {
        lines.push(`${indent}${this.theme.codeBlock(codeLine)}`);
      }
    } else {
      for (const hlLine of this.theme.highlightCode(token.text, token.lang)) {
        lines.push(`${indent}${hlLine}`);
      }
    }
    lines.push(this.theme.codeBlockBorder("```"));
    return this.addTrailingBlank(lines, nextTokenType);
  }

  protected renderQuoteContent(
    token: Tokens.Blockquote | Tokens.Generic,
    quoteContentWidth: number,
  ): string[] {
    const quoteInlineStyleContext: markdownThemeTypes.InlineStyleContext = {
      applyText: (text: string) => text,
      stylePrefix: this.getStylePrefix((text: string) => this.theme.quote(this.theme.italic(text))),
    };
    const quoteTokens = token.tokens || [];
    const renderedQuoteLines: string[] = [];
    for (const [i, quoteToken] of quoteTokens.entries()) {
      renderedQuoteLines.push(
        ...this.renderToken(
          quoteToken,
          quoteContentWidth,
          quoteTokens[i + 1]?.type,
          quoteInlineStyleContext,
        ),
      );
    }
    while (
      renderedQuoteLines.length > 0 &&
      renderedQuoteLines[renderedQuoteLines.length - 1] === ""
    ) {
      renderedQuoteLines.pop();
    }
    return renderedQuoteLines;
  }

  protected renderBlockquote(
    token: Tokens.Blockquote | Tokens.Generic,
    width: number,
    nextTokenType?: string,
  ): string[] {
    const quoteStyle = (text: string) => this.theme.quote(this.theme.italic(text));
    const quoteStylePrefix = this.getStylePrefix(quoteStyle);
    const applyQuoteStyle = (line: string): string =>
      quoteStylePrefix === ""
        ? quoteStyle(line)
        : quoteStyle(line.split(RESET_STYLE).join(`${RESET_STYLE}${quoteStylePrefix}`));

    const quoteContentWidth = Math.max(1, width - 2);
    const lines: string[] = [];
    for (const quoteLine of this.renderQuoteContent(token, quoteContentWidth)) {
      for (const wrappedLine of wrapTextWithAnsi(applyQuoteStyle(quoteLine), quoteContentWidth)) {
        lines.push(this.theme.quoteBorder("│ ") + wrappedLine);
      }
    }
    return this.addTrailingBlank(lines, nextTokenType);
  }

  protected renderToken(
    token: Token,
    width: number,
    nextTokenType?: string,
    styleContext?: markdownThemeTypes.InlineStyleContext,
  ): string[] {
    switch (token.type) {
      case "heading":
        return this.renderHeading(token, nextTokenType);
      case "paragraph":
        return this.renderParagraph(token, nextTokenType, styleContext);
      case "text":
        return [this.renderInlineTokens([token], styleContext)];
      case "latexBlock":
        return this.renderLatexBlock(token as markdownTokenizerTypes.LatexToken, nextTokenType);
      case "code":
        return this.renderCodeBlock(token, nextTokenType);
      case "list":
        return this.renderList(token as Tokens.List, 0, width, styleContext);
      case "table":
        return this.renderTable(token as Tokens.Table, width, nextTokenType, styleContext);
      case "blockquote":
        return this.renderBlockquote(token, width, nextTokenType);
      case "hr":
        return this.addTrailingBlank(
          [this.theme.hr("─".repeat(Math.min(width, 80)))],
          nextTokenType,
        );
      case "html":
        return "raw" in token && typeof token.raw === "string"
          ? [this.applyDefaultStyle(token.raw.trim())]
          : [];
      case "space":
        return [""];
      default:
        return "text" in token && typeof token.text === "string" ? [token.text] : [];
    }
  }

  protected getOrderedListMarker(item: Tokens.ListItem): string | undefined {
    const match = /^(?: {0,3})(\d{1,9}[.)])[ \t]+/u.exec(item.raw);
    return match === null ? undefined : `${match[1]} `;
  }

  protected getUnorderedListMarker(item: Tokens.ListItem): string | undefined {
    const match = /^(?: {0,3})([-+*])(?:[ \t]+|(?=\r?\n|$))/u.exec(item.raw);
    return match === null ? undefined : `${match[1]} `;
  }

  protected listItemMarker(token: Tokens.List, item: Tokens.ListItem, index: number): string {
    const startNumber = typeof token.start === "number" ? token.start : 1;
    const preserve = this.options.preserveOrderedListMarkers === true;
    const bullet = token.ordered
      ? preserve
        ? (this.getOrderedListMarker(item) ?? `${startNumber + index}. `)
        : `${startNumber + index}. `
      : preserve
        ? (this.getUnorderedListMarker(item) ?? "- ")
        : "- ";
    const taskMarker = item.task ? `[${item.checked === true ? "x" : " "}] ` : "";
    return bullet + taskMarker;
  }

  protected renderListItem(
    request: {
      item: Tokens.ListItem;
      marker: string;
      indent: string;
      depth: number;
      width: number;
    },
    styleContext?: markdownThemeTypes.InlineStyleContext,
  ): string[] {
    const firstPrefix = request.indent + this.theme.listBullet(request.marker);
    const continuationPrefix = request.indent + " ".repeat(visibleWidth(request.marker));
    const itemWidth = Math.max(1, request.width - visibleWidth(firstPrefix));

    const lines: string[] = [];
    let renderedAnyLine = false;
    for (const itemToken of request.item.tokens) {
      if (itemToken.type === "list") {
        lines.push(
          ...this.renderList(
            itemToken as Tokens.List,
            request.depth + 1,
            request.width,
            styleContext,
          ),
        );
        renderedAnyLine = true;
        continue;
      }

      for (const line of this.renderToken(itemToken, itemWidth, undefined, styleContext)) {
        for (const wrappedLine of wrapTextWithAnsi(line, itemWidth)) {
          lines.push((renderedAnyLine ? continuationPrefix : firstPrefix) + wrappedLine);
          renderedAnyLine = true;
        }
      }
    }

    return renderedAnyLine ? lines : [firstPrefix];
  }

  protected renderList(
    token: Tokens.List,
    depth: number,
    width: number,
    styleContext?: markdownThemeTypes.InlineStyleContext,
  ): string[] {
    const lines: string[] = [];
    const indent = "    ".repeat(depth);

    for (const [i, item] of token.items.entries()) {
      lines.push(
        ...this.renderListItem(
          { depth, indent, item, marker: this.listItemMarker(token, item, i), width },
          styleContext,
        ),
      );

      if (token.loose && i !== token.items.length - 1) {
        lines.push("");
      }
    }

    return lines;
  }
}
