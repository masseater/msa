import type systemThemeTypes from "./system-theme.types.ts";
import type themeTypes from "./theme.types.ts";

type Surface = systemThemeTypes.Surface;
type Rule = systemThemeTypes.Rule;

const TOOL_PANELS: Surface[] = ["toolPendingBg", "toolSuccessBg", "toolErrorBg"];
const MESSAGE_PANELS: Surface[] = ["userMessageBg", "customMessageBg"];
const PANELS: themeTypes.ThemeBg[] = [
  "userMessageBg",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "selectedBg",
  "searchMatchBg",
  "customMessageBg",
];
const THINKING: [themeTypes.ThemeColor, systemThemeTypes.Level][] = [
  ["thinkingOff", "thinking0"],
  ["thinkingMinimal", "thinking1"],
  ["thinkingLow", "thinking2"],
  ["thinkingMedium", "thinking3"],
  ["thinkingHigh", "thinking4"],
  ["thinkingXhigh", "thinking5"],
  ["thinkingMax", "thinking6"],
];
const SYNTAX_TOKENS: themeTypes.ThemeToken[] = [
  "syntaxComment",
  "syntaxKeyword",
  "syntaxFunction",
  "syntaxVariable",
  "syntaxString",
  "syntaxNumber",
  "syntaxType",
  "syntaxOperator",
  "syntaxPunctuation",
];
const MARKDOWN_TOKENS: themeTypes.ThemeToken[] = [
  "mdHeading",
  "mdLink",
  "mdLinkUrl",
  "mdCode",
  "mdQuote",
  "mdCodeBlockBorder",
  "mdListBullet",
];

const each = (
  tokens: themeTypes.ThemeToken[],
  on: Surface[],
  level: systemThemeTypes.Level,
): Rule[] => tokens.map((token) => ({ level, on, token }));

const MESSAGE_AND_TOOL_SURFACES: Surface[] = ["background", ...MESSAGE_PANELS, ...TOOL_PANELS];
const MUTED_SURFACES: Surface[] = ["background", "selectedBg", "customMessageBg", ...TOOL_PANELS];

const RULES: Rule[] = [
  ...each(PANELS, ["background"], "panel"),
  { level: "text", on: ["background"], token: "text" },
  { level: "textOnPanel", on: ["selectedBg"], token: "text" },
  { level: "textOnPanel", on: ["userMessageBg"], token: "userMessageText" },
  { level: "textOnPanel", on: TOOL_PANELS, token: "toolTitle" },
  ...each(
    ["accent", "success", "error", "warning"],
    ["background", "selectedBg", ...TOOL_PANELS],
    "readable",
  ),
  { level: "readable", on: MUTED_SURFACES, token: "muted" },
  { level: "subtle", on: MUTED_SURFACES, token: "dim" },
  { level: "readable", on: ["background"], token: "thinkingText" },
  { level: "readable", on: ["customMessageBg", ...TOOL_PANELS], token: "customMessageText" },
  {
    level: "readable",
    on: ["background", "customMessageBg", "selectedBg", ...TOOL_PANELS],
    token: "customMessageLabel",
  },
  { level: "readable", on: ["background", ...TOOL_PANELS], token: "toolOutput" },
  ...each(MARKDOWN_TOKENS, ["background", ...MESSAGE_PANELS], "readable"),
  { level: "readable", on: MESSAGE_AND_TOOL_SURFACES, token: "mdCodeBlock" },
  ...each(
    ["toolDiffAdded", "toolDiffRemoved", "toolDiffContext"],
    ["background", ...TOOL_PANELS],
    "readable",
  ),
  ...each(SYNTAX_TOKENS, MESSAGE_AND_TOOL_SURFACES, "readable"),
  { level: "readable", on: ["searchMatchBg"], token: "searchMatchText" },
  ...each(["bashMode", "border", "borderAccent"], ["background"], "readable"),
  { level: "subtle", on: ["background"], token: "borderMuted" },
  ...each(["mdQuoteBorder", "mdHr"], MESSAGE_AND_TOOL_SURFACES, "readable"),
  { level: "track", on: ["background"], token: "scrollbarTrack" },
  { level: "thumb", on: ["scrollbarTrack"], token: "scrollbarThumb" },
  ...THINKING.map(([token, level]): Rule => ({ level, on: ["background"], token })),
];

const SOLVE_ORDER: themeTypes.ThemeToken[] = (() => {
  const order: themeTypes.ThemeToken[] = [];
  const visit = (token: themeTypes.ThemeToken): void => {
    if (order.includes(token)) return;
    for (const rule of RULES) {
      if (rule.token !== token) continue;
      for (const surface of rule.on) if (surface !== "background") visit(surface);
    }
    order.push(token);
  };
  for (const rule of RULES) visit(rule.token);
  return order;
})();

const FOREGROUND_TOKENS: themeTypes.ThemeColor[] = ["text", "userMessageText", "toolTitle"];

function isPanel(token: themeTypes.ThemeToken): boolean {
  return PANELS.includes(token as themeTypes.ThemeBg);
}

function isForegroundToken(token: themeTypes.ThemeToken): boolean {
  return FOREGROUND_TOKENS.includes(token as themeTypes.ThemeColor);
}

function rulesFor(token: themeTypes.ThemeToken): Rule[] {
  return RULES.filter((rule) => rule.token === token);
}

const systemThemeRules = {
  FOREGROUND_TOKENS,
  SOLVE_ORDER,
  isForegroundToken,
  isPanel,
  rulesFor,
};

export default systemThemeRules;
