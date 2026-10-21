import tuiModule from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type platformTypes from "../../../core/platform.types.ts";
import interval from "../../interval.ts";
import themeModule from "../theme/theme.ts";
import BlockRaster from "./block-raster.ts";
import easterEgg3dShared from "./easter-egg-3d-shared.ts";
import keybindingHints from "./keybinding-hints.ts";
const { theme } = themeModule;
const { every } = interval;
const { formatKeyText } = keybindingHints;
const { backgroundAnsi, foregroundAnsi, getKeybindings, indexedColor, rgbColor, visibleWidth } =
  tuiModule;
const { DEPTH, DOT_BITS, LOGO_COLOR_STEP, clamp01, isLight, toRgb } = easterEgg3dShared;

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
function puzzleCandidates(
  model: Model,
  positions: readonly Cell3[],
  moved: ReadonlySet<number>,
  occupied: ReadonlySet<number>,
  key: (cell: Cell3) => number,
): Array<{ block: number; target: Cell3 }> {
  const { columns, rows } = model;
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
  return candidates;
}
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
      const candidates = puzzleCandidates(model, positions, moved, occupied, key);
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
const LIGHT_HALO_STRENGTH = 0.3;
const STAR_ALPHA_LEVELS = 8;
const STAR_FLICKER_LEVELS = 3;
const HINT_FADE = 0.5;
const BRAILLE = Array.from({ length: 256 }, (_, bits) => String.fromCharCode(0x2800 + bits));
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
          bg: cellBg,
          delay: 0,
          fg: cellFg,
          ink: 0,
          seed: 0,
          text: segment,
          width: glyphWidth,
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
export default class EasterEgg3dAnimation implements tuiTypes.Component {
  private readonly tui: tuiTypes.TUI;
  private readonly screen: readonly string[];
  private readonly model: Model;
  private readonly foreground: Rgb;
  private readonly background: Rgb;
  private readonly onDone: () => void;
  private readonly startTime = performance.now();
  private lastRender = performance.now();
  private timer: platformTypes.Scheduled | undefined;
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
    tui: tuiTypes.TUI,
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
      offsets: this.blockOffsets(time),
      start: performance.now(),
      targetYaw: Math.ceil(yaw / turn) * turn,
      time,
      yaw,
    };
  }

  handleInput(data: string): void {
    const keybindings = getKeybindings();
    if (keybindings.matches(data, "tui.select.cancel") || keybindings.matches(data, "app.clear"))
      this.close();
  }

  handleMouse(event: tuiTypes.TuiMouseEvent): tuiTypes.TuiMouseEventResult {
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
        emitDissolvingCell(dotCount, cell, frame, textFade, dust, emit, background, cellBg);
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
      background,
      backgroundFade,
      dissolveTime,
      frame,
      halo,
      height,
      hint,
      lines,
      raster,
      starfield,
      textActive,
      textFade,
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
        color: block.color,
        max: [x + 1, y + 1, dz + DEPTH / 2],
        min: [x, y, dz - DEPTH / 2],
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
      background,
      backgroundFade,
      dissolveTime,
      foreground,
      frame,
      halo,
      height,
      hint,
      now,
      raster,
      starLevel,
      textActive,
      textFade,
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
    return { lines, starfield };
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
      background,
      columns,
      dissolveTime,
      foreground,
      height,
      hintAlpha,
      offsets,
      pose,
      rows,
      starAlpha,
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
    return { backgroundFade, frame, halo, hint, now, raster, starLevel, textActive, textFade };
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
        fg: mix(
          background,
          mix(foreground, star.tint, 0.5),
          star.strength * (0.7 + 0.3 * flicker) * starLevel,
        ),
        text: star.glyph,
      };
    };
    const lines: string[] = [];
    return { lines, starfield };
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
      pitch: 0.3 * Math.sin(spinPhase(time)) * progress,
      roll: 0.06 * Math.sin(2 * spinPhase(time)) * progress,
      scale: startScale * (endScale / startScale) ** progress,
      yaw: spinAngle(time),
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
      color: mix(background, toRgb(theme.colors.dim), alpha),
      keyColor: mix(background, toRgb(theme.colors.muted), alpha),
      keyLength: key.length,
      row: height - 2,
      start: Math.floor((width - text.length) / 2),
      text,
    };
  }

  private prepareStars(width: number, height: number): Array<Star | undefined> {
    const stars = new Array<Star | undefined>(width * height);
    for (let index = 0; index < width * height; index++) {
      if (hash(index * 3 + 0x51ed) >= STAR_DENSITY) continue;
      const random = (salt: number) => hash(index * 7 + salt * 0x9e37);
      stars[index] = {
        glyph: BRAILLE[DOT_BITS[Math.floor(random(1) * 8)]!]!,
        phase: random(4) * Math.PI * 2,
        speed: 0.4 + random(5) * 0.8,
        strength: 0.1 + random(3) * 0.12,
        tint: STAR_TINTS[Math.floor(random(2) * STAR_TINTS.length)]!,
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
function emitDissolvingCell(
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
