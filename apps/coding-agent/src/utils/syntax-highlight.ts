import { dual } from "effect/Function";

import { highlightJs as hljs } from "./highlight-languages.ts";
import { decodeHtmlEntityAt } from "./html.ts";
import { callbackPromise } from "./interop.ts";

let allLanguagesPromise: Promise<void> | undefined;

export function loadAllHighlightLanguages(): Promise<void> {
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

export type HighlightFormatter = (text: string) => string;
export type HighlightTheme = Partial<Record<string, HighlightFormatter>>;

export interface HighlightOptions {
  language?: string;
  ignoreIllegals?: boolean;
  languageSubset?: string[];
  theme?: HighlightTheme;
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

function getScopeFormatter(scope: string, theme: HighlightTheme): HighlightFormatter | undefined {
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
  theme: HighlightTheme,
): HighlightFormatter | undefined {
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

function renderHighlightedHtmlImpl(html: string, theme: HighlightTheme = {}): string {
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

export const renderHighlightedHtml: {
  (html: string, theme?: HighlightTheme): string;
  (theme?: HighlightTheme): (html: string) => string;
} = dual((args: IArguments) => args.length >= 1, renderHighlightedHtmlImpl);

function highlightImpl(code: string, options: HighlightOptions = {}): string {
  const html =
    options.language !== undefined && options.language !== ""
      ? hljs.highlight(code, {
          language: options.language,
          ignoreIllegals: options.ignoreIllegals,
        }).value
      : hljs.highlightAuto(code, options.languageSubset).value;
  return renderHighlightedHtml(html, options.theme);
}

export const highlight: {
  (code: string, options?: HighlightOptions): string;
  (options?: HighlightOptions): (code: string) => string;
} = dual((args: IArguments) => args.length >= 1, highlightImpl);

export function supportsLanguage(name: string): boolean {
  return hljs.getLanguage(name) !== undefined;
}
