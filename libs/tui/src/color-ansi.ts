import { dual } from "effect/Function";

import {
  type Color,
  colorToRgb,
  CUBE_VALUES,
  GRAY_VALUES,
  type TerminalColorMode,
  type TextAttributes,
  type TextStyle,
} from "./colors.ts";
import type { RgbColor } from "./terminal-colors.ts";

function findClosest(values: readonly number[], target: number): { index: number; value: number } {
  let closest: { index: number; value: number; distance: number } | undefined;
  for (const [index, value] of values.entries()) {
    const distance = Math.abs(target - value);
    if (closest === undefined || distance < closest.distance) {
      closest = { index, value, distance };
    }
  }
  if (closest === undefined) throw new Error("findClosest needs at least one value");
  return closest;
}

function colorDistance(first: RgbColor, second: RgbColor): number {
  const dr = first.r - second.r;
  const dg = first.g - second.g;
  const db = first.b - second.b;
  return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114;
}

function rgbToAnsi256(color: RgbColor): number {
  const r = findClosest(CUBE_VALUES, color.r);
  const g = findClosest(CUBE_VALUES, color.g);
  const b = findClosest(CUBE_VALUES, color.b);
  const cubeColor = { r: r.value, g: g.value, b: b.value };
  const cubeIndex = 16 + 36 * r.index + 6 * g.index + b.index;

  const gray = Math.round(0.299 * color.r + 0.587 * color.g + 0.114 * color.b);
  const { index: grayOffset, value: grayValue } = findClosest(GRAY_VALUES, gray);
  const spread = Math.max(color.r, color.g, color.b) - Math.min(color.r, color.g, color.b);
  if (
    spread < 10 &&
    colorDistance(color, { r: grayValue, g: grayValue, b: grayValue }) <
      colorDistance(color, cubeColor)
  ) {
    return 232 + grayOffset;
  }
  return cubeIndex;
}

function colorAnsi(color: Color, mode: TerminalColorMode, background: boolean): string {
  if (color.kind === "indexed") return `\x1b[${background ? 48 : 38};5;${color.index}m`;

  const rgb = colorToRgb(color);
  if (mode === "truecolor") {
    return `\x1b[${background ? 48 : 38};2;${Math.round(rgb.r)};${Math.round(rgb.g)};${Math.round(rgb.b)}m`;
  }
  return `\x1b[${background ? 48 : 38};5;${rgbToAnsi256(rgb)}m`;
}

export const foregroundAnsi: {
  (color: Color, mode: TerminalColorMode): string;
  (mode: TerminalColorMode): (color: Color) => string;
} = dual(2, (color: Color, mode: TerminalColorMode): string => colorAnsi(color, mode, false));

export const backgroundAnsi: {
  (color: Color, mode: TerminalColorMode): string;
  (mode: TerminalColorMode): (color: Color) => string;
} = dual(2, (color: Color, mode: TerminalColorMode): string => colorAnsi(color, mode, true));

export const styleText: {
  (text: string, options: TextStyle, mode: TerminalColorMode): string;
  (options: TextStyle, mode: TerminalColorMode): (text: string) => string;
} = dual(3, (text: string, options: TextStyle, mode: TerminalColorMode): string =>
  styleTextWithAnsi(
    text,
    options.fg && foregroundAnsi(options.fg, mode),
    options.bg && backgroundAnsi(options.bg, mode),
    options,
  ),
);

export const styleTextWithAnsi: {
  (
    text: string,
    fgAnsi: string | undefined,
    bgAnsi: string | undefined,
    options: TextAttributes,
  ): string;
  (
    fgAnsi: string | undefined,
    bgAnsi: string | undefined,
    options: TextAttributes,
  ): (text: string) => string;
} = dual(
  4,
  (
    text: string,
    fgAnsi: string | undefined,
    bgAnsi: string | undefined,
    options: TextAttributes,
  ): string => {
    let prefix = "";
    let suffix = "";
    if (fgAnsi !== undefined && fgAnsi !== "") {
      prefix += fgAnsi;
      suffix = "\x1b[39m";
    }
    if (bgAnsi !== undefined && bgAnsi !== "") {
      prefix += bgAnsi;
      suffix = `\x1b[49m${suffix}`;
    }
    if (options.bold === true) prefix += "\x1b[1m";
    if (options.dim === true) prefix += "\x1b[2m";
    if (options.bold === true || options.dim === true) suffix = `\x1b[22m${suffix}`;
    if (options.italic === true) {
      prefix += "\x1b[3m";
      suffix = `\x1b[23m${suffix}`;
    }
    if (options.underline === true) {
      prefix += "\x1b[4m";
      suffix = `\x1b[24m${suffix}`;
    }
    if (options.inverse === true) {
      prefix += "\x1b[7m";
      suffix = `\x1b[27m${suffix}`;
    }
    if (options.strikethrough === true) {
      prefix += "\x1b[9m";
      suffix = `\x1b[29m${suffix}`;
    }
    return `${prefix}${text}${suffix}`;
  },
);
