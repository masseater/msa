import {
  backgroundAnsi,
  type Color,
  type Component,
  colorToRgb,
  foregroundAnsi,
  getKeybindings,
  indexedColor,
  rgbColor,
  type TUI,
  type TuiMouseEvent,
  type TuiMouseEventResult,
  visibleWidth,
} from "@msa/tui";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { awaited, awaiting } from "../../../core/awaiting.ts";
import { type Scheduled } from "../../../core/platform.ts";
import { every } from "../../interval.ts";
import { theme } from "../theme/theme.ts";
import { ARMIN_HEIGHT, ARMIN_WIDTH, isArminPixel } from "./armin.ts";
import { formatKeyText } from "./keybinding-hints.ts";

type Rgb = readonly [number, number, number];

interface ScreenCell {
  text: string;
  width: number;
  fg: Rgb;
  bg: Rgb | undefined;
  delay: number;
  ink: number;
  seed: number;
}

interface Star {
  glyph: string;
  tint: Rgb;
  strength: number;
  phase: number;
  speed: number;
}

interface Box {
  min: readonly [number, number, number];
  max: readonly [number, number, number];
  color: Rgb;
}

interface Pose {
  centerX: number;
  centerY: number;
  scale: number;
  yaw: number;
  pitch: number;
  roll: number;
}

const DEPTH = 0.7;
const FLY_START = 0.1;
const FLY_DURATION = 1.3;
const START_SCALE = 0.1;

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
      if (color !== undefined) blocks.push({ home: [column, row, 0], color });
    }
  }
  return {
    columns,
    rows,
    blocks,
    cameraDistance: options.cameraDistance,
    radius: Math.hypot(columns / 2, rows / 2, 1 + DEPTH / 2),
    widthShare: options.widthShare,
    puzzleMoves: (random) => options.puzzleMoves(random, blocks.length),
    origin: options.origin,
  };
}

function arminModel(color: Rgb): Model {
  return createModel(
    ARMIN_WIDTH,
    ARMIN_HEIGHT,
    (column, row) => (isArminPixel(column, row) ? color : undefined),
    {
      cameraDistance: 80,
      widthShare: 0.45,
      puzzleMoves: (random, blockCount) => Math.round(blockCount * (0.03 + random * 0.04)),
      origin: undefined,
    },
  );
}

const PUZZLE_START = FLY_START + FLY_DURATION + 3;
const PUZZLE_STEP = 0.3;
const PUZZLE_STEPS = 12;
const PUZZLE_RETURN = 1;
const PUZZLE_HOLD = 0.6;
const PUZZLE_CYCLE = PUZZLE_STEP * PUZZLE_STEPS + PUZZLE_RETURN + PUZZLE_HOLD;
const PUZZLE_MOVES: Cell3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function shuffleSteps(model: Model, cycle: number): Cell3[][] {
  const { columns, rows } = model;
  let positions: Cell3[] = model.blocks.map((block) => block.home);
  const steps = [positions];
  const lastMoved = new Set<number>();
  let random = cycle * 7_919 + 1;
  const next = () => hash(random++);
  const key = ([x, y, z]: Cell3) => ((z + 1) * rows + y) * columns + x;
  for (let step = 0; step < PUZZLE_STEPS; step++) {
    const occupied = new Set(positions.map(key));
    const nextPositions = [...positions];
    const moved = new Set<number>();
    const moveCount = model.puzzleMoves(next());
    for (let move = 0; move < moveCount; move++) {
      const candidates: Array<{ block: number; target: Cell3 }> = [];
      for (let block = 0; block < positions.length; block++) {
        if (moved.has(block)) continue;
        const [x, y, z] = positions[block]!;
        for (const [dx, dy, dz] of PUZZLE_MOVES) {
          const target: Cell3 = [x + dx, y + dy, z + dz];
          if (target[0] < 0 || target[0] >= columns || target[1] < 0 || target[1] >= rows) continue;
          if (target[2] < -1 || target[2] > 1 || occupied.has(key(target))) continue;
          candidates.push({ block, target });
        }
      }
      const fresh = candidates.filter((candidate) => !lastMoved.has(candidate.block));
      const pool = fresh.length > 0 ? fresh : candidates;
      const choice = pool[Math.floor(next() * pool.length)];
      if (choice === undefined) break;
      occupied.add(key(choice.target));
      nextPositions[choice.block] = choice.target;
      moved.add(choice.block);
    }
    lastMoved.clear();
    for (const block of moved) lastMoved.add(block);
    positions = nextPositions;
    steps.push(positions);
  }
  return steps;
}

const FRAME_MS = 1000 / 30;
const DUST_DURATION = 0.35;
const WAVE_SPREAD = 0.55;
const WAVE_JITTER = 0.12;
const DISSOLVE_END = FLY_START + WAVE_SPREAD + WAVE_JITTER + DUST_DURATION;
const BACKGROUND_FADE = 0.5;
const EXIT_DURATION = 1.1;
const STARS_START = 2.5;
const STARS_FADE = 2;
const STAR_DENSITY = 0.018;
const STAR_TINTS: Rgb[] = [
  [255, 255, 255],
  [170, 195, 255],
  [255, 225, 170],
  [255, 190, 205],
];
const LOGO_COLOR_STEP = 5;
const LIGHT_HALO_STRENGTH = 0.3;
const HALO_RADIUS_X = 6;
const HALO_RADIUS_Y = 3;
const HALO_LEVELS = 32;
const STAR_ALPHA_LEVELS = 8;
const STAR_FLICKER_LEVELS = 3;
const HINT_FADE = 0.5;

const DOT_BITS = [0x01, 0x08, 0x02, 0x10, 0x04, 0x20, 0x40, 0x80];
const BRAILLE = Array.from({ length: 256 }, (_, bits) => String.fromCharCode(0x2800 + bits));
const LIGHT = normalize([-0.45, -0.6, 0.75]);
const HALF_VECTOR = normalize([LIGHT[0], LIGHT[1], LIGHT[2] + 1]);

