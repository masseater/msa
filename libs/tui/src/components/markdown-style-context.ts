import type { Token, Tokens } from "marked";

import { renderLatex } from "../latex.ts";
import { getCapabilities } from "../terminal-capabilities.ts";
import { hyperlink } from "../terminal-image.ts";
import type {
  DefaultTextStyle,
  InlineStyleContext,
  MarkdownOptions,
  MarkdownTheme,
} from "./markdown-theme.ts";
import type { LatexToken } from "./markdown-tokenizer.ts";

export class MarkdownStyleContext {
  protected text: string;
  protected paddingX: number;
  protected paddingY: number;
  protected defaultTextStyle?: DefaultTextStyle | undefined;
  protected theme: MarkdownTheme;
  protected options: MarkdownOptions;
  protected defaultStylePrefix?: string;

  protected cachedText?: string | undefined;
  protected cachedWidth?: number | undefined;
  protected cachedLines?: string[] | undefined;
  protected cachedTokens?: WeakRef<{ source: string; tokens: Token[] }>;

  constructor(
    text: string,
    paddingX: number,
    paddingY: number,
    theme: MarkdownTheme,
    defaultTextStyle?: DefaultTextStyle,
    options?: MarkdownOptions,
  ) {
    this.text = text;
    this.paddingX = paddingX;
    this.paddingY = paddingY;
    this.theme = theme;
    this.defaultTextStyle = defaultTextStyle;
    this.options = options === undefined ? {} : { ...options };
  }

  setText(text: string): void {
    this.text = text;
    this.invalidate();
  }

  invalidate(): void {
    this.cachedText = undefined;
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  protected applyDefaultStyle(text: string): string {
    if (this.defaultTextStyle === undefined) {
      return text;
    }

    let styled = text;

    if (this.defaultTextStyle.color !== undefined) {
      styled = this.defaultTextStyle.color(styled);
    }

    if (this.defaultTextStyle.bold === true) {
      styled = this.theme.bold(styled);
    }
    if (this.defaultTextStyle.italic === true) {
      styled = this.theme.italic(styled);
    }
    if (this.defaultTextStyle.strikethrough === true) {
      styled = this.theme.strikethrough(styled);
    }
    if (this.defaultTextStyle.underline === true) {
      styled = this.theme.underline(styled);
    }

    return styled;
  }

  protected getDefaultStylePrefix(): string {
    if (this.defaultTextStyle === undefined) {
      return "";
    }

    if (this.defaultStylePrefix !== undefined) {
      return this.defaultStylePrefix;
    }

    const sentinel = "\u0000";
    let styled = sentinel;

    if (this.defaultTextStyle.color !== undefined) {
      styled = this.defaultTextStyle.color(styled);
    }

    if (this.defaultTextStyle.bold === true) {
      styled = this.theme.bold(styled);
    }
    if (this.defaultTextStyle.italic === true) {
      styled = this.theme.italic(styled);
    }
    if (this.defaultTextStyle.strikethrough === true) {
      styled = this.theme.strikethrough(styled);
    }
    if (this.defaultTextStyle.underline === true) {
      styled = this.theme.underline(styled);
    }

    const sentinelIndex = styled.indexOf(sentinel);
    this.defaultStylePrefix = sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
    return this.defaultStylePrefix;
  }

  protected getStylePrefix(styleFn: (text: string) => string): string {
    const sentinel = "\u0000";
    const styled = styleFn(sentinel);
    const sentinelIndex = styled.indexOf(sentinel);
    return sentinelIndex >= 0 ? styled.slice(0, sentinelIndex) : "";
  }

  protected getDefaultInlineStyleContext(): InlineStyleContext {
    return {
      applyText: (text: string) => this.applyDefaultStyle(text),
      stylePrefix: this.getDefaultStylePrefix(),
    };
  }

  protected addTrailingBlank(lines: string[], nextTokenType: string | undefined): string[] {
    if (nextTokenType !== undefined && nextTokenType !== "" && nextTokenType !== "space") {
      lines.push("");
    }
    return lines;
  }

  protected applyWithNewlines(context: InlineStyleContext, text: string): string {
    return text
      .split("\n")
      .map((segment: string) => context.applyText(segment))
      .join("\n");
  }

  protected renderInlineLatex(token: LatexToken, context: InlineStyleContext): string {
    const rendered =
      token.pending !== true && this.options.renderLatex !== false
        ? (renderLatex(token.text) ?? token.raw)
        : token.raw;
    return this.applyWithNewlines(context, rendered);
  }

  protected renderInlineLink(
    token: Tokens.Link | Tokens.Generic,
    context: InlineStyleContext,
  ): string {
    const linkText = this.renderInlineTokens(token.tokens || [], context);
    const styledLink = this.theme.link(this.theme.underline(linkText));
    if (getCapabilities().hyperlinks) {
      return hyperlink(styledLink, token.href) + context.stylePrefix;
    }
    const hrefForComparison =
      token.href.startsWith("mailto:") === true ? token.href.slice(7) : token.href;
    if (token.text === token.href || token.text === hrefForComparison) {
      return styledLink + context.stylePrefix;
    }
    return styledLink + this.theme.linkUrl(` (${token.href})`) + context.stylePrefix;
  }

  protected renderInlineToken(token: Token, context: InlineStyleContext): string {
    const { stylePrefix } = context;
    switch (token.type) {
      case "latex":
        return this.renderInlineLatex(token as LatexToken, context);
      case "escape":
        return this.applyWithNewlines(
          context,
          this.options.preserveBackslashEscapes === true ? token.raw : token.text,
        );
      case "text":
        return token.tokens !== undefined && token.tokens.length > 0
          ? this.renderInlineTokens(token.tokens, context)
          : this.applyWithNewlines(context, token.text);
      case "paragraph":
        return this.renderInlineTokens(token.tokens || [], context);
      case "strong":
        return this.theme.bold(this.renderInlineTokens(token.tokens || [], context)) + stylePrefix;
      case "em":
        return (
          this.theme.italic(this.renderInlineTokens(token.tokens || [], context)) + stylePrefix
        );
      case "codespan":
        return this.theme.code(token.text) + stylePrefix;
      case "link":
        return this.renderInlineLink(token, context);
      case "br":
        return "\n";
      case "del":
        return (
          this.theme.strikethrough(this.renderInlineTokens(token.tokens || [], context)) +
          stylePrefix
        );
      case "html":
        return "raw" in token && typeof token.raw === "string"
          ? this.applyWithNewlines(context, token.raw)
          : "";
      default:
        return "text" in token && typeof token.text === "string"
          ? this.applyWithNewlines(context, token.text)
          : "";
    }
  }

  protected renderInlineTokens(tokens: Token[], styleContext?: InlineStyleContext): string {
    const context = styleContext ?? this.getDefaultInlineStyleContext();
    let result = "";
    for (const token of tokens) {
      result += this.renderInlineToken(token, context);
    }

    const { stylePrefix } = context;
    if (stylePrefix !== "") {
      while (result.endsWith(stylePrefix)) {
        result = result.slice(0, -stylePrefix.length);
      }
    }

    return result;
  }
}
