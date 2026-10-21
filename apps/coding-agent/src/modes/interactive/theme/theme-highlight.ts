import { Function as Fn } from "effect";

import syntaxHighlight from "../../../utils/syntax-highlight.ts";
import type Theme from "./theme-class.ts";
import themeState from "./theme-state.ts";

const { highlight, supportsLanguage } = syntaxHighlight;
const { theme } = themeState;

type CliHighlightTheme = Record<string, (s: string) => string>;

let cachedHighlightThemeFor: Theme | undefined;
let cachedCliHighlightTheme: CliHighlightTheme | undefined;

function buildCliHighlightTheme(t: Theme): CliHighlightTheme {
  return {
    addition: (s: string) => t.fg("toolDiffAdded", s),
    attr: (s: string) => t.fg("syntaxVariable", s),
    built_in: (s: string) => t.fg("syntaxType", s),
    class: (s: string) => t.fg("syntaxType", s),
    comment: (s: string) => t.fg("syntaxComment", s),
    deletion: (s: string) => t.fg("toolDiffRemoved", s),
    doctag: (s: string) => t.fg("syntaxComment", s),
    emphasis: (s: string) => t.italic(s),
    function: (s: string) => t.fg("syntaxFunction", s),
    keyword: (s: string) => t.fg("syntaxKeyword", s),
    link: (s: string) => t.underline(s),
    literal: (s: string) => t.fg("syntaxNumber", s),
    meta: (s: string) => t.fg("muted", s),
    name: (s: string) => t.fg("syntaxKeyword", s),
    number: (s: string) => t.fg("syntaxNumber", s),
    operator: (s: string) => t.fg("syntaxOperator", s),
    params: (s: string) => t.fg("syntaxVariable", s),
    punctuation: (s: string) => t.fg("syntaxPunctuation", s),
    regexp: (s: string) => t.fg("syntaxString", s),
    string: (s: string) => t.fg("syntaxString", s),
    strong: (s: string) => t.bold(s),
    subst: (s: string) => t.fg("text", s),
    tag: (s: string) => t.fg("syntaxPunctuation", s),
    title: (s: string) => t.fg("syntaxFunction", s),
    type: (s: string) => t.fg("syntaxType", s),
    variable: (s: string) => t.fg("syntaxVariable", s),
  };
}

function getCliHighlightTheme(t: Theme): CliHighlightTheme {
  if (cachedHighlightThemeFor !== t || cachedCliHighlightTheme === undefined) {
    cachedHighlightThemeFor = t;
    cachedCliHighlightTheme = buildCliHighlightTheme(t);
  }
  return cachedCliHighlightTheme;
}

function codeBlockLines(code: string): string[] {
  return code.split("\n").map((line) => theme.fg("mdCodeBlock", line));
}

function highlightLines(
  code: string,
  lang: string | undefined,
  onFailure: (code: string) => string[],
): string[] {
  if (lang === undefined || lang === "" || !supportsLanguage(lang)) {
    return codeBlockLines(code);
  }
  try {
    return highlight(code, {
      ignoreIllegals: true,
      language: lang,
      theme: getCliHighlightTheme(theme),
    }).split("\n");
  } catch {
    return onFailure(code);
  }
}

const highlightCode: {
  (lang: string | undefined): (code: string) => string[];
  (code: string, lang: string | undefined): string[];
} = Fn.dual(2, (code: string, lang: string | undefined): string[] =>
  highlightLines(code, lang, (source) => source.split("\n")),
);

function highlightMarkdownCode(code: string, lang?: string): string[] {
  return highlightLines(code, lang, codeBlockLines);
}

const LANGUAGE_BY_EXTENSION: Readonly<Record<string, string>> = {
  bash: "bash",
  c: "c",
  cc: "cpp",
  cjs: "javascript",
  clj: "clojure",
  cmake: "cmake",
  cpp: "cpp",
  cs: "csharp",
  css: "css",
  cxx: "cpp",
  dockerfile: "dockerfile",
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",
  fish: "fish",
  go: "go",
  graphql: "graphql",
  h: "c",
  hcl: "hcl",
  hpp: "cpp",
  hs: "haskell",
  htm: "html",
  html: "html",
  java: "java",
  js: "javascript",
  json: "json",
  jsx: "javascript",
  kt: "kotlin",
  less: "less",
  lua: "lua",
  makefile: "makefile",
  markdown: "markdown",
  md: "markdown",
  mjs: "javascript",
  ml: "ocaml",
  perl: "perl",
  php: "php",
  proto: "protobuf",
  ps1: "powershell",
  py: "python",
  r: "r",
  rb: "ruby",
  rs: "rust",
  sass: "sass",
  scala: "scala",
  scss: "scss",
  sh: "bash",
  sql: "sql",
  swift: "swift",
  tf: "hcl",
  toml: "toml",
  ts: "typescript",
  tsx: "typescript",
  vim: "vim",
  xml: "xml",
  yaml: "yaml",
  yml: "yaml",
  zsh: "bash",
};

function getLanguageFromPath(filePath: string): string | undefined {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (ext === undefined || ext === "") return undefined;
  return LANGUAGE_BY_EXTENSION[ext];
}

const themeHighlight = {
  getLanguageFromPath,
  highlightCode,
  highlightMarkdownCode,
};

export default themeHighlight;