function normalize(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function smooth(value: number): number {
  const t = clamp01(value);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function easeOut(value: number): number {
  const t = 1 - clamp01(value);
  return 1 - t * t * t;
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

function hash(value: number): number {
  let x = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 0x100000000;
}

function isLight([r, g, b]: Rgb): boolean {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 128;
}

function toRgb(color: Color): Rgb {
  const { r, g, b } = colorToRgb(color);
  return [r, g, b];
}

function glyphInk(text: string, seed: number): number {
  if (text.trim() === "") return 0;
  if (/^[.,:;'`\-_·]$/u.test(text)) return 2;
  if (/^[\u2500-\u257f]$/u.test(text)) return 3;
  return 4 + Math.floor(seed * 3);
}

const segmenter = new Intl.Segmenter();

function parseScreen(
  lines: readonly string[],
  width: number,
  foreground: Rgb,
  background: Rgb,
): Array<Array<ScreenCell>> {
  const palette = (index: number): Rgb => toRgb(indexedColor(index));
  return lines.map((line) => {
    const cells: ScreenCell[] = [];
    let fg: Rgb | undefined;
    let bg: Rgb | undefined;
    let dim = false;
    let inverse = false;
    const applySgr = (params: string) => {
      const codes = params === "" ? ["0"] : params.split(";");
      for (let i = 0; i < codes.length; i++) {
        const parts = codes[i]!.split(":").map((part) => Number.parseInt(part, 10));
        const code = parts[0] ?? 0;
        if (code === 38 || code === 48) {
          let args: number[];
          if (parts.length > 1) {
            args = parts.slice(1).filter((part) => !Number.isNaN(part));
          } else {
            const kind = Number.parseInt(codes[i + 1] ?? "", 10);
            const count = kind === 5 ? 2 : kind === 2 ? 4 : 1;
            args = codes.slice(i + 1, i + 1 + count).map((part) => Number.parseInt(part, 10));
            i += count;
          }
          let color: Rgb | undefined;
          if (args[0] === 5 && args[1] !== undefined) color = palette(args[1]);
          else if (args[0] === 2 && args.length >= 4) color = [args[1]!, args[2]!, args[3]!];
          if (color !== undefined) {
            if (code === 38) fg = color;
            else bg = color;
          }
        } else if (code === 0) {
          fg = undefined;
          bg = undefined;
          dim = false;
          inverse = false;
        } else if (code === 2) dim = true;
        else if (code === 22) dim = false;
        else if (code === 7) inverse = true;
        else if (code === 27) inverse = false;
        else if (code >= 30 && code <= 37) fg = palette(code - 30);
        else if (code >= 90 && code <= 97) fg = palette(code - 90 + 8);
        else if (code === 39) fg = undefined;
        else if (code >= 40 && code <= 47) bg = palette(code - 40);
        else if (code >= 100 && code <= 107) bg = palette(code - 100 + 8);
        else if (code === 49) bg = undefined;
      }
    };
    const pushText = (text: string) => {
      for (const { segment } of segmenter.segment(text)) {
        const glyphWidth = visibleWidth(segment);
        if (glyphWidth === 0 || cells.length + glyphWidth > width) continue;
        let cellFg = fg ?? foreground;
        let cellBg = bg;
        if (inverse) {
          cellFg = bg ?? background;
          cellBg = fg ?? foreground;
        }
        if (dim) cellFg = mix(cellFg, cellBg ?? background, 0.4);
        const cell = {
          text: segment,
          width: glyphWidth,
          fg: cellFg,
          bg: cellBg,
          delay: 0,
          ink: 0,
          seed: 0,
        };
        cells.push(cell);
        if (glyphWidth === 2) cells.push({ ...cell, text: "", width: 0 });
      }
    };
    let i = 0;
    while (i < line.length) {
      const sequenceStart = line.indexOf("\x1b", i);
      if (sequenceStart === -1) {
        pushText(line.slice(i));
        break;
      }
      if (sequenceStart > i) pushText(line.slice(i, sequenceStart));
      const kind = line[sequenceStart + 1];
      if (kind === "[") {
        let end = sequenceStart + 2;
        while (end < line.length && (line.charCodeAt(end) < 0x40 || line.charCodeAt(end) > 0x7e))
          end++;
        if (line[end] === "m") applySgr(line.slice(sequenceStart + 2, end));
        i = end + 1;
      } else if (kind === "]" || kind === "_" || kind === "P" || kind === "^") {
        const bell = line.indexOf("\x07", sequenceStart + 2);
        const st = line.indexOf("\x1b\\", sequenceStart + 2);
        if (bell === -1 && st === -1) break;
        i = bell !== -1 && (st === -1 || bell < st) ? bell + 1 : st + 2;
      } else {
        i = sequenceStart + 2;
      }
    }
    return cells;
  });
}

function rotation(yaw: number, pitch: number, roll: number): number[] {
  const [sy, cy, sx, cx, sz, cz] = [
    Math.sin(yaw),
    Math.cos(yaw),
    Math.sin(pitch),
    Math.cos(pitch),
    Math.sin(roll),
    Math.cos(roll),
  ];
  const ry = [cy, 0, sy, 0, 1, 0, -sy, 0, cy];
  const rx = [1, 0, 0, 0, cx, -sx, 0, sx, cx];
  const rz = [cz, -sz, 0, sz, cz, 0, 0, 0, 1];
  return multiply(rz, multiply(rx, ry));
}

function multiply(a: number[], b: number[]): number[] {
  const result = new Array<number>(9);
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 3; column++) {
      result[row * 3 + column] =
        a[row * 3]! * b[column]! +
        a[row * 3 + 1]! * b[3 + column]! +
        a[row * 3 + 2]! * b[6 + column]!;
    }
  }
  return result;
}

const SPIN_RAMP = 1.4;
const SPIN_SPEED = (Math.PI * 2) / PUZZLE_CYCLE;
const SPIN_LINGER = 0.6;
const FIRST_FRONT_VIEW =
  PUZZLE_START + PUZZLE_STEP * PUZZLE_STEPS + PUZZLE_RETURN + PUZZLE_HOLD / 2;

function baseSpinPhase(time: number): number {
  const elapsed = time - FLY_START;
  if (elapsed <= 0) return 0;
  const u = elapsed / SPIN_RAMP;
  if (u < 1) return SPIN_SPEED * SPIN_RAMP * (u ** 6 - 3 * u ** 5 + 2.5 * u ** 4);
  return SPIN_SPEED * (SPIN_RAMP * 0.5 + elapsed - SPIN_RAMP);
}

const SPIN_ALIGNMENT = Math.PI * 2 - (baseSpinPhase(FIRST_FRONT_VIEW) % (Math.PI * 2));

function spinPhase(time: number): number {
  return baseSpinPhase(time) + SPIN_ALIGNMENT * smooth((time - FLY_START) / FLY_DURATION);
}

function spinAngle(time: number): number {
  const phase = spinPhase(time);
  return phase - SPIN_LINGER * Math.sin(phase);
}

interface Face {
  axis: number;
  plane: number;
  uMin: number;
  uMax: number;
  vMin: number;
  vMax: number;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  red: number;
  green: number;
  blue: number;
}

class BlockRaster {
  bits = new Uint8Array(0);
  counts = new Uint8Array(0);
  rgb = new Float32Array(0);
  haloAmount = new Float32Array(0);
  haloRgb = new Float32Array(0);
  private width = 0;
  private height = 0;
  private depth = new Float32Array(0);
  private faceIds = new Uint16Array(0);
  private dirty: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
  private haloDirty: { minX: number; minY: number; maxX: number; maxY: number } | undefined;
  private readonly cameraDistance: number;

  constructor(cameraDistance: number) {
    this.cameraDistance = cameraDistance;
  }

  render(
    width: number,
    height: number,
    pose: Pose,
    boxes: readonly Box[],
    background: Rgb,
    haloStrength: number,
  ): void {
    const renderDotWidthResult = BlockRaster.renderDotWidth(
      this,
      width,
      height,
      pose,
      background,
      boxes,
    );
    if (renderDotWidthResult.done) return renderDotWidthResult.value;
    const {
      dotWidth,
      dotHeight,
      faces,
      origin,
      m,
      scale,
      centerX,
      centerY,
      cameraDistance,
      light,
    } = renderDotWidthResult.value;
    const renderMinYResult = BlockRaster.renderMinY(
      this,
      dotWidth,
      dotHeight,
      faces,
      origin,
      m,
      scale,
      centerX,
      centerY,
      cameraDistance,
      width,
      height,
    );
    if (renderMinYResult.done) return renderMinYResult.value;
    let {
      minY,
      maxY,
      minX,
      maxX,
      faceIds,
      depth,
      bits,
      counts,
      rgb,
      cellMinX,
      cellMaxX,
      cellMinY,
      cellMaxY,
    } = renderMinYResult.value;
    for (let dotY = minY; dotY <= maxY; dotY++) {
      let index = dotY * dotWidth + minX;
      for (let dotX = minX; dotX <= maxX; dotX++, index++) {
        const id = faceIds[index]!;
        if (id === 0) continue;
        const face = faces[id - 1]!;
        const fog = clamp01(0.15 - cameraDistance * (1 - depth[index]!) * 0.12) * (light ? 0.5 : 1);
        faceIds[index] = 0;
        depth[index] = Infinity;
        const cellX = dotX >> 1;
        const cellY = dotY >> 2;
        const cell = cellY * width + cellX;
        bits[cell]! |= DOT_BITS[(dotY & 3) * 2 + (dotX & 1)] ?? 0;
        counts[cell]!++;
        const rgbIndex = cell * 3;
        rgb[rgbIndex] = (rgb[rgbIndex] ?? 0) + face.red + (background[0] - face.red) * fog;
        rgb[rgbIndex + 1] =
          (rgb[rgbIndex + 1] ?? 0) + face.green + (background[1] - face.green) * fog;
        rgb[rgbIndex + 2] =
          (rgb[rgbIndex + 2] ?? 0) + face.blue + (background[2] - face.blue) * fog;
        if (cellX < cellMinX) cellMinX = cellX;
        if (cellX > cellMaxX) cellMaxX = cellX;
        if (cellY < cellMinY) cellMinY = cellY;
        if (cellY > cellMaxY) cellMaxY = cellY;
      }
    }
    if (cellMaxX >= 0)
      this.dirty = { minX: cellMinX, minY: cellMinY, maxX: cellMaxX, maxY: cellMaxY };
    if (haloStrength > 0) this.renderHalo(haloStrength);
  }

  private static renderDotWidth(
    self: BlockRaster,
    width: number,
    height: number,
    pose: Pose,
    background: Rgb,
    boxes: readonly Box[],
  ):
    | { done: true; value: void }
    | {
        done: false;
        value: {
          dotWidth: number;
          dotHeight: number;
          faces: Face[];
          origin: number[];
          m: number[];
          scale: number;
          centerX: number;
          centerY: number;
          cameraDistance: number;
          light: boolean;
        };
      } {
    const dotWidth = width * 2;
    const dotHeight = height * 4;
    if (width !== self.width || height !== self.height) {
      self.width = width;
      self.height = height;
      self.bits = new Uint8Array(width * height);
      self.counts = new Uint8Array(width * height);
      self.rgb = new Float32Array(width * height * 3);
      self.haloAmount = new Float32Array(width * height);
      self.haloRgb = new Float32Array(width * height * 3);
      self.haloDirty = undefined;
      self.depth = new Float32Array(dotWidth * dotHeight).fill(Infinity);
      self.faceIds = new Uint16Array(dotWidth * dotHeight);
      self.dirty = undefined;
    } else if (self.dirty !== undefined) {
      const { minX, minY, maxX, maxY } = self.dirty;
      for (let row = minY; row <= maxY; row++) {
        self.bits.fill(0, row * width + minX, row * width + maxX + 1);
        self.counts.fill(0, row * width + minX, row * width + maxX + 1);
        self.rgb.fill(0, (row * width + minX) * 3, (row * width + maxX + 1) * 3);
      }
      self.dirty = undefined;
    }
    if (self.haloDirty !== undefined) {
      const { minX, minY, maxX, maxY } = self.haloDirty;
      for (let row = minY; row <= maxY; row++) {
        self.haloAmount.fill(0, row * width + minX, row * width + maxX + 1);
        self.haloRgb.fill(0, (row * width + minX) * 3, (row * width + maxX + 1) * 3);
      }
      self.haloDirty = undefined;
    }

    const m = rotation(pose.yaw, pose.pitch, pose.roll);
    const { centerX, centerY, scale } = pose;
    const cameraDistance = self.cameraDistance;
    const origin = [m[6]! * cameraDistance, m[7]! * cameraDistance, m[8]! * cameraDistance];
    const light = isLight(background);
    const faces = self.visibleFaces(m, origin, pose, boxes, dotWidth, dotHeight, light);
    if (faces.length === 0) return { done: true, value: undefined };
    return {
      done: false,
      value: {
        dotWidth,
        dotHeight,
        faces,
        origin,
        m,
        scale,
        centerX,
        centerY,
        cameraDistance,
        light,
      },
    };
  }

  private static renderMinY(
    self: BlockRaster,
    dotWidth: number,
    dotHeight: number,
    faces: Face[],
    origin: number[],
    m: number[],
    scale: number,
    centerX: number,
    centerY: number,
    cameraDistance: number,
    width: number,
    height: number,
  ):
    | { done: true; value: void }
    | {
        done: false;
        value: {
          minY: number;
          maxY: number;
          minX: number;
          maxX: number;
          faceIds: Uint16Array<ArrayBuffer>;
          depth: Float32Array<ArrayBuffer>;
          bits: Uint8Array<ArrayBuffer>;
          counts: Uint8Array<ArrayBuffer>;
          rgb: Float32Array<ArrayBuffer>;
          cellMinX: number;
          cellMaxX: number;
          cellMinY: number;
          cellMaxY: number;
        };
      } {
    let minX = dotWidth;
    let minY = dotHeight;
    let maxX = -1;
    let maxY = -1;
    for (const face of faces) {
      minX = Math.min(minX, face.minX);
      minY = Math.min(minY, face.minY);
      maxX = Math.max(maxX, face.maxX);
      maxY = Math.max(maxY, face.maxY);
    }
    if (maxX < minX || maxY < minY) return { done: true, value: undefined };

    let { faceIds, depth, bits, counts, rgb, cellMinX, cellMaxX, cellMinY, cellMaxY } =
      BlockRaster.renderFaceIds(
        self,
        faces,
        origin,
        m,
        scale,
        centerX,
        centerY,
        cameraDistance,
        dotWidth,
        width,
        height,
      );
    return {
      done: false,
      value: {
        minY,
        maxY,
        minX,
        maxX,
        faceIds,
        depth,
        bits,
        counts,
        rgb,
        cellMinX,
        cellMaxX,
        cellMinY,
        cellMaxY,
      },
    };
  }

  private static renderFaceIds(
    self: BlockRaster,
    faces: Face[],
    origin: number[],
    m: number[],
    scale: number,
    centerX: number,
    centerY: number,
    cameraDistance: number,
    dotWidth: number,
    width: number,
    height: number,
  ): {
    faceIds: Uint16Array<ArrayBuffer>;
    depth: Float32Array<ArrayBuffer>;
    bits: Uint8Array<ArrayBuffer>;
    counts: Uint8Array<ArrayBuffer>;
    rgb: Float32Array<ArrayBuffer>;
    cellMinX: number;
    cellMaxX: number;
    cellMinY: number;
    cellMaxY: number;
  } {
    const depth = self.depth;
    const faceIds = self.faceIds;
    let { bits, counts, rgb, cellMinX } = BlockRaster.renderBits(
      self,
      faces,
      origin,
      m,
      scale,
      centerX,
      centerY,
      cameraDistance,
      dotWidth,
      depth,
      faceIds,
      width,
    );
    let cellMinY = height;
    let cellMaxX = -1;
    let cellMaxY = -1;
    return { faceIds, depth, bits, counts, rgb, cellMinX, cellMaxX, cellMinY, cellMaxY };
  }

  private static renderBits(
    self: BlockRaster,
    faces: Face[],
    origin: number[],
    m: number[],
    scale: number,
    centerX: number,
    centerY: number,
    cameraDistance: number,
    dotWidth: number,
    depth: Float32Array<ArrayBuffer>,
    faceIds: Uint16Array<ArrayBuffer>,
    width: number,
  ): {
    bits: Uint8Array<ArrayBuffer>;
    counts: Uint8Array<ArrayBuffer>;
    rgb: Float32Array<ArrayBuffer>;
    cellMinX: number;
  } {
    let { bits, counts, rgb, cellMinX } = renderBitsBits(
      faces,
      origin,
      m,
      scale,
      centerX,
      centerY,
      cameraDistance,
      dotWidth,
      depth,
      faceIds,
      self,
      width,
    );
    return { bits, counts, rgb, cellMinX };
  }

  private renderHalo(strength: number): void {
    const cells = this.dirty;
    if (cells === undefined) return;
    const { width, height, counts, rgb } = this;
    const minX = Math.max(0, cells.minX - HALO_RADIUS_X);
    const maxX = Math.min(width - 1, cells.maxX + HALO_RADIUS_X);
    const minY = Math.max(0, cells.minY - HALO_RADIUS_Y);
    const maxY = Math.min(height - 1, cells.maxY + HALO_RADIUS_Y);
    const regionWidth = maxX - minX + 1;
    const tent = (radius: number) => {
      const weights = Array.from(
        { length: radius * 2 + 1 },
        (_, i) => radius + 1 - Math.abs(i - radius),
      );
      const total = weights.reduce((sum, weight) => sum + weight, 0);
      return weights.map((weight) => weight / total);
    };
    const weightsX = tent(HALO_RADIUS_X);
    const weightsY = tent(HALO_RADIUS_Y);

    const rows = cells.maxY - cells.minY + 1;
    const horizontal = new Float32Array(rows * regionWidth * 4);
    renderHaloPart1(cells, minX, maxX, width, counts, weightsX, rgb, regionWidth, horizontal);

    BlockRaster.renderHaloPart2(
      this,
      minY,
      maxY,
      minX,
      maxX,
      cells,
      weightsY,
      regionWidth,
      horizontal,
      width,
      counts,
      rgb,
      strength,
    );
  }

  private static renderHaloPart2(
    self: BlockRaster,
    minY: number,
    maxY: number,
    minX: number,
    maxX: number,
    cells: { minX: number; minY: number; maxX: number; maxY: number },
    weightsY: number[],
    regionWidth: number,
    horizontal: Float32Array<ArrayBuffer>,
    width: number,
    counts: Uint8Array<ArrayBuffer>,
    rgb: Float32Array<ArrayBuffer>,
    strength: number,
  ): void {
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let coverage = 0;
        let red = 0;
        let green = 0;
        let blue = 0;
        for (let dy = -HALO_RADIUS_Y; dy <= HALO_RADIUS_Y; dy++) {
          const sourceY = y + dy;
          if (sourceY < cells.minY || sourceY > cells.maxY) continue;
          const weight = weightsY[dy + HALO_RADIUS_Y]!;
          const source = ((sourceY - cells.minY) * regionWidth + (x - minX)) * 4;
          coverage += horizontal[source]! * weight;
          red += horizontal[source + 1]! * weight;
          green += horizontal[source + 2]! * weight;
          blue += horizontal[source + 3]! * weight;
        }
        const target = y * width + x;
        const count = counts[target]!;
        if (count > 0 && count / 8 > coverage) {
          coverage = count / 8;
          red = (rgb[target * 3]! / count) * coverage;
          green = (rgb[target * 3 + 1]! / count) * coverage;
          blue = (rgb[target * 3 + 2]! / count) * coverage;
        }
        if (coverage <= 0) continue;
        const amount =
          Math.round(strength * Math.min(1, coverage) ** 0.7 * HALO_LEVELS) / HALO_LEVELS;
        if (amount <= 0) continue;
        self.haloAmount[target] = amount;
        self.haloRgb[target * 3] = Math.round(red / coverage / LOGO_COLOR_STEP) * LOGO_COLOR_STEP;
        self.haloRgb[target * 3 + 1] =
          Math.round(green / coverage / LOGO_COLOR_STEP) * LOGO_COLOR_STEP;
        self.haloRgb[target * 3 + 2] =
          Math.round(blue / coverage / LOGO_COLOR_STEP) * LOGO_COLOR_STEP;
      }
    }
    self.haloDirty = { minX, minY, maxX, maxY };
  }

  private visibleFaces(
    m: number[],
    origin: number[],
    pose: Pose,
    boxes: readonly Box[],
    dotWidth: number,
    dotHeight: number,
    lightBackground: boolean,
  ): Face[] {
    const faces: Face[] = [];
    const cameraDistance = this.cameraDistance;
    for (const box of boxes) {
      visibleFacesPart1(
        box,
        origin,
        boxes,
        m,
        pose,
        cameraDistance,
        dotWidth,
        dotHeight,
        lightBackground,
        faces,
      );
    }
    return faces;
  }
}

function renderBitsBits(
  faces: Face[],
  origin: number[],
  m: number[],
  scale: number,
  centerX: number,
  centerY: number,
  cameraDistance: number,
  dotWidth: number,
  depth: Float32Array<ArrayBuffer>,
  faceIds: Uint16Array<ArrayBuffer>,
  self: BlockRaster,
  width: number,
): {
  bits: Uint8Array<ArrayBuffer>;
  counts: Uint8Array<ArrayBuffer>;
  rgb: Float32Array<ArrayBuffer>;
  cellMinX: number;
} {
  let { bits, counts, rgb, cellMinX } = renderBitsBitsBits(
    faces,
    origin,
    m,
    scale,
    centerX,
    centerY,
    cameraDistance,
    dotWidth,
    depth,
    faceIds,
    self,
    width,
  );
  return { bits, counts, rgb, cellMinX };
}

function renderBitsBitsBits(
  faces: Face[],
  origin: number[],
  m: number[],
  scale: number,
  centerX: number,
  centerY: number,
  cameraDistance: number,
  dotWidth: number,
  depth: Float32Array<ArrayBuffer>,
  faceIds: Uint16Array<ArrayBuffer>,
  self: BlockRaster,
  width: number,
): {
  bits: Uint8Array<ArrayBuffer>;
  counts: Uint8Array<ArrayBuffer>;
  rgb: Float32Array<ArrayBuffer>;
  cellMinX: number;
} {
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex++) {
    const face = faces[faceIndex]!;
    const a = face.axis;
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    const originA = origin[a]!;
    const originU = origin[u]!;
    const originV = origin[v]!;
    const stepA = m[a]! / scale;
    const stepU = m[u]! / scale;
    const stepV = m[v]! / scale;
    const sx = (face.minX + 0.5 - centerX) / scale;
    for (let dotY = face.minY; dotY <= face.maxY; dotY++) {
      const sy = (dotY + 0.5 - centerY) / scale;
      let directionA = m[a]! * sx + m[3 + a]! * sy - m[6 + a]! * cameraDistance;
      let directionU = m[u]! * sx + m[3 + u]! * sy - m[6 + u]! * cameraDistance;
      let directionV = m[v]! * sx + m[3 + v]! * sy - m[6 + v]! * cameraDistance;
      let index = dotY * dotWidth + face.minX;
      for (let dotX = face.minX; dotX <= face.maxX; dotX++, index++) {
        const t = (face.plane - originA) / directionA;
        if (t > 0 && t < depth[index]!) {
          const hitU = originU + t * directionU;
          const hitV = originV + t * directionV;
          if (hitU >= face.uMin && hitU <= face.uMax && hitV >= face.vMin && hitV <= face.vMax) {
            depth[index] = t;
            faceIds[index] = faceIndex + 1;
          }
        }
        directionA += stepA;
        directionU += stepU;
        directionV += stepV;
      }
    }
  }

  const bits = self.bits;
  const counts = self.counts;
  const rgb = self.rgb;
  let cellMinX = width;
  return { bits, counts, rgb, cellMinX };
}

