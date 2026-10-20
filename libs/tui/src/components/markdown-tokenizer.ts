import { Marked, type Token, Tokenizer, type TokenizerExtension, type Tokens } from "marked";

import type markdownTokenizerTypes from "./markdown-tokenizer.types.ts";

const RESET_STYLE = "\x1b[0m";

const STRICT_STRIKETHROUGH_REGEX = /^(~~)(?=[^\s~])((?:\\.|[^\\])*?(?:\\.|[^\s~\\]))\1(?=[^~]|$)/u;

class StrictStrikethroughTokenizer extends Tokenizer {
  override del(src: string): Tokens.Del | undefined {
    const match = STRICT_STRIKETHROUGH_REGEX.exec(src);
    const text = match?.[2];
    if (match === null || text === undefined) {
      return undefined;
    }

    return {
      raw: match[0],
      text,
      tokens: this.lexer.inlineTokens(text),
      type: "del",
    };
  }
}

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let position = index - 1; position >= 0 && source[position] === "\\"; position--) {
    backslashes++;
  }
  return backslashes % 2 === 1;
}

function findClosingDelimiter(source: string, closing: string, start: number): number {
  let index = source.indexOf(closing, start);
  while (index >= 0 && isEscaped(source, index)) {
    index = source.indexOf(closing, index + closing.length);
  }
  return index;
}

function looksLikePendingDollarMath(source: string): boolean {
  return /\\[A-Za-z]+|[_^=+*/<>()[\]|±≤≥≠≈∈→⇒∞∫∑√-]/u.test(source);
}

function tokenizeInlineLatex(source: string): markdownTokenizerTypes.LatexToken | undefined {
  let opening: string;
  let closing: string;
  if (source.startsWith("$$")) {
    opening = "$$";
    closing = "$$";
  } else if (source.startsWith("\\(")) {
    opening = "\\(";
    closing = "\\)";
  } else if (source.startsWith("\\[")) {
    opening = "\\[";
    closing = "\\]";
  } else if (source.startsWith("$") && !/^\$\s/u.test(source)) {
    opening = "$";
    closing = "$";
  } else {
    return undefined;
  }

  const closingIndex = findClosingDelimiter(source, closing, opening.length);
  if (
    closingIndex >= 0 &&
    opening === "$" &&
    (/\s$/u.test(source.slice(opening.length, closingIndex)) ||
      /^\d/u.test(source.slice(closingIndex + 1)) ||
      (/^[A-Z_][A-Z0-9_]*(?:[^A-Za-z0-9_\s])?$/u.test(source.slice(opening.length, closingIndex)) &&
        /^[A-Za-z_][A-Za-z0-9_]*/u.test(source.slice(closingIndex + 1))) ||
      source.slice(opening.length, closingIndex).includes("`"))
  ) {
    return undefined;
  }

  if (closingIndex < 0) {
    const pendingSource = source.slice(opening.length);
    if (opening.startsWith("\\") || looksLikePendingDollarMath(pendingSource)) {
      return { pending: true, raw: source, text: pendingSource, type: "latex" };
    }
    return undefined;
  }

  const text = source.slice(opening.length, closingIndex);
  if (text === "" || text.includes("\n")) {
    return undefined;
  }

  const raw = source.slice(0, closingIndex + closing.length);
  return { raw, text, type: "latex" };
}

function tokenizeBlockLatex(source: string): markdownTokenizerTypes.LatexToken | undefined {
  const dollarMatch = /^ {0,3}\$\$[ \t]*(?:\n)?([\s\S]*?)\$\$[ \t]*(?:\n|$)/u.exec(source);
  if (dollarMatch?.[1] !== undefined && dollarMatch?.[1] !== "") {
    return { raw: dollarMatch[0], text: dollarMatch[1].trim(), type: "latexBlock" };
  }

  const bracketMatch = /^ {0,3}\\\[[ \t]*(?:\n)?([\s\S]*?)\\\][ \t]*(?:\n|$)/u.exec(source);
  if (bracketMatch?.[1] !== undefined && bracketMatch?.[1] !== "") {
    return { raw: bracketMatch[0], text: bracketMatch[1].trim(), type: "latexBlock" };
  }

  const pendingBracket = /^ {0,3}\\\[[ \t]*(?:\n)?([\s\S]*)$/u.exec(source);
  if (pendingBracket?.[1] !== undefined) {
    return { pending: true, raw: pendingBracket[0], text: pendingBracket[1], type: "latexBlock" };
  }
  const pendingDollar = /^ {0,3}\$\$[ \t]*(?:\n)?([\s\S]*)$/u.exec(source);
  if (
    pendingDollar?.[1] !== undefined &&
    pendingDollar?.[1] !== "" &&
    looksLikePendingDollarMath(pendingDollar[1])
  ) {
    return { pending: true, raw: pendingDollar[0], text: pendingDollar[1], type: "latexBlock" };
  }
  return undefined;
}

const LATEX_MARKDOWN_EXTENSIONS: readonly TokenizerExtension[] = [
  {
    level: "block",
    name: "latexBlock",
    start(source) {
      const match = /(?:^|\n) {0,3}(?:\$\$|\\\[)/u.exec(source);
      return match === null ? undefined : match.index + (match[0].startsWith("\n") ? 1 : 0);
    },
    tokenizer: tokenizeBlockLatex,
  },
  {
    level: "inline",
    name: "latex",
    start(source) {
      const indices = [source.indexOf("$"), source.indexOf("\\("), source.indexOf("\\[")].filter(
        (index) => index >= 0,
      );
      return indices.length > 0 ? Math.min(...indices) : undefined;
    },
    tokenizer: tokenizeInlineLatex,
  },
];

function trimPartialClosingFences(tokens: readonly Token[]): void {
  const token = tokens[tokens.length - 1];
  if (token?.type === "list") {
    trimPartialClosingFences(token.items[token.items.length - 1]?.tokens ?? []);
    return;
  }
  if (token?.type === "blockquote") {
    trimPartialClosingFences(token.tokens ?? []);
    return;
  }
  if (token?.type !== "code") {
    return;
  }

  const marker = /^(`{3,}|~{3,})/u.exec(token.raw)?.[1];
  const lastLine = token.raw.split("\n").pop();
  if (
    marker === undefined ||
    marker === "" ||
    lastLine === undefined ||
    lastLine === "" ||
    lastLine.length >= marker.length ||
    lastLine !== marker[0]?.repeat(lastLine.length)
  ) {
    return;
  }

  token.text = token.text.slice(0, -lastLine.length).replace(/\n$/u, "");
}

const markdownParser = new Marked();
markdownParser.setOptions({
  tokenizer: new StrictStrikethroughTokenizer(),
});
markdownParser.use({ extensions: [...LATEX_MARKDOWN_EXTENSIONS] });

const markdownTokenizer = {
  RESET_STYLE,
  markdownParser,
  trimPartialClosingFences,
};

export default markdownTokenizer;
