import { dual } from "effect/Function";

import { linearSrgbToRgb, okhslToRgb, oklabToLinearSrgb, rgbToOkhsl, rgbToOklab } from "./oklab.ts";
import type { RgbColor } from "./terminal-colors.ts";

export interface IndexedColor {
  readonly kind: "indexed";
  readonly index: number;
}

export interface RgbColorValue {
  readonly kind: "rgb";
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface OklchColorValue {
  readonly kind: "oklch";
  readonly l: number;
  readonly c: number;
  readonly h: number;
}

export type Color = IndexedColor | RgbColorValue | OklchColorValue;
export type TerminalColorMode = "256color" | "truecolor";
export type ColorMixSpace = "oklch" | "srgb";

export interface OklchChannels {
  l: number;
  c: number;
  h: number;
}

export interface OkhslChannels {
  h: number;
  s: number;
  l: number;
}

export interface TextAttributes {
  bold?: boolean;
  dim?: boolean;
  italic?: boolean;
  underline?: boolean;
  inverse?: boolean;
  strikethrough?: boolean;
}

export interface TextStyle extends TextAttributes {
  fg?: Color;
  bg?: Color;
}

function requireFinite(value: number, name: string): void {
  if (!Number.isFinite(value)) throw new Error(`${name} must be finite`);
}

export function indexedColor(index: number): IndexedColor {
  if (!Number.isInteger(index) || index < 0 || index > 255) {
    throw new Error(`ANSI color index must be an integer from 0 to 255: ${index}`);
  }
  return Object.freeze({ kind: "indexed", index });
}

export const rgbColor: {
  (r: number, g: number, b: number): RgbColorValue;
  (g: number, b: number): (r: number) => RgbColorValue;
} = dual(3, (r: number, g: number, b: number): RgbColorValue => {
  for (const [name, value] of [
    ["r", r],
    ["g", g],
    ["b", b],
  ] as const) {
    requireFinite(value, name);
    if (value < 0 || value > 255) throw new Error(`${name} must be between 0 and 255: ${value}`);
  }
  return Object.freeze({ kind: "rgb", r, g, b });
});

export const oklchColor: {
  (l: number, c: number, h: number): OklchColorValue;
  (c: number, h: number): (l: number) => OklchColorValue;
} = dual(3, (l: number, c: number, h: number): OklchColorValue => {
  requireFinite(l, "l");
  requireFinite(c, "c");
  requireFinite(h, "h");
  if (l < 0 || l > 1) throw new Error(`l must be between 0 and 1: ${l}`);
  if (c < 0) throw new Error(`c must not be negative: ${c}`);
  return Object.freeze({ kind: "oklch", l, c, h: ((h % 360) + 360) % 360 });
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

export const okhslColor: {
  (h: number, s: number, l: number): RgbColorValue;
  (s: number, l: number): (h: number) => RgbColorValue;
} = dual(3, (h: number, s: number, l: number): RgbColorValue => {
  requireFinite(h, "h");
  requireFinite(s, "s");
  requireFinite(l, "l");
  if (s < 0 || s > 1) throw new Error(`s must be between 0 and 1: ${s}`);
  if (l < 0 || l > 1) throw new Error(`l must be between 0 and 1: ${l}`);
  const { r, g, b } = okhslToRgb(h, s, l);
  return rgbColor(r, g, b);
});

export function colorToOkhsl(color: Color): OkhslChannels {
  return rgbToOkhsl(colorToRgb(color));
}

export function parseColor(value: string | number): Color {
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

const BASIC_COLORS: readonly RgbColor[] = [
  { r: 0, g: 0, b: 0 },
  { r: 128, g: 0, b: 0 },
  { r: 0, g: 128, b: 0 },
  { r: 128, g: 128, b: 0 },
  { r: 0, g: 0, b: 128 },
  { r: 128, g: 0, b: 128 },
  { r: 0, g: 128, b: 128 },
  { r: 192, g: 192, b: 192 },
  { r: 128, g: 128, b: 128 },
  { r: 255, g: 0, b: 0 },
  { r: 0, g: 255, b: 0 },
  { r: 255, g: 255, b: 0 },
  { r: 0, g: 0, b: 255 },
  { r: 255, g: 0, b: 255 },
  { r: 0, g: 255, b: 255 },
  { r: 255, g: 255, b: 255 },
];
export const CUBE_VALUES = [0, 95, 135, 175, 215, 255] as const;
export const GRAY_VALUES = Array.from({ length: 24 }, (_, index) => 8 + index * 10);

function cubeValue(index: number): number {
  const value = CUBE_VALUES[index];
  if (value === undefined) throw new Error(`ANSI color cube has no level ${index}`);
  return value;
}

function indexedToRgb(index: number): RgbColor {
  if (index < 16) {
    const basic = BASIC_COLORS[index];
    if (basic === undefined) throw new Error(`ANSI basic color index out of range: ${index}`);
    return { ...basic };
  }
  if (index < 232) {
    const cubeIndex = index - 16;
    return {
      r: cubeValue(Math.floor(cubeIndex / 36)),
      g: cubeValue(Math.floor((cubeIndex % 36) / 6)),
      b: cubeValue(cubeIndex % 6),
    };
  }
  const gray = 8 + (index - 232) * 10;
  return { r: gray, g: gray, b: gray };
}

function isInSrgbGamut(linear: number[]): boolean {
  const epsilon = 1e-7;
  return linear.every((channel) => channel >= -epsilon && channel <= 1 + epsilon);
}

function oklchToRgb({ l, c, h }: OklchChannels): RgbColor {
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

export function colorToRgb(color: Color): RgbColor {
  switch (color.kind) {
    case "indexed":
      return indexedToRgb(color.index);
    case "rgb":
      return { r: color.r, g: color.g, b: color.b };
    case "oklch":
      return oklchToRgb(color);
  }
}

export function colorToOklch(color: Color): OklchChannels {
  if (color.kind === "oklch") return { l: color.l, c: color.c, h: color.h };
  const [l, a, b] = rgbToOklab(colorToRgb(color));
  return { l, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

export function colorToHex(color: Color): string {
  const { r, g, b } = colorToRgb(color);
  const channel = (value: number) => Math.round(value).toString(16).padStart(2, "0");
  return `#${channel(r)}${channel(g)}${channel(b)}`;
}

export const mixColors: {
  (first: Color, second: Color, amount: number, space?: ColorMixSpace): Color;
  (second: Color, amount: number, space?: ColorMixSpace): (first: Color) => Color;
} = dual(
  (args) => typeof args[2] === "number",
  (first: Color, second: Color, amount: number, space: ColorMixSpace = "oklch"): Color => {
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
