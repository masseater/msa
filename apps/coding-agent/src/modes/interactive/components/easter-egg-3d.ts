import type tuiTypes from "@msa/tui/index.types";
import { Effect } from "effect";
import { dual } from "effect/Function";

import awaitingModule from "../../../core/awaiting.ts";
import themeModule from "../theme/theme.ts";
import arminSupport from "./armin-support.ts";
import EasterEgg3dAnimation from "./easter-egg-3d-animation.ts";
import easterEgg3dShared from "./easter-egg-3d-shared.ts";

const { ARMIN_HEIGHT, ARMIN_WIDTH, isArminPixel } = arminSupport;
const { awaited, awaiting } = awaitingModule;
const { theme } = themeModule;
const { DEPTH, toRgb } = easterEgg3dShared;

type Rgb = readonly [number, number, number];
type Cell3 = readonly [number, number, number];
interface Model {
  columns: number;
  rows: number;
  blocks: Array<{ home: Cell3; color: Rgb }>;
  cameraDistance: number;
  radius: number;
  widthShare: number;
  puzzleMoves: (random: number) => number;
  origin: { column: number; row: number } | undefined;
}
function createModel(
  columns: number,
  rows: number,
  pixel: (column: number, row: number) => Rgb | undefined,
  options: Pick<Model, "cameraDistance" | "widthShare" | "origin"> & {
    puzzleMoves: (random: number, blockCount: number) => number;
  },
): Model {
  const blocks: Model["blocks"] = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const color = pixel(column, row);
      if (color !== undefined) blocks.push({ color, home: [column, row, 0] });
    }
  }
  return {
    blocks,
    cameraDistance: options.cameraDistance,
    columns,
    origin: options.origin,
    puzzleMoves: (random) => options.puzzleMoves(random, blocks.length),
    radius: Math.hypot(columns / 2, rows / 2, 1 + DEPTH / 2),
    rows,
    widthShare: options.widthShare,
  };
}
function arminModel(color: Rgb): Model {
  return createModel(
    ARMIN_WIDTH,
    ARMIN_HEIGHT,
    (column, row) => (isArminPixel(column, row) ? color : undefined),
    {
      cameraDistance: 80,
      origin: undefined,
      puzzleMoves: (random, blockCount) => Math.round(blockCount * (0.03 + random * 0.04)),
      widthShare: 0.45,
    },
  );
}
let playing = false;
const playEasterEgg3d: {
  (screen: readonly string[]): (tui: tuiTypes.TUI) => Promise<void>;
  (tui: tuiTypes.TUI, screen: readonly string[]): Promise<void>;
} = dual(2, (tui: tuiTypes.TUI, screen: readonly string[]): Promise<void> =>
  Effect.runPromise(
    awaiting(function* () {
      if (playing) return;
      playing = true;
      const reported = yield* awaited(tui.queryTerminalColors({ timeoutMs: 100 }));
      const dark = theme.appearance === "dark";
      const toRgbTuple = (
        rgb: { r: number; g: number; b: number } | undefined,
        fallback: Rgb,
      ): Rgb => (rgb === undefined ? fallback : [rgb.r, rgb.g, rgb.b]);
      const colors = {
        background: toRgbTuple(reported.background, dark ? [0, 0, 0] : [255, 255, 255]),
        foreground: toRgbTuple(reported.foreground, toRgb(theme.colors.text)),
      };
      if (tui.hasOverlay()) {
        playing = false;
        return;
      }
      const model = arminModel(toRgb(theme.colors.accent));
      const animation = new EasterEgg3dAnimation(tui, screen, model, colors, () => {
        playing = false;
        overlay.hide();
      });
      const overlay = tui.showOverlay(animation, {
        anchor: "top-left",
        maxHeight: "100%",
        width: "100%",
      });
    }),
  ),
);

const easterEgg3d = {
  playEasterEgg3d,
};

export default easterEgg3d;
