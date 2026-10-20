import testing from "@msa/testing";
import tui from "@msa/tui";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import {
  getMarkdownTheme,
  highlightCode,
  initTheme,
  theme,
} from "../src/modes/interactive/theme/theme.ts";
import {
  highlight,
  loadAllHighlightLanguages,
  renderHighlightedHtml,
  supportsLanguage,
} from "../src/utils/syntax-highlight.ts";

const { resetCapabilitiesCache, setCapabilities } = tui;

const { awaited, runTest } = testing;

const eagerLanguages = [
  "python",
  "java",
  "go",
  "javascript",
  "cpp",
  "typescript",
  "php",
  "ruby",
  "c",
  "csharp",
  "nix",
  "bash",
  "rust",
  "scala",
  "kotlin",
  "swift",
  "dart",
  "groovy",
  "perl",
  "lua",
];
const eagerLanguagesLoadedAtStartup = eagerLanguages.every(supportsLanguage);
const uncommonLanguageLoadedAtStartup = supportsLanguage("ada");

const loadsTheTwentyMostCommonLanguagesAt = () =>
  runTest(
    Effect.gen(function* () {
      expect(eagerLanguagesLoadedAtStartup).toBe(true);
      expect(uncommonLanguageLoadedAtStartup).toBe(false);
      yield* awaited(loadAllHighlightLanguages());
      expect(supportsLanguage("ada")).toBe(true);
    }),
  );

const rendersHighlightedSpansWithTheProvidedTheme = () => {
  const rendered = renderHighlightedHtml('<span class="hljs-keyword">const</span> value', {
    keyword: (text) => `[keyword:${text}]`,
  });
  expect(rendered).toBe("[keyword:const] value");
};

const decodesHtmlEntitiesEmittedByHighlightJs = () => {
  const rendered = renderHighlightedHtml(
    "&lt;tag attr=&quot;value&quot;&gt;&amp;#x41;&#65;&lt;/tag&gt;",
  );
  expect(rendered).toBe('<tag attr="value">&#x41;A</tag>');
};

const inheritsParentFormattingForUnmappedNestedScopes = () => {
  const interpolation = "${x}";
  const rendered = renderHighlightedHtml(
    `<span class="hljs-string">a<span class="hljs-subst">${interpolation}</span>b</span>`,
    {
      string: (text) => `[string:${text}]`,
    },
  );
  expect(rendered).toBe(`[string:a][string:${interpolation}][string:b]`);
};

const keepsParentFormattingAcrossUnscopedNestedSpans = () => {
  const rendered = renderHighlightedHtml(
    '<span class="hljs-string">a<span class="language-xml">b</span>c</span>',
    {
      string: (text) => `[string:${text}]`,
    },
  );
  expect(rendered).toBe("[string:a][string:b][string:c]");
};

const highlightsCodeThroughHighlightJs = () => {
  expect(supportsLanguage("typescript")).toBe(true);
  const rendered = highlight("const value = 1", {
    ignoreIllegals: true,
    language: "typescript",
    theme: {
      keyword: (text) => `[keyword:${text}]`,
      number: (text) => `[number:${text}]`,
    },
  });
  expect(rendered).toContain("[keyword:const]");
  expect(rendered).toContain("[number:1]");
};

describe("syntax highlight renderer", () => {
  it(
    "loads the twenty most common languages at startup and defers the rest",
    loadsTheTwentyMostCommonLanguagesAt,
  );

  it(
    "renders highlighted spans with the provided theme",
    rendersHighlightedSpansWithTheProvidedTheme,
  );

  it("decodes HTML entities emitted by highlight.js", decodesHtmlEntitiesEmittedByHighlightJs);

  it(
    "inherits parent formatting for unmapped nested scopes",
    inheritsParentFormattingForUnmappedNestedScopes,
  );

  it(
    "keeps parent formatting across unscoped nested spans",
    keepsParentFormattingAcrossUnscopedNestedSpans,
  );

  it("highlights code through highlight.js", highlightsCodeThroughHighlightJs);
});

const colorsEachLineOfPythonDocstringsIndependently = () => {
  const code = '"""\nline one\n\nline two\n"""\nafter';
  const ansi = theme.getFgAnsi("syntaxString");
  const expected = [
    `${ansi}"""\x1b[39m`,
    `${ansi}line one\x1b[39m`,
    "",
    `${ansi}line two\x1b[39m`,
    `${ansi}"""\x1b[39m`,
    "after",
  ];

  expect(highlightCode(code, "python")).toEqual(expected);
  expect(getMarkdownTheme().highlightCode?.(code, "python")).toEqual(expected);
};

const colorsDiffAdditionsAndDeletionsInFenced = () => {
  const lines = highlightCode("-old\n+new\n", "diff");

  expect(lines[0]).toBe(`${theme.getFgAnsi("toolDiffRemoved")}-old\x1b[39m`);
  expect(lines[1]).toBe(`${theme.getFgAnsi("toolDiffAdded")}+new\x1b[39m`);
};

const keepsCliHighlightDefaultStyledScopesMapped = () => {
  expect(highlightCode("const re = /foo+/gi;", "javascript")[0]).toContain(
    `${theme.getFgAnsi("syntaxString")}/foo+/gi\x1b[39m`,
  );
  expect(highlightCode("@decorator", "python")[0]).toBe(
    `${theme.getFgAnsi("muted")}@decorator\x1b[39m`,
  );
  expect(highlightCode("<div></div>", "html")[0]).toContain(
    `${theme.getFgAnsi("syntaxKeyword")}div\x1b[39m`,
  );
};

describe("theme syntax highlighting", () => {
  beforeEach(() => {
    setCapabilities({ hyperlinks: false, images: null, trueColor: true });
    initTheme("dark");
  });

  afterEach(() => {
    resetCapabilitiesCache();
  });

  it(
    "colors each line of Python docstrings independently",
    colorsEachLineOfPythonDocstringsIndependently,
  );

  it(
    "colors diff additions and deletions in fenced diff blocks",
    colorsDiffAdditionsAndDeletionsInFenced,
  );

  it(
    "keeps cli-highlight default styled scopes mapped to theme styles",
    keepsCliHighlightDefaultStyledScopesMapped,
  );
});
