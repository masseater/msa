import type systemThemeTypes from "./system-theme.types.ts";
import type themeTypes from "./theme.types.ts";

const FAMILIES = {
  blue: { hue: 231.49, saturation: { max: 0.68, min: 0.1 }, slot: 4 },
  calamine: { hue: 202.43, saturation: { max: 0.74, min: 0.1 }, slot: 6 },
  green: { hue: 158.68, saturation: { max: 0.76, min: 0.1 }, slot: 2 },
  neutral: { hue: 231.49, saturation: { max: 0.08, min: 0.02 }, slot: 8 },
  orange: { hue: 52, saturation: { max: 0.85, min: 0.12 }, slot: 3 },
  red: { hue: 20, saturation: { max: 0.92, min: 0.1 }, slot: 1 },
  thinkingBlue: { hue: 231.49, saturation: { max: 0.45, min: 0.2 }, slot: 4 },
  thinkingMagenta: { hue: 337.5, saturation: { max: 0.85, min: 0.5 }, slot: 13 },
  thinkingPeriwinkle: { hue: 263.25, saturation: { max: 0.6, min: 0.3 }, slot: 6 },
  thinkingRed: { hue: 20, saturation: { max: 1, min: 0.95 }, slot: 1 },
  thinkingSlate: { hue: 231.49, saturation: { max: 0.2, min: 0.08 }, slot: 4 },
  thinkingViolet: { hue: 295, saturation: { max: 0.75, min: 0.4 }, slot: 5 },
  violet: { hue: 295, saturation: { max: 0.6, min: 0.2 }, slot: 5 },
  yellow: { hue: 82.36, saturation: { max: 1, min: 0.5 }, slot: 3 },
} satisfies Record<string, systemThemeTypes.Family>;

type FamilyName = keyof typeof FAMILIES;

const TOKEN_FAMILIES: Record<themeTypes.ThemeToken, FamilyName> = {
  accent: "violet",
  bashMode: "green",
  border: "blue",
  borderAccent: "violet",
  borderMuted: "neutral",
  customMessageBg: "violet",
  customMessageLabel: "violet",
  customMessageText: "neutral",
  dim: "neutral",
  error: "red",
  mdCode: "violet",
  mdCodeBlock: "green",
  mdCodeBlockBorder: "neutral",
  mdHeading: "yellow",
  mdHr: "neutral",
  mdLink: "blue",
  mdLinkUrl: "neutral",
  mdListBullet: "violet",
  mdQuote: "neutral",
  mdQuoteBorder: "neutral",
  muted: "neutral",
  scrollbarThumb: "neutral",
  scrollbarTrack: "neutral",
  searchMatchBg: "orange",
  searchMatchText: "neutral",
  selectedBg: "blue",
  success: "green",
  syntaxComment: "neutral",
  syntaxFunction: "yellow",
  syntaxKeyword: "blue",
  syntaxNumber: "green",
  syntaxOperator: "neutral",
  syntaxPunctuation: "neutral",
  syntaxString: "orange",
  syntaxType: "violet",
  syntaxVariable: "calamine",
  text: "neutral",
  thinkingHigh: "thinkingViolet",
  thinkingLow: "thinkingBlue",
  thinkingMax: "thinkingRed",
  thinkingMedium: "thinkingPeriwinkle",
  thinkingMinimal: "thinkingSlate",
  thinkingOff: "neutral",
  thinkingText: "neutral",
  thinkingXhigh: "thinkingMagenta",
  toolDiffAdded: "green",
  toolDiffContext: "neutral",
  toolDiffRemoved: "red",
  toolErrorBg: "red",
  toolOutput: "neutral",
  toolPendingBg: "neutral",
  toolSuccessBg: "green",
  toolTitle: "neutral",
  userMessageBg: "blue",
  userMessageText: "neutral",
  warning: "yellow",
};

const TOKEN_SLOTS: Partial<Record<themeTypes.ThemeToken, number>> = {
  searchMatchBg: 3,
  syntaxNumber: 5,
  syntaxString: 2,
};

function familyOf(token: themeTypes.ThemeToken): systemThemeTypes.Family {
  return FAMILIES[TOKEN_FAMILIES[token]];
}

function isNeutralToken(token: themeTypes.ThemeToken): boolean {
  return TOKEN_FAMILIES[token] === "neutral";
}

function paletteSlotOf(token: themeTypes.ThemeToken): number {
  return TOKEN_SLOTS[token] ?? familyOf(token).slot;
}

const THEME_TOKENS = Object.keys(TOKEN_FAMILIES) as themeTypes.ThemeToken[];

const systemThemePalette = {
  FAMILIES,
  THEME_TOKENS,
  familyOf,
  isNeutralToken,
  paletteSlotOf,
};

export default systemThemePalette;
