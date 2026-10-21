import type tuiTypes from "@msa/tui/index.types";

import themeHighlight from "./theme-highlight.ts";
import themeState from "./theme-state.ts";

const { theme } = themeState;

function getMarkdownTheme(): tuiTypes.MarkdownTheme {
  return {
    bold: (text: string) => theme.bold(text),
    code: (text: string) => theme.fg("mdCode", text),
    codeBlock: (text: string) => theme.fg("mdCodeBlock", text),
    codeBlockBorder: (text: string) => theme.fg("mdCodeBlockBorder", text),
    heading: (text: string) => theme.fg("mdHeading", text),
    highlightCode: themeHighlight.highlightMarkdownCode,
    hr: (text: string) => theme.fg("mdHr", text),
    italic: (text: string) => theme.italic(text),
    link: (text: string) => theme.fg("mdLink", text),
    linkUrl: (text: string) => theme.fg("mdLinkUrl", text),
    listBullet: (text: string) => theme.fg("mdListBullet", text),
    quote: (text: string) => theme.fg("mdQuote", text),
    quoteBorder: (text: string) => theme.fg("mdQuoteBorder", text),
    strikethrough: (text: string) => theme.strikethrough(text),
    underline: (text: string) => theme.underline(text),
  };
}

function getSelectListTheme(): tuiTypes.SelectListTheme {
  return {
    description: (text: string) => theme.fg("muted", text),
    noMatch: (text: string) => theme.fg("muted", text),
    scrollInfo: (text: string) => theme.fg("muted", text),
    selectedPrefix: (text: string) => theme.fg("accent", text),
    selectedText: (text: string) => theme.fg("accent", text),
  };
}

function getEditorTheme(): tuiTypes.EditorTheme {
  return {
    borderColor: (text: string) => theme.fg("borderMuted", text),
    selectList: getSelectListTheme(),
  };
}

function getSettingsListTheme(): tuiTypes.SettingsListTheme {
  return {
    cursor: theme.fg("accent", "→ "),
    description: (text: string) => theme.fg("dim", text),
    hint: (text: string) => theme.fg("dim", text),
    label: (text: string, selected: boolean) => (selected ? theme.fg("accent", text) : text),
    value: (text: string, selected: boolean) =>
      selected ? theme.fg("accent", text) : theme.fg("muted", text),
  };
}

const componentThemes = {
  getEditorTheme,
  getMarkdownTheme,
  getSelectListTheme,
  getSettingsListTheme,
};

export default componentThemes;
