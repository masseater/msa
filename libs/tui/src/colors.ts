import { dual } from "effect/Function";

import type colorsTypes from "./colors.types.ts";
import oklab from "./oklab.ts";
import type terminalColorsTypes from "./terminal-colors.types.ts";

const { linearSrgbToRgb, okhslToRgb, oklabToLinearSrgb, rgbToOkhsl, rgbToOklab } = oklab;

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

function indexedColor(index: number): colorsTypes.IndexedColor {
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    throw new Error(`ANSI color index must be an integer from 0 to 255: ${index}`);
  }
  return Object.freeze({ index, kind: "indexed" });
}

const rgbColor: {
  (r: number, g: number, b: number): colorsTypes.RgbColorValue;
  (g: number, b: number): (r: number) => colorsTypes.RgbColorValue;
} = dual(3, (r: number, g: number, b: number): colorsTypes.RgbColorValue => {
  for (const [name, value] of [
    ["r", r],
    ["g", g],
    ["b", b],
  ] as const) {
    requireFinite(value, name);
    if (value < 0 || value > 255) throw new Error(`${name} must be between 0 and 255: ${value}`);
  }
  return Object.freeze({ b, g, kind: "rgb", r });
});

const oklchColor: {
  (l: number, c: number, h: number): colorsTypes.OklchColorValue;
  (c: number, h: number): (l: number) => colorsTypes.OklchColorValue;
} = dual(3, (l: number, c: number, h: number): colorsTypes.OklchColorValue => {
  requireFinite(l, "l");
  requireFinite(c, "c");
  requireFinite(h, "h");
  if (l < 0 || l > 1) throw new Error(`l must be between 0 and 1: ${l}`);
  if (c < 0) throw new Error(`c must not be negative: ${c}`);
  return Object.freeze({ c, h: ((h % 360) + 360) % 360, kind: "oklch", l });
});

const NUMBER_PATTERN = String.raw`[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?`;
const DEGREE_PATTERN = "[Dd][Ee][Gg]";
const OKLCH_PATTERN = new RegExp(
  `^[Oo][Kk][Ll][Cc][Hh]\\(\\s*(${NUMBER_PATTERN})(%)?\\s+(${NUMBER_PATTERN})\\s+(${NUMBER_PATTERN})(?:${DEGREE_PATTERN})?\\s*\\)$`,
  "u",
);
const OKHSL_PATTERN = new RegExp(
  `^[Oo][Kk][Hh][Ss][Ll]\\(\\s*(${NUMBER_PATTERN})(?:${DEGREE_PATTERN})?\\s+(${NUMBER_PATTERN})(%)?\\s+(${NUMBER_PATTERN})(%)?\\s*\\)$`,
  "u",
);

const okhslColor: {
  (h: number, s: number, l: number): colorsTypes.RgbColorValue;
  (s: number, l: number): (h: number) => colorsTypes.RgbColorValue;
} = dual(3, (h: number, s: number, l: number): colorsTypes.RgbColorValue => {
  requireFinite(h, "h");
  requireFinite(s, "s");
  requireFinite(l, "l");
  if (s < 0 || s > 1) throw new Error(`s must be between 0 and 1: ${s}`);
  if (l < 0 || l > 1) throw new Error(`l must be between 0 and 1: ${l}`);
  const { r, g, b } = okhslToRgb(h, s, l);
  return rgbColor(r, g, b);
});

function colorToOkhsl(color: colorsTypes.Color): colorsTypes.OkhslChannels {
  return rgbToOkhsl(colorToRgb(color));
}

function parseColor(value: string | number): colorsTypes.Color {
  if (typeof value === "number") return indexedColor(value);

  const hex = /^#([\da-f]{3}|[\da-f]{6})$/iu.exec(value)?.[1];
  if (hex !== undefined) {
    const digits = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return rgbColor(
      Number.parseInt(digits.slice(0, 2), 16),
      Number.parseInt(digits.slice(2, 4), 16),
      Number.parseInt(digits.slice(4, 6), 16),
    );
  }

  const [, oklchL, oklchLPercent, oklchC, oklchH] = OKLCH_PATTERN.exec(value) ?? [];
  if (oklchL !== undefined && oklchC !== undefined && oklchH !== undefined) {
    const lightness =
      Number.parseFloat(oklchL) / (oklchLPercent !== undefined && oklchLPercent !== "" ? 100 : 1);
    return oklchColor(lightness, Number.parseFloat(oklchC), Number.parseFloat(oklchH));
  }

  const [, okhslH, okhslS, okhslSPercent, okhslL, okhslLPercent] = OKHSL_PATTERN.exec(value) ?? [];
  if (okhslH !== undefined && okhslS !== undefined && okhslL !== undefined) {
    const saturation =
      Number.parseFloat(okhslS) / (okhslSPercent !== undefined && okhslSPercent !== "" ? 100 : 1);
    const lightness =
      Number.parseFloat(okhslL) / (okhslLPercent !== undefined && okhslLPercent !== "" ? 100 : 1);
    return okhslColor(Number.parseFloat(okhslH), saturation, lightness);
  }

  throw new Error(`Invalid color value: ${value}`);
}

