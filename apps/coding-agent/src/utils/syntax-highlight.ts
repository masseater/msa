import { dual } from "effect/Function";

import highlightLanguages from "./highlight-languages.ts";
import htmlModule from "./html.ts";
import interop from "./interop.ts";
import type syntaxHighlightTypes from "./syntax-highlight.types.ts";

const { callbackPromise } = interop;
const { decodeHtmlEntityAt } = htmlModule;
const { highlightJs: hljs } = highlightLanguages;

let allLanguagesPromise: Promise<void> | undefined;

function loadAllHighlightLanguages(): Promise<void> {
  if (allLanguagesPromise === undefined) {
    allLanguagesPromise = callbackPromise((resolve) => {
      setImmediate(() => {
        void import("highlight.js/lib/index.js").then(
          () => resolve(),
          () => {
            resolve();
          },
        );
      });
    });
  }
  return allLanguagesPromise;
}

const SPAN_CLOSE = "</span>";
const HIGHLIGHT_CLASS_PREFIX = "hljs-";

function getScopeFromSpanTag(tag: string): string | undefined {
  const match = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/u.exec(tag);
  const classValue = match?.[1] ?? match?.[2];
  if (classValue === undefined || classValue === "") {
    return undefined;
  }

  for (const className of classValue.split(/\s+/u)) {
    if (className.startsWith(HIGHLIGHT_CLASS_PREFIX)) {
      return className.slice(HIGHLIGHT_CLASS_PREFIX.length);
    }
  }

  return undefined;
}

function getScopeFormatter(
  scope: string,
  theme: syntaxHighlightTypes.HighlightTheme,
): syntaxHighlightTypes.HighlightFormatter | undefined {
  const formatters = new Map(Object.entries(theme));
  const exact = formatters.get(scope);
  if (exact !== undefined) {
    return exact;
  }

  const dotIndex = scope.indexOf(".");
  if (dotIndex !== -1) {
    const prefixFormatter = formatters.get(scope.slice(0, dotIndex));
    if (prefixFormatter !== undefined) {
      return prefixFormatter;
    }
  }

  const dashIndex = scope.indexOf("-");
  if (dashIndex !== -1) {
    const prefixFormatter = formatters.get(scope.slice(0, dashIndex));
    if (prefixFormatter !== undefined) {
      return prefixFormatter;
    }
  }

  return undefined;
}

function getActiveFormatter(
  scopes: Array<string | undefined>,
  theme: syntaxHighlightTypes.HighlightTheme,
): syntaxHighlightTypes.HighlightFormatter | undefined {
  for (let i = scopes.length - 1; i >= 0; i--) {
    const scope = scopes[i];
    if (scope === undefined || scope === "") {
      continue;
    }
    const formatter = getScopeFormatter(scope, theme);
    if (formatter !== undefined) {
      return formatter;
    }
  }
  return theme["default"];
}

function isSpanOpenTagStart(html: string, index: number): boolean {
  if (!html.startsWith("<span", index)) {
    return false;
  }
  const nextChar = html[index + "<span".length];
  return (
    nextChar === ">" ||
    nextChar === " " ||
    nextChar === "\t" ||
    nextChar === "\n" ||
    nextChar === "\r"
  );
}

type HtmlToken =
  | { kind: "open"; scope: string | undefined; end: number }
  | { kind: "close"; end: number }
  | { kind: "text"; text: string; end: number };

function readHtmlToken(html: string, index: number): HtmlToken {
  if (isSpanOpenTagStart(html, index)) {
    const tagEndIndex = html.indexOf(">", index + 5);
    if (tagEndIndex !== -1) {
      const scope = getScopeFromSpanTag(html.slice(index, tagEndIndex + 1));
      return { end: tagEndIndex + 1, kind: "open", scope };
    }
  }
  if (html.startsWith(SPAN_CLOSE, index)) {
    return { end: index + SPAN_CLOSE.length, kind: "close" };
  }
  if (html[index] === "&") {
    const decoded = decodeHtmlEntityAt(html, index);
    if (decoded !== undefined) {
      return { end: index + decoded.length, kind: "text", text: decoded.text };
    }
  }
  return { end: index + 1, kind: "text", text: html[index] ?? "" };
}

function formatText(text: string, formatter: syntaxHighlightTypes.HighlightFormatter | undefined) {
  if (formatter === undefined) return text;
  return text
    .split("\n")
    .map((line) => (line === "" ? line : formatter(line)))
    .join("\n");
}

function renderHighlightedHtmlImpl(
  html: string,
  theme: syntaxHighlightTypes.HighlightTheme = {},
): string {
  let output = "";
  let textBuffer = "";
  const scopes: Array<string | undefined> = [];
  const flushText = () => {
    output += textBuffer === "" ? "" : formatText(textBuffer, getActiveFormatter(scopes, theme));
    textBuffer = "";
  };
  let index = 0;
  while (index < html.length) {
    const token = readHtmlToken(html, index);
    if (token.kind === "text") {
      textBuffer += token.text;
    } else {
      flushText();
      if (token.kind === "open") scopes.push(token.scope);
      else scopes.pop();
    }
    index = token.end;
  }
  flushText();
  return output;
}

const renderHighlightedHtml: {
  (html: string, theme?: syntaxHighlightTypes.HighlightTheme): string;
  (theme?: syntaxHighlightTypes.HighlightTheme): (html: string) => string;
} = dual((args: IArguments) => args.length >= 1, renderHighlightedHtmlImpl);

function highlightImpl(code: string, options: syntaxHighlightTypes.HighlightOptions = {}): string {
  const html =
    options.language !== undefined && options.language !== ""
      ? hljs.highlight(code, {
          ignoreIllegals: options.ignoreIllegals,
          language: options.language,
        }).value
      : hljs.highlightAuto(code, options.languageSubset).value;
  return renderHighlightedHtml(html, options.theme);
}

const highlight: {
  (code: string, options?: syntaxHighlightTypes.HighlightOptions): string;
  (options?: syntaxHighlightTypes.HighlightOptions): (code: string) => string;
} = dual((args: IArguments) => args.length >= 1, highlightImpl);

function supportsLanguage(name: string): boolean {
  return hljs.getLanguage(name) !== undefined;
}

const syntaxHighlight = {
  highlight,
  loadAllHighlightLanguages,
  renderHighlightedHtml,
  supportsLanguage,
};

export default syntaxHighlight;
