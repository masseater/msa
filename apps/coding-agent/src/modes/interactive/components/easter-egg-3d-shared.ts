import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";
const { colorToRgb } = tuiModule;

type Rgb = readonly [number, number, number];
const DEPTH = 0.7;
const LOGO_COLOR_STEP = 5;
const DOT_BITS = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80];
function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}
function isLight([r, g, b]: Rgb): boolean {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
}
function toRgb(color: tuiTypes.Color): Rgb {
  const { r, g, b } = colorToRgb(color);
  return [r, g, b];
}

const easterEgg3dShared = {
  DEPTH,
  DOT_BITS,
  LOGO_COLOR_STEP,
  clamp01,
  isLight,
  toRgb,
};

export default easterEgg3dShared;
