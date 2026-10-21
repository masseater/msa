import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
import { Function as Fn } from "effect";

import type themeTypes from "./theme.types.ts";

const { colorToOklch, rgbColor } = tui;

const TEXT_MINIMUM_WCAG_CONTRAST = 4.5;
const WHITE: tuiTypes.RgbColor = { b: 255, g: 255, r: 255 };
const BLACK: tuiTypes.RgbColor = { b: 0, g: 0, r: 0 };

function oklabLightness(color: tuiTypes.RgbColor): number {
  return colorToOklch(rgbColor(color.r, color.g, color.b)).l;
}

function relativeLuminance({ r, g, b }: tuiTypes.RgbColor): number {
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

const wcagContrast: {
  (second: tuiTypes.RgbColor): (first: tuiTypes.RgbColor) => number;
  (first: tuiTypes.RgbColor, second: tuiTypes.RgbColor): number;
} = Fn.dual(2, (first: tuiTypes.RgbColor, second: tuiTypes.RgbColor): number => {
  const a = relativeLuminance(first);
  const b = relativeLuminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
});

function appearanceFromForeground(
  background: tuiTypes.RgbColor,
  foreground: tuiTypes.RgbColor,
): themeTypes.ThemeAppearance | undefined {
  const foregroundL = oklabLightness(foreground);
  const backgroundL = oklabLightness(background);
  if (Math.abs(foregroundL - backgroundL) <= 0.05) return undefined;
  const appearance = foregroundL > backgroundL ? "dark" : "light";
  const best = wcagContrast(appearance === "dark" ? WHITE : BLACK, background);
  return best >= TEXT_MINIMUM_WCAG_CONTRAST ? appearance : undefined;
}

const terminalAppearance: {
  (
    foreground: tuiTypes.RgbColor | undefined,
  ): (background: tuiTypes.RgbColor) => themeTypes.ThemeAppearance;
  (
    background: tuiTypes.RgbColor,
    foreground: tuiTypes.RgbColor | undefined,
  ): themeTypes.ThemeAppearance;
} = Fn.dual(
  2,
  (
    background: tuiTypes.RgbColor,
    foreground: tuiTypes.RgbColor | undefined,
  ): themeTypes.ThemeAppearance => {
    const fromForeground =
      foreground === undefined ? undefined : appearanceFromForeground(background, foreground);
    if (fromForeground !== undefined) return fromForeground;
    return wcagContrast(WHITE, background) >= wcagContrast(BLACK, background) ? "dark" : "light";
  },
);

function readableAgainstExtreme(lighter: boolean): (color: tuiTypes.RgbColor) => boolean {
  const extremeText = lighter ? WHITE : BLACK;
  return (color) => wcagContrast(extremeText, color) >= TEXT_MINIMUM_WCAG_CONTRAST;
}

function meetsTextContrast(candidate: tuiTypes.RgbColor, surfaces: tuiTypes.RgbColor[]): boolean {
  return surfaces.every(
    (surface) => wcagContrast(candidate, surface) >= TEXT_MINIMUM_WCAG_CONTRAST,
  );
}

function hexOf({ r, g, b }: tuiTypes.RgbColor): string {
  return `#${[r, g, b].map((channel) => Math.round(channel).toString(16).padStart(2, "0")).join("")}`;
}

const colorContrast = {
  hexOf,
  meetsTextContrast,
  oklabLightness,
  readableAgainstExtreme,
  relativeLuminance,
  terminalAppearance,
  wcagContrast,
};

export default colorContrast;