function visibleFacesPart1(
  box: Box,
  origin: number[],
  boxes: readonly Box[],
  m: number[],
  pose: Pose,
  cameraDistance: number,
  dotWidth: number,
  dotHeight: number,
  lightBackground: boolean,
  faces: Face[],
): void {
  visibleFacesPart1Part1(
    box,
    origin,
    boxes,
    m,
    pose,
    cameraDistance,
    dotWidth,
    dotHeight,
    lightBackground,
    faces,
  );
}

function visibleFacesPart1Part1(
  box: Box,
  origin: number[],
  boxes: readonly Box[],
  m: number[],
  pose: Pose,
  cameraDistance: number,
  dotWidth: number,
  dotHeight: number,
  lightBackground: boolean,
  faces: Face[],
): void {
  for (let a = 0; a < 3; a++) {
    const u = (a + 1) % 3;
    const v = (a + 2) % 3;
    for (const side of [-1, 1]) {
      const plane = side > 0 ? box.max[a]! : box.min[a]!;
      if ((origin[a]! - plane) * side <= 0) continue;
      const covered = boxes.some(
        (other) =>
          other !== box &&
          (side > 0 ? other.min[a] : other.max[a]) === plane &&
          other.min[u]! <= box.min[u]! &&
          other.max[u]! >= box.max[u]! &&
          other.min[v]! <= box.min[v]! &&
          other.max[v]! >= box.max[v]!,
      );
      if (covered) continue;

      let { minX, minY, maxX, maxY } = visibleFacesMinX(
        box,
        u,
        v,
        a,
        plane,
        m,
        pose,
        cameraDistance,
      );
      const face = {
        minX: Math.max(0, Math.floor(minX)),
        minY: Math.max(0, Math.floor(minY)),
        maxX: Math.min(dotWidth - 1, Math.ceil(maxX)),
        maxY: Math.min(dotHeight - 1, Math.ceil(maxY)),
      };
      if (face.maxX < face.minX || face.maxY < face.minY) continue;

      visibleFacesPart2(m, a, side, lightBackground, faces, plane, box, u, v, face);
    }
  }
}

