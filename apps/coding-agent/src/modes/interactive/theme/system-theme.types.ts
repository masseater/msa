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

  interface Family {
    hue: number;
    saturation: { min: number; max: number };
    slot: number;
  }

  interface Curve {
    coefficients: number[];
    reachable: [number, number];
  }

  type Level =
    | "emphasis"
    | "panel"
    | "readable"
    | "subtle"
    | "text"
    | "textOnPanel"
    | "thinking0"
    | "thinking1"
    | "thinking2"
    | "thinking3"
    | "thinking4"
    | "thinking5"
    | "thinking6"
    | "thumb"
    | "track";

  type Surface = themeTypes.ThemeBg | "background" | "scrollbarTrack";

  interface Rule {
    token: themeTypes.ThemeToken;
    on: Surface[];
    level: Level;
  }

  interface SourceColor extends tuiTypes.OkhslChannels {
    chroma: number;
  }

  type SolvedColors = Map<Surface | themeTypes.ThemeToken, tuiTypes.RgbColor>;

  type LightnessTarget = (level: Level, surfaceL: number, relaxation: number) => number | undefined;

  type PaintToken = (token: themeTypes.ThemeToken, oklabL: number) => tuiTypes.RgbColor;
}

export type { systemThemeTypes as default };
