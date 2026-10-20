import type tuiTypes from "@msa/tui/index.types";

import type themeTypes from "./theme.types.ts";

declare namespace systemThemeTypes {
  interface SystemThemeInput {
    foreground?: tuiTypes.RgbColor | undefined;
    background?: tuiTypes.RgbColor | undefined;
    palette?: tuiTypes.RgbColor[] | undefined;
    saturation?: number;
    appearanceHint?: themeTypes.ThemeAppearance;
  }

  interface SystemThemeColors {
    colors: Record<themeTypes.ThemeToken, string | number>;
    dim: themeTypes.ThemeColor[];
    appearance: themeTypes.ThemeAppearance | undefined;
  }
}

export type { systemThemeTypes as default };