function renderHaloPart1(
  cells: { minX: number; minY: number; maxX: number; maxY: number },
  minX: number,
  maxX: number,
  width: number,
  counts: Uint8Array<ArrayBuffer>,
  weightsX: number[],
  rgb: Float32Array<ArrayBuffer>,
  regionWidth: number,
  horizontal: Float32Array<ArrayBuffer>,
): void {
  for (let y = cells.minY; y <= cells.maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let coverage = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let dx = -HALO_RADIUS_X; dx <= HALO_RADIUS_X; dx++) {
        const sourceX = x + dx;
        if (sourceX < cells.minX || sourceX > cells.maxX) continue;
        const source = y * width + sourceX;
        const count = counts[source]!;
        if (count === 0) continue;
        const weight = weightsX[dx + HALO_RADIUS_X]! / 8;
        coverage += count * weight;
        red += rgb[source * 3]! * weight;
        green += rgb[source * 3 + 1]! * weight;
        blue += rgb[source * 3 + 2]! * weight;
      }
      const target = ((y - cells.minY) * regionWidth + (x - minX)) * 4;
      horizontal[target] = coverage;
      horizontal[target + 1] = red;
      horizontal[target + 2] = green;
      horizontal[target + 3] = blue;
    }
  }
}

function visibleFacesMinX(
  box: Box,
  u: number,
  v: number,
  a: number,
  plane: number,
  m: number[],
  pose: Pose,
  cameraDistance: number,
): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const corner = [0, 0, 0];
  for (const cornerU of [box.min[u]!, box.max[u]!]) {
    for (const cornerV of [box.min[v]!, box.max[v]!]) {
      corner[a] = plane;
      corner[u] = cornerU;
      corner[v] = cornerV;
      const x = m[0]! * corner[0]! + m[1]! * corner[1]! + m[2]! * corner[2]!;
      const y = m[3]! * corner[0]! + m[4]! * corner[1]! + m[5]! * corner[2]!;
      const z = m[6]! * corner[0]! + m[7]! * corner[1]! + m[8]! * corner[2]!;
      const perspective = (pose.scale * cameraDistance) / (cameraDistance - z);
      const screenX = pose.centerX + x * perspective;
      const screenY = pose.centerY + y * perspective;
      minX = Math.min(minX, screenX);
      minY = Math.min(minY, screenY);
      maxX = Math.max(maxX, screenX);
      maxY = Math.max(maxY, screenY);
    }
  }
  return { minX, minY, maxX, maxY };
}