const BASIC_COLORS: readonly terminalColorsTypes.RgbColor[] = [
  { b: 0, g: 0, r: 0 },
  { b: 0, g: 0, r: 128 },
  { b: 0, g: 128, r: 0 },
  { b: 0, g: 128, r: 128 },
  { b: 128, g: 0, r: 0 },
  { b: 128, g: 0, r: 128 },
  { b: 128, g: 128, r: 0 },
  { b: 192, g: 192, r: 192 },
  { b: 128, g: 128, r: 128 },
  { b: 0, g: 0, r: 255 },
  { b: 0, g: 255, r: 0 },
  { b: 0, g: 255, r: 255 },
  { b: 255, g: 0, r: 0 },
  { b: 255, g: 0, r: 255 },
  { b: 255, g: 255, r: 0 },
  { b: 255, g: 255, r: 255 },
];
const CUBE_VALUES = [0, 95, 135, 175, 215, 255] as const;
const GRAY_VALUES = Array.from({ length: 24 }, (_, index) => 8 + index * 10);

function cubeValue(index: number): number {
  const value = CUBE_VALUES[index];
  if (value === undefined) throw new Error(`ANSI color cube has no level ${index}`);
  return value;
}

function indexedToRgb(index: number): terminalColorsTypes.RgbColor {
  if (index < 16) {
    const basic = BASIC_COLORS[index];
    if (basic === undefined) throw new Error(`ANSI basic color index out of range: ${index}`);
    return { ...basic };
  }
  if (index < 232) {
    const cubeIndex = index - 16;
    return {
      b: cubeValue(cubeIndex % 6),
      g: cubeValue(Math.floor((cubeIndex % 36) / 6)),
      r: cubeValue(Math.floor(cubeIndex / 36)),
    };
  }
  const gray = 8 + (index - 232) * 10;
  return { b: gray, g: gray, r: gray };
}

function isInSrgbGamut(linear: number[]): boolean {
  const epsilon = 1e-7;
  return linear.every((channel) => channel >= -epsilon && channel <= 1 + epsilon);
}

function oklchToRgb({ l, c, h }: colorsTypes.OklchChannels): terminalColorsTypes.RgbColor {
  const radians = (h * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const atChroma = (chroma: number) => oklabToLinearSrgb([l, chroma * cos, chroma * sin]);

  const direct = atChroma(c);
  if (isInSrgbGamut(direct)) return linearSrgbToRgb(direct);

  let linear = atChroma(0);
  let low = 0;
  let high = c;
  for (let index = 0; index < 20; index++) {
    const chroma = (low + high) / 2;
    const candidate = atChroma(chroma);
    if (isInSrgbGamut(candidate)) {
      low = chroma;
      linear = candidate;
    } else {
      high = chroma;
    }
  }
  return linearSrgbToRgb(linear);
}

function colorToRgb(color: colorsTypes.Color): terminalColorsTypes.RgbColor {
  switch (color.kind) {
    case "indexed":
      return indexedToRgb(color.index);
    case "rgb":
      return { b: color.b, g: color.g, r: color.r };
    case "oklch":
      return oklchToRgb(color);
  }
}

function colorToOklch(color: colorsTypes.Color): colorsTypes.OklchChannels {
  if (color.kind === "oklch") return { c: color.c, h: color.h, l: color.l };
  const [l, a, b] = rgbToOklab(colorToRgb(color));
  return { c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360, l };
}

function colorToHex(color: colorsTypes.Color): string {
  const { r, g, b } = colorToRgb(color);
  const channel = (value: number) => Math.round(value).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

const mixColors: {
  (
    first: colorsTypes.Color,
    second: colorsTypes.Color,
    amount: number,
    space?: colorsTypes.ColorMixSpace,
  ): colorsTypes.Color;
  (
    second: colorsTypes.Color,
    amount: number,
    space?: colorsTypes.ColorMixSpace,
  ): (first: colorsTypes.Color) => colorsTypes.Color;
} = dual(
  (args) => typeof args[2] === "number",
  (
    first: colorsTypes.Color,
    second: colorsTypes.Color,
    amount: number,
    space: colorsTypes.ColorMixSpace = "oklch",
  ): colorsTypes.Color => {
    requireFinite(amount, "amount");
    if (amount < 0 || amount > 1) throw new Error(`amount must be between 0 and 1: ${amount}`);

    if (space === "srgb") {
      const a = colorToRgb(first);
      const b = colorToRgb(second);
      return rgbColor(
        a.r + (b.r - a.r) * amount,
        a.g + (b.g - a.g) * amount,
        a.b + (b.b - a.b) * amount,
      );
    }

    const a = colorToOklch(first);
    const b = colorToOklch(second);
    const firstHue = a.c < 1e-7 ? b.h : a.h;
    const secondHue = b.c < 1e-7 ? firstHue : b.h;
    const hueDelta = ((secondHue - firstHue + 540) % 360) - 180;
    return oklchColor(
      a.l + (b.l - a.l) * amount,
      a.c + (b.c - a.c) * amount,
      firstHue + hueDelta * amount,
    );
  },
);

const colors = {
  CUBE_VALUES,
  GRAY_VALUES,
  colorToHex,
  colorToOkhsl,
  colorToOklch,
  colorToRgb,
  indexedColor,
  mixColors,
  okhslColor,
  oklchColor,
  parseColor,
  rgbColor,
};

export default colors;
