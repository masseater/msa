import themeTokens from "./theme-tokens.ts";
import type themeTokensTypes from "./theme-tokens.types.ts";
const { THEME_TOKENS } = themeTokens;

function withThemeTokenFallbacks<Value>(
  values: themeTokensTypes.ThemeColorValues<Value>,
): themeTokensTypes.ResolvedThemeColorValues<Value> {
  const resolved = { ...values } as Partial<themeTokensTypes.ResolvedThemeColorValues<Value>>;
  for (const [rawName, descriptor] of Object.entries(THEME_TOKENS)) {
    if (!("fallback" in descriptor)) continue;
    const name = rawName as themeTokensTypes.ThemeToken;
    if (resolved[name] !== undefined) continue;
    const fallback = descriptor.fallback as themeTokensTypes.ThemeToken;
    const fallbackValue = resolved[fallback];
    if (fallbackValue === undefined) {
      throw new Error(`Theme token ${rawName} has unresolved fallback ${descriptor.fallback}`);
    }
    resolved[name] = fallbackValue;
  }
  return resolved as themeTokensTypes.ResolvedThemeColorValues<Value>;
}

function splitThemeColors(colors: themeTokensTypes.ResolvedThemeColorValues<string | number>): {
  fgColors: Record<themeTokensTypes.ThemeColor, string | number>;
  bgColors: Record<themeTokensTypes.ThemeBg, string | number>;
} {
  const fgColors = {} as Record<themeTokensTypes.ThemeColor, string | number>;
  const bgColors = {} as Record<themeTokensTypes.ThemeBg, string | number>;
  for (const [key, value] of Object.entries(colors)) {
    if (THEME_TOKENS[key as themeTokensTypes.ThemeToken].slot === "background") {
      bgColors[key as themeTokensTypes.ThemeBg] = value;
    } else {
      fgColors[key as themeTokensTypes.ThemeColor] = value;
    }
  }
  return { bgColors, fgColors };
}

const themeColorTokens = { splitThemeColors, withThemeTokenFallbacks };

export default themeColorTokens;
