import {
  convertLrgbToRgb,
  convertOkhslToOklab,
  convertOklabToLrgb,
  convertOklabToOkhsl,
  convertRgbToOklab,
} from "culori/fn";
import { dual } from "effect/Function";

import type terminalColorsTypes from "./terminal-colors.types.ts";

type Vector = [number, number, number];

const oklabToOkhslLightness = (x: number): number => convertOklabToOkhsl({ a: 0, b: 0, l: x }).l;

function oklabToLinearSrgb([l, a, b]: Vector): Vector {
  const linear = convertOklabToLrgb({ a, b, l });
  return [linear.r, linear.g, linear.b];
}

function rgbToOklab(rgb: terminalColorsTypes.RgbColor): Vector {
  const lab = convertRgbToOklab({ b: rgb.b / 255, g: rgb.g / 255, r: rgb.r / 255 });
  return [lab.l, lab.a, lab.b];
}

const toByte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);

function linearSrgbToRgb([r, g, b]: Vector): terminalColorsTypes.RgbColor {
  const srgb = convertLrgbToRgb({ b, g, r });
  return { b: toByte(srgb.b), g: toByte(srgb.g), r: toByte(srgb.r) };
}

const okhslToRgb: {
  (hue: number, saturation: number, lightness: number): terminalColorsTypes.RgbColor;
  (saturation: number, lightness: number): (hue: number) => terminalColorsTypes.RgbColor;
} = dual(3, (hue: number, saturation: number, lightness: number): terminalColorsTypes.RgbColor => {
  const s = lightness > 0 ? saturation : 0;
  const lab = convertOkhslToOklab({ h: hue, l: lightness, s });
  return linearSrgbToRgb(oklabToLinearSrgb([lab.l, lab.a, lab.b]));
});

function rgbToOkhsl(rgb: terminalColorsTypes.RgbColor): { h: number; s: number; l: number } {
  const [l, a, b] = rgbToOklab(rgb);
  const okhsl = convertOklabToOkhsl({ a, b, l });
  return { h: okhsl.h ?? 0, l: okhsl.l, s: Math.min(1, Math.max(0, okhsl.s)) };
}

const oklab = {
  linearSrgbToRgb,
  okhslToRgb,
  oklabToLinearSrgb,
  oklabToOkhslLightness,
  rgbToOkhsl,
  rgbToOklab,
};

export default oklab;
