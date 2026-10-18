import {
  convertLrgbToRgb,
  convertOkhslToOklab,
  convertOklabToLrgb,
  convertOklabToOkhsl,
  convertRgbToOklab,
} from "culori";
import { dual } from "effect/Function";

import type { RgbColor } from "./terminal-colors.ts";

type Vector = [number, number, number];

export const oklabToOkhslLightness = (x: number): number =>
  convertOklabToOkhsl({ l: x, a: 0, b: 0 }).l;

export function oklabToLinearSrgb([l, a, b]: Vector): Vector {
  const linear = convertOklabToLrgb({ l, a, b });
  return [linear.r, linear.g, linear.b];
}

export function rgbToOklab(rgb: RgbColor): Vector {
  const lab = convertRgbToOklab({ r: rgb.r / 255, g: rgb.g / 255, b: rgb.b / 255 });
  return [lab.l, lab.a, lab.b];
}

const toByte = (value: number): number => Math.round(Math.min(1, Math.max(0, value)) * 255);

export function linearSrgbToRgb([r, g, b]: Vector): RgbColor {
  const srgb = convertLrgbToRgb({ r, g, b });
  return { r: toByte(srgb.r), g: toByte(srgb.g), b: toByte(srgb.b) };
}

export const okhslToRgb: {
  (hue: number, saturation: number, lightness: number): RgbColor;
  (saturation: number, lightness: number): (hue: number) => RgbColor;
} = dual(3, (hue: number, saturation: number, lightness: number): RgbColor => {
  const s = lightness > 0 ? saturation : 0;
  const lab = convertOkhslToOklab({ h: hue, s, l: lightness });
  return linearSrgbToRgb(oklabToLinearSrgb([lab.l, lab.a, lab.b]));
});

export function rgbToOkhsl(rgb: RgbColor): { h: number; s: number; l: number } {
  const [l, a, b] = rgbToOklab(rgb);
  const okhsl = convertOklabToOkhsl({ l, a, b });
  return { h: okhsl.h ?? 0, s: Math.min(1, Math.max(0, okhsl.s)), l: okhsl.l };
}
