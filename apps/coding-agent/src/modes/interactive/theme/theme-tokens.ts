import type themeTokensTypes from "./theme-tokens.types.ts";

function defineThemeTokens<const T extends themeTokensTypes.ThemeTokenDescriptors>(tokens: T): T {
  for (const [name, descriptor] of Object.entries(tokens)) {
    if (descriptor.fallback === undefined) continue;
    const fallback = tokens[descriptor.fallback];
    if (fallback === undefined) {
      throw new Error(`Theme token ${name} has unknown fallback ${descriptor.fallback}`);
    }
    if (fallback.slot !== descriptor.slot) {
      throw new Error(
        `Theme token ${name} has fallback ${descriptor.fallback} in a different color slot`,
      );
    }
  }
  return tokens;
}

const THEME_TOKENS = defineThemeTokens({
  accent: {
    description: "Primary accent color (logo, selected items, cursor)",
    slot: "foreground",
  },
  bashMode: { description: "Editor border color in bash mode", slot: "foreground" },
  border: { description: "Normal borders", slot: "foreground" },
  borderAccent: { description: "Highlighted borders", slot: "foreground" },
  borderMuted: { description: "Subtle borders", slot: "foreground" },
  customMessageBg: {
    description: "Custom message background (hook-injected messages)",
    slot: "background",
  },
  customMessageLabel: { description: "Custom message type label color", slot: "foreground" },
  customMessageText: { description: "Custom message text color", slot: "foreground" },
  dim: { description: "Very dimmed text (more subtle than muted)", slot: "foreground" },
  error: { description: "Error states", slot: "foreground" },
  mdCode: { description: "Markdown inline code", slot: "foreground" },
  mdCodeBlock: { description: "Markdown code block content", slot: "foreground" },
  mdCodeBlockBorder: { description: "Markdown code block fences", slot: "foreground" },
  mdHeading: { description: "Markdown heading text", slot: "foreground" },
  mdHr: { description: "Markdown horizontal rule", slot: "foreground" },
  mdLink: { description: "Markdown link text", slot: "foreground" },
  mdLinkUrl: { description: "Markdown link URL", slot: "foreground" },
  mdListBullet: { description: "Markdown list bullets/numbers", slot: "foreground" },
  mdQuote: { description: "Markdown blockquote text", slot: "foreground" },
  mdQuoteBorder: { description: "Markdown blockquote border", slot: "foreground" },
  muted: { description: "Secondary/dimmed text", slot: "foreground" },
  scrollbarThumb: {
    description: "Fullscreen scrollbar thumb foreground (falls back to text when omitted)",
    fallback: "text",
    slot: "foreground",
  },
  scrollbarTrack: {
    description: "Fullscreen scrollbar track foreground (falls back to muted when omitted)",
    fallback: "muted",
    slot: "foreground",
  },
  searchMatchBg: {
    description:
      "Transcript search match background and current-match text (falls back to selectedBg when omitted)",
    fallback: "selectedBg",
    slot: "background",
  },
  searchMatchText: {
    description:
      "Transcript search match text and current-match background (falls back to text when omitted)",
    fallback: "text",
    slot: "foreground",
  },
  selectedBg: { description: "Selected item background", slot: "background" },
  success: { description: "Success states", slot: "foreground" },
  syntaxComment: { description: "Syntax highlighting: comments", slot: "foreground" },
  syntaxFunction: { description: "Syntax highlighting: function names", slot: "foreground" },
  syntaxKeyword: { description: "Syntax highlighting: keywords", slot: "foreground" },
  syntaxNumber: { description: "Syntax highlighting: number literals", slot: "foreground" },
  syntaxOperator: { description: "Syntax highlighting: operators", slot: "foreground" },
  syntaxPunctuation: { description: "Syntax highlighting: punctuation", slot: "foreground" },
  syntaxString: { description: "Syntax highlighting: string literals", slot: "foreground" },
  syntaxType: { description: "Syntax highlighting: type names", slot: "foreground" },
  syntaxVariable: { description: "Syntax highlighting: variable names", slot: "foreground" },
  text: { description: "Default text color (usually empty string)", slot: "foreground" },
  thinkingHigh: { description: "Thinking level border: high", slot: "foreground" },
  thinkingLow: { description: "Thinking level border: low", slot: "foreground" },
  thinkingMax: {
    description: "Thinking level border: max (falls back to thinkingXhigh when omitted)",
    fallback: "thinkingXhigh",
    slot: "foreground",
  },
  thinkingMedium: { description: "Thinking level border: medium", slot: "foreground" },
  thinkingMinimal: { description: "Thinking level border: minimal", slot: "foreground" },
  thinkingOff: { description: "Thinking level border: off", slot: "foreground" },
  thinkingText: { description: "Thinking block text color", slot: "foreground" },
  thinkingXhigh: { description: "Thinking level border: xhigh", slot: "foreground" },
  toolDiffAdded: { description: "Added lines in tool diffs", slot: "foreground" },
  toolDiffContext: { description: "Context lines in tool diffs", slot: "foreground" },
  toolDiffRemoved: { description: "Removed lines in tool diffs", slot: "foreground" },
  toolErrorBg: { description: "Tool execution box (error state)", slot: "background" },
  toolOutput: { description: "Tool execution box output text color", slot: "foreground" },
  toolPendingBg: { description: "Tool execution box (pending state)", slot: "background" },
  toolSuccessBg: { description: "Tool execution box (success state)", slot: "background" },
  toolTitle: { description: "Tool execution box title color", slot: "foreground" },
  userMessageBg: { description: "User message background", slot: "background" },
  userMessageText: { description: "User message text color", slot: "foreground" },
  warning: { description: "Warning states", slot: "foreground" },
});

const themeTokens = {
  THEME_TOKENS,
};

export default themeTokens;
