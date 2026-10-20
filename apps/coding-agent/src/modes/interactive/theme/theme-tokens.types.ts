import type themeTokens from "./theme-tokens.ts";

declare namespace themeTokensTypes {
  interface ThemeTokenDescriptor {
    slot: "foreground" | "background";
    description: string;
    fallback?: string;
  }

  type ThemeTokenDescriptors = Readonly<Record<string, ThemeTokenDescriptor>>;

  type ThemeToken = keyof typeof themeTokens.THEME_TOKENS;

  type ThemeColor = {
    [K in ThemeToken]: (typeof themeTokens.THEME_TOKENS)[K]["slot"] extends "foreground"
      ? K
      : never;
  }[ThemeToken];

  type ThemeBg = Exclude<ThemeToken, ThemeColor>;

  type OptionalToken = {
    [K in ThemeToken]: (typeof themeTokens.THEME_TOKENS)[K] extends { fallback: string }
      ? K
      : never;
  }[ThemeToken];

  type RequiredToken = Exclude<ThemeToken, OptionalToken>;

  type ThemeColorValues<Value> = {
    [K in RequiredToken]: Value;
  } & {
    [K in OptionalToken]?: Value;
  };

  type ResolvedThemeColorValues<Value> = Record<ThemeToken, Value>;
}

export type { themeTokensTypes as default };