function visibleFacesPart2(
  m: number[],
  a: number,
  side: number,
  lightBackground: boolean,
  faces: Face[],
  plane: number,
  box: Box,
  u: number,
  v: number,
  face: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  const nx = m[a]! * side;
  const ny = m[3 + a]! * side;
  const nz = m[6 + a]! * side;
  const diffuse = Math.max(0, nx * LIGHT[0] + ny * LIGHT[1] + nz * LIGHT[2]);
  const rim = Math.max(0, nx * 0.8 - nz * 0.3);
  const specular = lightBackground
    ? 0
    : Math.max(0, nx * HALF_VECTOR[0] + ny * HALF_VECTOR[1] + nz * HALF_VECTOR[2]) ** 24 *
      0.6 *
      255;
  const light = lightBackground
    ? Math.min(1, 0.55 + diffuse * 0.45 + rim * 0.1)
    : 0.45 + diffuse * 0.78 + rim * 0.25;
  faces.push({
    axis: a,
    plane,
    uMin: box.min[u]!,
    uMax: box.max[u]!,
    vMin: box.min[v]!,
    vMax: box.max[v]!,
    ...face,
    red: Math.min(255, box.color[0] * light + specular),
    green: Math.min(255, box.color[1] * light + specular),
    blue: Math.min(255, box.color[2] * light + specular),
  });
}

let playing = false;

export const playEasterEgg3d: {
  (screen: readonly string[]): (tui: TUI) => Promise<void>;
  (tui: TUI, screen: readonly string[]): Promise<void>;
} = dual(2, (tui: TUI, screen: readonly string[]): Promise<void> =>
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
        foreground: toRgbTuple(reported.foreground, toRgb(theme.colors.text)),
        background: toRgbTuple(reported.background, dark ? [0, 0, 0] : [255, 255, 255]),
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
        width: "100%",
        maxHeight: "100%",
      });
    }),
  ),
);

