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
  const exact = theme[scope];
  if (exact !== undefined) {
    return exact;
  }

  const dotIndex = scope.indexOf(".");
  if (dotIndex !== -1) {
    const prefixFormatter = theme[scope.slice(0, dotIndex)];
    if (prefixFormatter !== undefined) {
      return prefixFormatter;
    }
  }

  const dashIndex = scope.indexOf("-");
  if (dashIndex !== -1) {
    const prefixFormatter = theme[scope.slice(0, dashIndex)];
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

function renderHighlightedHtmlImpl(
  html: string,
  theme: syntaxHighlightTypes.HighlightTheme = {},
): string {
  let output = "";
  let textBuffer = "";
  const scopes: Array<string | undefined> = [];

  const flushText = () => {
    if (textBuffer === "") {
      return;
    }
    const formatter = getActiveFormatter(scopes, theme);
    output +=
      formatter === undefined
        ? textBuffer
        : textBuffer
            .split("\n")
            .map((line) => (line === "" ? line : formatter(line)))
            .join("\n");
    textBuffer = "";
  };

  let index = 0;
  while (index < html.length) {
    if (isSpanOpenTagStart(html, index)) {
      const tagEndIndex = html.indexOf(">", index + 5);
      if (tagEndIndex !== -1) {
        flushText();
        const tag = html.slice(index, tagEndIndex + 1);
        const scope = getScopeFromSpanTag(tag);
        scopes.push(scope);
        index = tagEndIndex + 1;
        continue;
      }
    }

    if (html.startsWith(SPAN_CLOSE, index)) {
      flushText();
      if (scopes.length > 0) {
        scopes.pop();
      }
      index += SPAN_CLOSE.length;
      continue;
    }

    if (html[index] === "&") {
      const decoded = decodeHtmlEntityAt(html, index);
      if (decoded !== undefined) {
        textBuffer += decoded.text;
        index += decoded.length;
        continue;
      }
    }

    textBuffer += html[index];
    index++;
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
