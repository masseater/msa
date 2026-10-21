import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import colorContrast from "./color-contrast.ts";
import systemThemePalette from "./system-theme-palette.ts";
import type systemThemeTypes from "./system-theme.types.ts";

const {
  colorToOkhsl,
  colorToOklch,
  colorToRgb,
  okhslColor,
  oklabToOkhslLightness,
  oklchColor,
  rgbColor,
} = tui;

function bellWeight(lightness: number): number {
  const gaussian = (x: number): number => Math.exp(-((x - 0.5) ** 2) / (2 * 0.25 ** 2));
  return (gaussian(lightness) - gaussian(0)) / (1 - gaussian(0));
}

function saturationCurve(
  { saturation: { min, max } }: systemThemeTypes.Family,
  lightness: number,
): number {
  const floor = max > 0 ? min / max : 1;
  return floor + (1 - floor) * bellWeight(lightness);
}

function okhslOf({ r, g, b }: tuiTypes.RgbColor): tuiTypes.OkhslChannels {
  return colorToOkhsl(rgbColor(r, g, b));
}

function sourceOf(color: tuiTypes.RgbColor): systemThemeTypes.SourceColor {
  return { ...okhslOf(color), chroma: colorToOklch(rgbColor(color.r, color.g, color.b)).c };
}

function anchored(
  source: systemThemeTypes.SourceColor,
  family: systemThemeTypes.Family,
  lightness: number,
  saturation: number,
): tuiTypes.RgbColor {
  const anchor = saturationCurve(family, source.l);
  const falloff = anchor > 0 ? Math.min(1, saturationCurve(family, lightness) / anchor) : 1;
  const color = okhslColor(source.h, source.s * falloff * saturation, lightness);
  const cap = source.chroma * falloff * saturation;
  const { l, c } = colorToOklch(color);
  return c <= cap ? color : colorToRgb(oklchColor(l, cap, source.h));
}

function paintToken(
  palette: systemThemeTypes.SourceColor[] | undefined,
  saturation: number,
): systemThemeTypes.PaintToken {
  return (token, oklabL) => {
    const lightness = oklabToOkhslLightness(oklabL);
    const family = systemThemePalette.familyOf(token);
    const source = palette?.[systemThemePalette.paletteSlotOf(token)];
    if (source === undefined) {
      const { min, max } = family.saturation;
      return okhslColor(
        family.hue,
        (min + (max - min) * bellWeight(lightness)) * saturation,
        lightness,
      );
    }
    return anchored(source, family, lightness, saturation);
  };
}

function withTextContrast(
  color: tuiTypes.RgbColor,
  surfaces: tuiTypes.RgbColor[],
  lighter: boolean,
): tuiTypes.RgbColor {
  const meets = (candidate: tuiTypes.RgbColor) =>
    colorContrast.meetsTextContrast(candidate, surfaces);
  if (meets(color)) return color;
  const { h, s, l } = okhslOf(color);
  const at = (lightness: number) => okhslColor(h, s, lightness);
  const extreme = lighter ? 1 : 0;
  if (!meets(at(extreme))) return at(extreme);
  let [low, high] = [l, extreme];
  for (let index = 0; index < 20; index++) {
    const middle = (low + high) / 2;
    if (meets(at(middle))) high = middle;
    else low = middle;
  }
  return at(high);
}

const systemThemeShading = {
  anchored,
  paintToken,
  sourceOf,
  withTextContrast,
};

export default systemThemeShading;