export class EasterEgg3dAnimation implements Component {
  private readonly tui: TUI;
  private readonly screen: readonly string[];
  private readonly model: Model;
  private readonly foreground: Rgb;
  private readonly background: Rgb;
  private readonly onDone: () => void;
  private readonly startTime = performance.now();
  private lastRender = performance.now();
  private timer: Scheduled | undefined;
  private exit:
    | {
        start: number;
        time: number;
        yaw: number;
        targetYaw: number;
        offsets: Array<[number, number, number]>;
      }
    | undefined;
  private shuffle: { cycle: number; steps: Cell3[][] } | undefined;
  private screenWidth = -1;
  private screenHeight = -1;
  private stars: Array<Star | undefined> = [];
  private cells: ScreenCell[][] = [];
  private readonly ansiCache = new Map<number, string>();
  private readonly raster: BlockRaster;

  constructor(
    tui: TUI,
    screen: readonly string[],
    model: Model,
    colors: { foreground: Rgb; background: Rgb },
    onDone: () => void,
  ) {
    this.tui = tui;
    this.screen = screen;
    this.model = model;
    this.raster = new BlockRaster(model.cameraDistance);
    this.foreground = colors.foreground;
    this.background = colors.background;
    this.onDone = onDone;
    this.timer = every(() => {
      if (
        (this.exit !== undefined && this.exitProgress() >= 1) ||
        performance.now() - this.lastRender > 1000
      )
        this.finish();
      else this.tui.requestRender();
    }, FRAME_MS);
  }

  close(): void {
    if (this.exit !== undefined) {
      this.finish();
      return;
    }
    const time = this.elapsed();
    const yaw = spinAngle(time);
    const turn = Math.PI * 2;
    this.exit = {
      start: performance.now(),
      time,
      yaw,
      targetYaw: Math.ceil(yaw / turn) * turn,
      offsets: this.blockOffsets(time),
    };
  }

  handleInput(data: string): void {
    const keybindings = getKeybindings();
    if (keybindings.matches(data, "tui.select.cancel") || keybindings.matches(data, "app.clear"))
      this.close();
  }

  handleMouse(event: TuiMouseEvent): TuiMouseEventResult {
    if (event.type === "click") this.close();
    return { handled: true, render: false };
  }

  invalidate(): void {
    this.screenWidth = -1;
    this.screenHeight = -1;
    this.ansiCache.clear();
  }

  render(width: number): string[] {
    let {
      height,
      textActive,
      halo,
      backgroundFade,
      background,
      hint,
      raster,
      starfield,
      dissolveTime,
      textFade,
      frame,
      lines,
    } = EasterEgg3dAnimation.renderHeight(this, width);
    for (let row = 0; row < height; row++) {
      let { cells, emit, line } = EasterEgg3dAnimation.renderCells(this, row);
      for (let column = 0; column < width; column++) {
        const index = row * width + column;
        const cell = textActive ? cells[column] : undefined;
        const cellBg = halo(
          index,
          cell?.bg !== undefined && backgroundFade < 1
            ? mix(cell.bg, background, backgroundFade)
            : undefined,
        );
        if (
          hint !== undefined &&
          row === hint.row &&
          column >= hint.start &&
          column < hint.start + hint.text.length
        ) {
          const offset = column - hint.start;
          emit(hint.text[offset]!, offset < hint.keyLength ? hint.keyColor : hint.color, cellBg);
          continue;
        }
        const dots = raster.bits[index]!;
        if (dots !== 0) {
          const step = LOGO_COLOR_STEP * raster.counts[index]!;
          const rgb = raster.rgb;
          const color: Rgb = [
            Math.round(rgb[index * 3]! / step) * LOGO_COLOR_STEP,
            Math.round(rgb[index * 3 + 1]! / step) * LOGO_COLOR_STEP,
            Math.round(rgb[index * 3 + 2]! / step) * LOGO_COLOR_STEP,
          ];
          emit(BRAILLE[dots]!, color, cellBg);
          continue;
        }
        if (cell === undefined) {
          const star = starfield(index);
          emit(star?.text ?? " ", star?.fg, cellBg);
          continue;
        }
        const dust = (dissolveTime - cell.delay) / DUST_DURATION;
        if (dust < 0 && cell.width === 2 && (raster.bits[index + 1] ?? 0) === 0) {
          emit(cell.text, mix(cell.fg, background, textFade), cellBg);
          column++;
          continue;
        }
        if (dust < 0 && cell.width === 1) {
          emit(cell.text, mix(cell.fg, background, textFade), cellBg);
          continue;
        }
        const dotCount = dust < 0 ? cell.ink : Math.round(cell.ink * (1 - clamp01(dust)));
        if (dotCount <= 0) {
          const star = starfield(index);
          emit(star?.text ?? " ", star?.fg, cellBg);
          continue;
        }
        renderPart5(dotCount, cell, frame, textFade, dust, emit, background, cellBg);
      }
      lines.push(`${line}\x1b[0m`);
    }
    return lines;
  }

  private static renderHeight(
    self: EasterEgg3dAnimation,
    width: number,
  ): {
    height: number;
    textActive: boolean;
    halo: (index: number, base: Rgb | undefined) => Rgb | undefined;
    backgroundFade: number;
    background: Rgb;
    hint:
      | { row: number; start: number; text: string; keyLength: number; keyColor: Rgb; color: Rgb }
      | undefined;
    raster: BlockRaster;
    starfield: (index: number) => { text: string; fg: Rgb } | undefined;
    dissolveTime: number;
    textFade: number;
    frame: number;
    lines: string[];
  } {
    let {
      starLevel,
      now,
      background,
      foreground,
      height,
      textActive,
      halo,
      backgroundFade,
      hint,
      raster,
      dissolveTime,
      textFade,
      frame,
    } = EasterEgg3dAnimation.renderStarLevel2(self, width);
    const { starfield, lines } = EasterEgg3dAnimation.renderStarfield2(
      self,
      starLevel,
      now,
      background,
      foreground,
    );
    return {
      height,
      textActive,
      halo,
      backgroundFade,
      background,
      hint,
      raster,
      starfield,
      dissolveTime,
      textFade,
      frame,
      lines,
    };
  }

  private static renderStarLevel2(
    self: EasterEgg3dAnimation,
    width: number,
  ): {
    starLevel: number;
    now: number;
    background: Rgb;
    foreground: Rgb;
    height: number;
    textActive: boolean;
    halo: (index: number, base: Rgb | undefined) => Rgb | undefined;
    backgroundFade: number;
    hint:
      | { row: number; start: number; text: string; keyLength: number; keyColor: Rgb; color: Rgb }
      | undefined;
    raster: BlockRaster;
    dissolveTime: number;
    textFade: number;
    frame: number;
  } {
    let {
      offsets,
      columns,
      rows,
      height,
      pose,
      background,
      dissolveTime,
      hintAlpha,
      starAlpha,
      foreground,
    } = EasterEgg3dAnimation.renderOffsets(self, width);
    const boxes: Box[] = self.model.blocks.map((block, index) => {
      const [dx, dy, dz] = offsets[index]!;
      const x = block.home[0] - columns / 2 + dx;
      const y = block.home[1] - rows / 2 + dy;
      return {
        min: [x, y, dz - DEPTH / 2],
        max: [x + 1, y + 1, dz + DEPTH / 2],
        color: block.color,
      };
    });
    const { starLevel, now, textActive, halo, backgroundFade, hint, raster, textFade, frame } =
      EasterEgg3dAnimation.renderStarLevel(
        self,
        width,
        height,
        pose,
        boxes,
        background,
        dissolveTime,
        hintAlpha,
        starAlpha,
      );
    return {
      starLevel,
      now,
      background,
      foreground,
      height,
      textActive,
      halo,
      backgroundFade,
      hint,
      raster,
      dissolveTime,
      textFade,
      frame,
    };
  }

