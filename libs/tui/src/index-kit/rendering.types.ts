import type colorsTypes from "../colors.types.ts";
import type latexTypes from "../latex.types.ts";
import type terminalColorsTypes from "../terminal-colors.types.ts";

declare namespace tuiRenderingKitTypes {
  type Color = colorsTypes.Color;
  type ColorMixSpace = colorsTypes.ColorMixSpace;
  type IndexedColor = colorsTypes.IndexedColor;
  type OkhslChannels = colorsTypes.OkhslChannels;
  type OklchChannels = colorsTypes.OklchChannels;
  type OklchColorValue = colorsTypes.OklchColorValue;
  type RgbColorValue = colorsTypes.RgbColorValue;
  type TerminalColorMode = colorsTypes.TerminalColorMode;
  type TextAttributes = colorsTypes.TextAttributes;
  type TextStyle = colorsTypes.TextStyle;
  type RenderLatexOptions = latexTypes.RenderLatexOptions;
  type RgbColor = terminalColorsTypes.RgbColor;
  type TerminalColorScheme = terminalColorsTypes.TerminalColorScheme;
  type TerminalColors = terminalColorsTypes.TerminalColors;
}

export type { tuiRenderingKitTypes as default };
