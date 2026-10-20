import type tuiTypes from "@msa/tui/index.types";

import type ThemeClass from "./theme-class.ts";
import type themeSchemaTypes from "./theme-schema.types.ts";
import type themeTokensTypes from "./theme-tokens.types.ts";

declare namespace themeTypes {
  interface ThemeStyle extends tuiTypes.TextAttributes {
    fg?: themeTokensTypes.ThemeColor | tuiTypes.Color;
    bg?: themeTokensTypes.ThemeBg | tuiTypes.Color;
  }

  type ThemeJsonValidator = (label: string, json: unknown) => themeSchemaTypes.ValidatedThemeJson;

  type ThemeAppearance = TerminalTheme;

  interface ThemeInfo {
    name: string;
    path: string | undefined;
  }

  type TerminalTheme = "dark" | "light";

  type Theme = (typeof ThemeClass)["prototype"];

  type ThemeJson = themeSchemaTypes.ValidatedThemeJson;

  type ThemeBg = themeTokensTypes.ThemeBg;

  type ThemeColor = themeTokensTypes.ThemeColor;

  type ThemeToken = themeTokensTypes.ThemeToken;
}

export type { themeTypes as default };