  private static renderStarfield2(
    self: EasterEgg3dAnimation,
    starLevel: number,
    now: number,
    background: Rgb,
    foreground: Rgb,
  ): { starfield: (index: number) => { text: string; fg: Rgb } | undefined; lines: string[] } {
    const { starfield, lines } = EasterEgg3dAnimation.renderStarfield(
      self,
      starLevel,
      now,
      background,
      foreground,
    );
    return { starfield, lines };
  }

  private static renderOffsets(
    self: EasterEgg3dAnimation,
    width: number,
  ): {
    offsets: [number, number, number][];
    columns: number;
    rows: number;
    height: number;
    pose: Pose;
    background: Rgb;
    dissolveTime: number;
    hintAlpha: number;
    starAlpha: number;
    foreground: Rgb;
  } {
    const height = Math.max(1, self.tui.terminal.rows);
    const foreground = self.foreground;
    const background = self.background;
    self.lastRender = performance.now();
    if (width !== self.screenWidth || height !== self.screenHeight) {
      self.screenWidth = width;
      self.screenHeight = height;
      self.cells = self.prepareCells(width, foreground);
      self.stars = self.prepareStars(width, height);
    }

    let dissolveTime: number;
    let pose: Pose;
    let hintAlpha: number;
    let starAlpha: number;
    let offsets: Array<[number, number, number]>;
    if (self.exit === undefined) {
      const time = self.elapsed();
      dissolveTime = time;
      pose = self.pose(width, height, self.flyProgress(time), time);
      hintAlpha = self.hintAlpha(time);
      starAlpha = self.starAlpha(time);
      offsets = self.blockOffsets(time);
    } else {
      const progress = self.exitProgress();
      const landing = clamp01(progress / 0.8);
      const settle = 1 - smooth(landing);
      dissolveTime = Math.min(self.exit.time, DISSOLVE_END) * (1 - progress);
      pose = self.pose(width, height, self.flyProgress(self.exit.time) * settle, self.exit.time);
      pose.yaw = self.exit.yaw + (self.exit.targetYaw - self.exit.yaw) * easeOut(landing);
      pose.pitch *= settle;
      pose.roll *= settle;
      hintAlpha = self.hintAlpha(self.exit.time) * (1 - smooth(progress / 0.2));
      starAlpha = self.starAlpha(self.exit.time) * (1 - smooth(progress / 0.3));
      const gather = 1 - smooth(progress / 0.5);
      offsets = self.exit.offsets.map(([x, y, z]) => [x * gather, y * gather, z * gather]);
    }

    const { columns, rows } = self.model;
    return {
      offsets,
      columns,
      rows,
      height,
      pose,
      background,
      dissolveTime,
      hintAlpha,
      starAlpha,
      foreground,
    };
  }

  private static renderStarLevel(
    self: EasterEgg3dAnimation,
    width: number,
    height: number,
    pose: Pose,
    boxes: Box[],
    background: Rgb,
    dissolveTime: number,
    hintAlpha: number,
    starAlpha: number,
  ): {
    starLevel: number;
    now: number;
    textActive: boolean;
    halo: (index: number, base: Rgb | undefined) => Rgb | undefined;
    backgroundFade: number;
    hint:
      | { row: number; start: number; text: string; keyLength: number; keyColor: Rgb; color: Rgb }
      | undefined;
    raster: BlockRaster;
    textFade: number;
    frame: number;
  } {
    const raster = self.raster;
    raster.render(
      width,
      height,
      pose,
      boxes,
      background,
      isLight(background) ? LIGHT_HALO_STRENGTH : 0,
    );
    const halo = (index: number, base: Rgb | undefined): Rgb | undefined => {
      const amount = raster.haloAmount[index]!;
      if (amount <= 0) return base;
      const color = raster.haloRgb;
      return mix(
        base ?? background,
        [color[index * 3]!, color[index * 3 + 1]!, color[index * 3 + 2]!],
        amount,
      );
    };
    const backgroundFade = smooth(dissolveTime / BACKGROUND_FADE);
    const textFade = smooth(dissolveTime / 0.6) * 0.3;
    const textActive = dissolveTime < DISSOLVE_END || backgroundFade < 1;
    const hint = self.hint(width, height, hintAlpha, background);
    const frame = Math.floor(dissolveTime * 14);
    const now = self.elapsed();
    const starLevel = Math.round(starAlpha * STAR_ALPHA_LEVELS) / STAR_ALPHA_LEVELS;
    return { starLevel, now, textActive, halo, backgroundFade, hint, raster, textFade, frame };
  }

  private static renderStarfield(
    self: EasterEgg3dAnimation,
    starLevel: number,
    now: number,
    background: Rgb,
    foreground: Rgb,
  ): { starfield: (index: number) => { text: string; fg: Rgb } | undefined; lines: string[] } {
    const starfield = (index: number): { text: string; fg: Rgb } | undefined => {
      if (starLevel <= 0) return undefined;
      const star = self.stars[index];
      if (star === undefined) return undefined;
      const flicker =
        Math.round((0.5 + 0.5 * Math.sin(now * star.speed + star.phase)) * STAR_FLICKER_LEVELS) /
        STAR_FLICKER_LEVELS;
      return {
        text: star.glyph,
        fg: mix(
          background,
          mix(foreground, star.tint, 0.5),
          star.strength * (0.7 + 0.3 * flicker) * starLevel,
        ),
      };
    };
    const lines: string[] = [];
    return { starfield, lines };
  }

  private static renderCells(
    self: EasterEgg3dAnimation,
    row: number,
  ): {
    cells: ScreenCell[];
    emit: (text: string, fg: Rgb | undefined, bg: Rgb | undefined) => void;
    line: string;
  } {
    const cells = self.cells[row] ?? [];
    let line = "";
    let currentFg = -1;
    let currentBg = -1;
    const emit = (text: string, fg: Rgb | undefined, bg: Rgb | undefined) => {
      const fgKey = fg === undefined ? -1 : self.pack(fg);
      const bgKey = bg === undefined ? -1 : self.pack(bg);
      if (fgKey !== currentFg && text !== " ") {
        line += fg === undefined ? "\x1b[39m" : self.ansi(fgKey, false);
        currentFg = fgKey;
      }
      if (bgKey !== currentBg) {
        line += bg === undefined ? "\x1b[49m" : self.ansi(bgKey, true);
        currentBg = bgKey;
      }
      line += text;
    };
    return { cells, emit, line };
  }

  private elapsed(): number {
    return (performance.now() - this.startTime) / 1000;
  }

  private exitProgress(): number {
    return this.exit === undefined
      ? 0
      : clamp01((performance.now() - this.exit.start) / 1000 / EXIT_DURATION);
  }

  private finish(): void {
    if (this.timer === undefined) return;
    this.timer.cancel();
    this.timer = undefined;
    this.onDone();
  }

  private blockOffsets(time: number): Array<[number, number, number]> {
    const blocks = this.model.blocks;
    const home = (): Array<[number, number, number]> => blocks.map(() => [0, 0, 0]);
    if (time < PUZZLE_START) return home();
    const cycle = Math.floor((time - PUZZLE_START) / PUZZLE_CYCLE);
    const local = time - PUZZLE_START - cycle * PUZZLE_CYCLE;
    if (this.shuffle?.cycle !== cycle)
      this.shuffle = { cycle, steps: shuffleSteps(this.model, cycle) };
    const steps = this.shuffle.steps;
    const offset = (position: Cell3, index: number): [number, number, number] => {
      const block = blocks[index]!.home;
      return [position[0] - block[0], position[1] - block[1], position[2] - block[2]];
    };
    const shuffleEnd = PUZZLE_STEP * PUZZLE_STEPS;
    if (local < shuffleEnd) {
      const step = Math.floor(local / PUZZLE_STEP);
      const progress = smooth((local - step * PUZZLE_STEP) / PUZZLE_STEP);
      return steps[step]!.map((from, index) => {
        const a = offset(from, index);
        const b = offset(steps[step + 1]![index]!, index);
        return [
          a[0] + (b[0] - a[0]) * progress,
          a[1] + (b[1] - a[1]) * progress,
          a[2] + (b[2] - a[2]) * progress,
        ];
      });
    }
    if (local < shuffleEnd + PUZZLE_RETURN) {
      const u = (local - shuffleEnd) / PUZZLE_RETURN;
      const remaining = 1 - smooth(u);
      const arc = Math.sin(Math.PI * clamp01(u)) * 0.8;
      return steps[PUZZLE_STEPS]!.map((position, index) => {
        const [x, y, z] = offset(position, index);
        return [x * remaining, y * remaining, z * remaining + (index % 2 === 0 ? arc : -arc)];
      });
    }
    return home();
  }

  private flyProgress(time: number): number {
    return smooth((time - FLY_START) / FLY_DURATION);
  }

  private starAlpha(time: number): number {
    return smooth((time - STARS_START) / STARS_FADE);
  }

  private hintAlpha(time: number): number {
    return smooth((time - FLY_START - FLY_DURATION) / HINT_FADE);
  }

  private pose(width: number, height: number, progress: number, time: number): Pose {
    const { columns, rows, cameraDistance, radius, widthShare, origin } = this.model;
    const reach = radius * (cameraDistance / (cameraDistance - radius));
    const startScale =
      origin === undefined ? START_SCALE : (2 * (cameraDistance - DEPTH / 2)) / cameraDistance;
    const endScale = Math.max(
      startScale,
      Math.min(width * 2 * widthShare, (height * 4 - 8) * 0.48) / reach,
    );
    const endX = width;
    const endY = height * 2 - 2;
    const startX = origin === undefined ? endX : origin.column * 2 + columns;
    const startY = origin === undefined ? endY : origin.row * 4 + rows;
    return {
      centerX: startX + (endX - startX) * progress,
      centerY: startY + (endY - startY) * progress,
      scale: startScale * (endScale / startScale) ** progress,
      yaw: spinAngle(time),
      pitch: 0.3 * Math.sin(spinPhase(time)) * progress,
      roll: 0.06 * Math.sin(2 * spinPhase(time)) * progress,
    };
  }

  private hint(
    width: number,
    height: number,
    alpha: number,
    background: Rgb,
  ):
    | { row: number; start: number; text: string; keyLength: number; keyColor: Rgb; color: Rgb }
    | undefined {
    if (alpha <= 0) return undefined;
    const key = formatKeyText(getKeybindings().getKeys("tui.select.cancel")[0] ?? "escape");
    const text = `${key} to return`;
    if (text.length > width) return undefined;
    return {
      row: height - 2,
      start: Math.floor((width - text.length) / 2),
      text,
      keyLength: key.length,
      keyColor: mix(background, toRgb(theme.colors.muted), alpha),
      color: mix(background, toRgb(theme.colors.dim), alpha),
    };
  }

  private prepareStars(width: number, height: number): Array<Star | undefined> {
    const stars = new Array<Star | undefined>(width * height);
    for (let index = 0; index < width * height; index++) {
      if (hash(index * 3 + 0x51ed) >= STAR_DENSITY) continue;
      const random = (salt: number) => hash(index * 7 + salt * 0x9e37);
      stars[index] = {
        glyph: BRAILLE[DOT_BITS[Math.floor(random(1) * 8)]!]!,
        tint: STAR_TINTS[Math.floor(random(2) * STAR_TINTS.length)]!,
        strength: 0.1 + random(3) * 0.12,
        phase: random(4) * Math.PI * 2,
        speed: 0.4 + random(5) * 0.8,
      };
    }
    return stars;
  }

  private prepareCells(width: number, foreground: Rgb): ScreenCell[][] {
    const cells = parseScreen(this.screen, width, foreground, this.background);
    const height = Math.max(1, this.tui.terminal.rows);
    const { columns, rows, origin } = this.model;
    const centerX = origin === undefined ? width / 2 : origin.column + columns / 2;
    const centerY = origin === undefined ? height / 2 : origin.row + rows / 4;
    const farthest = Math.hypot(
      Math.max(centerX, width - centerX),
      Math.max(centerY, height - centerY) * 2,
    );
    for (let row = 0; row < cells.length; row++) {
      const line = cells[row]!;
      for (let column = 0; column < line.length; column++) {
        const cell = line[column]!;
        const owner = cell.width === 0 ? line[column - 1]! : cell;
        const seed = hash(row * 65_537 + column);
        if (cell.width === 0) {
          cell.delay = owner.delay;
        } else {
          const distance = Math.hypot(column - centerX, (row - centerY) * 2) / farthest;
          cell.delay = FLY_START + distance * WAVE_SPREAD + seed * WAVE_JITTER;
        }
        cell.seed = row * 65_537 + column;
        cell.ink = glyphInk(owner.text, seed);
      }
    }
    if (origin !== undefined) {
      for (let row = origin.row; row < origin.row + Math.ceil(rows / 2); row++) {
        const line = cells[row];
        if (line === undefined) continue;
        for (let column = origin.column; column < origin.column + columns; column++) {
          const cell = line[column];
          if (cell !== undefined) {
            cell.text = " ";
            cell.width = 1;
            cell.ink = 0;
            cell.bg = undefined;
          }
        }
      }
    }
    return cells;
  }

  private pack(color: Rgb): number {
    return (Math.round(color[0]) << 16) | (Math.round(color[1]) << 8) | Math.round(color[2]);
  }

  private ansi(key: number, isBackground: boolean): string {
    const cacheKey = key * 2 + (isBackground ? 1 : 0);
    let value = this.ansiCache.get(cacheKey);
    if (value === undefined) {
      const color = rgbColor((key >> 16) & 255, (key >> 8) & 255, key & 255);
      const mode = theme.getColorMode();
      value = isBackground ? backgroundAnsi(color, mode) : foregroundAnsi(color, mode);
      this.ansiCache.set(cacheKey, value);
    }
    return value;
  }
}

function renderPart5(
  dotCount: number,
  cell: ScreenCell,
  frame: number,
  textFade: number,
  dust: number,
  emit: (text: string, fg: Rgb | undefined, bg: Rgb | undefined) => void,
  background: Rgb,
  cellBg: Rgb | undefined,
): void {
  let bits = 0;
  let placed = 0;
  for (let attempt = 0; placed < dotCount && attempt < 32; attempt++) {
    const bit = DOT_BITS[Math.floor(hash(cell.seed * 7919 + frame * 131 + attempt) * 8)]!;
    if ((bits & bit) !== 0) continue;
    bits |= bit;
    placed++;
  }
  const fade = textFade + (1 - textFade) * clamp01(dust) ** 0.8;
  emit(BRAILLE[bits]!, mix(cell.fg, background, fade), cellBg);
}
