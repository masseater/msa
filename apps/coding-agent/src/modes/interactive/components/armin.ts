import type { Component, TUI } from "@msa/tui";
import { dual } from "effect/Function";

import { randomUnit, type Scheduled } from "../../../core/platform.ts";
import { every } from "../../interval.ts";
import { theme } from "../theme/theme.ts";

export const ARMIN_WIDTH = 31;
export const ARMIN_HEIGHT = 36;
const WIDTH = ARMIN_WIDTH;
const HEIGHT = ARMIN_HEIGHT;
const BITS = [
  0xff, 0xff, 0xff, 0x7f, 0xff, 0xf0, 0xff, 0x7f, 0xff, 0xed, 0xff, 0x7f, 0xff, 0xdb, 0xff, 0x7f,
  0xff, 0xb7, 0xff, 0x7f, 0xff, 0x77, 0xfe, 0x7f, 0x3f, 0xf8, 0xfe, 0x7f, 0xdf, 0xff, 0xfe, 0x7f,
  0xdf, 0x3f, 0xfc, 0x7f, 0x9f, 0xc3, 0xfb, 0x7f, 0x6f, 0xfc, 0xf4, 0x7f, 0xf7, 0x0f, 0xf7, 0x7f,
  0xf7, 0xff, 0xf7, 0x7f, 0xf7, 0xff, 0xe3, 0x7f, 0xf7, 0x07, 0xe8, 0x7f, 0xef, 0xf8, 0x67, 0x70,
  0x0f, 0xff, 0xbb, 0x6f, 0xf1, 0x00, 0xd0, 0x5b, 0xfd, 0x3f, 0xec, 0x53, 0xc1, 0xff, 0xef, 0x57,
  0x9f, 0xfd, 0xee, 0x5f, 0x9f, 0xfc, 0xae, 0x5f, 0x1f, 0x78, 0xac, 0x5f, 0x3f, 0x00, 0x50, 0x6c,
  0x7f, 0x00, 0xdc, 0x77, 0xff, 0xc0, 0x3f, 0x78, 0xff, 0x01, 0xf8, 0x7f, 0xff, 0x03, 0x9c, 0x78,
  0xff, 0x07, 0x8c, 0x7c, 0xff, 0x0f, 0xce, 0x78, 0xff, 0xff, 0xcf, 0x7f, 0xff, 0xff, 0xcf, 0x78,
  0xff, 0xff, 0xdf, 0x78, 0xff, 0xff, 0xdf, 0x7d, 0xff, 0xff, 0x3f, 0x7e, 0xff, 0xff, 0xff, 0x7f,
];

const BYTES_PER_ROW = Math.ceil(WIDTH / 8);
const DISPLAY_HEIGHT = Math.ceil(HEIGHT / 2);

type Effect = "typewriter" | "scanline" | "rain" | "fade" | "crt" | "glitch" | "dissolve";

const EFFECTS: Effect[] = ["typewriter", "scanline", "rain", "fade", "crt", "glitch", "dissolve"];

export const isArminPixel: {
  (y: number): (x: number) => boolean;
  (x: number, y: number): boolean;
} = dual(2, (x: number, y: number): boolean => {
  if (y >= HEIGHT) return false;
  const byteIndex = y * BYTES_PER_ROW + Math.floor(x / 8);
  const bitIndex = x % 8;
  return (((BITS[byteIndex] ?? 0) >> bitIndex) & 1) === 0;
});

function getChar(x: number, row: number): string {
  const upper = isArminPixel(x, row * 2);
  const lower = isArminPixel(x, row * 2 + 1);
  if (upper && lower) return "█";
  if (upper) return "▀";
  if (lower) return "▄";
  return " ";
}

function shuffle<T>(items: T[]): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(randomUnit() * (i + 1));
    const a = items[i];
    const b = items[j];
    if (a === undefined || b === undefined) continue;
    items[i] = b;
    items[j] = a;
  }
}

function buildFinalGrid(): string[][] {
  const grid: string[][] = [];
  for (let row = 0; row < DISPLAY_HEIGHT; row++) {
    const line: string[] = [];
    for (let x = 0; x < WIDTH; x++) {
      line.push(getChar(x, row));
    }
    grid.push(line);
  }
  return grid;
}

export class ArminComponent implements Component {
  private ui: TUI;
  private interval: Scheduled | null = null;
  private effect: Effect;
  private finalGrid: string[][];
  private currentGrid: string[][];
  private effectState: Record<string, unknown> = {};
  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private gridVersion = 0;
  private cachedVersion = -1;

  constructor(ui: TUI) {
    this.ui = ui;
    this.effect = EFFECTS[Math.floor(randomUnit() * EFFECTS.length)] ?? "typewriter";
    this.finalGrid = buildFinalGrid();
    this.currentGrid = this.createEmptyGrid();

    this.initEffect();
    this.startAnimation();
  }

  invalidate(): void {
    this.cachedWidth = 0;
  }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedVersion === this.gridVersion) {
      return this.cachedLines;
    }

    const padding = 1;
    const availableWidth = width - padding;

    this.cachedLines = this.currentGrid.map((row) => {
      const clipped = row.slice(0, availableWidth).join("");
      const padRight = Math.max(0, width - padding - clipped.length);
      return ` ${theme.fg("accent", clipped)}${" ".repeat(padRight)}`;
    });

    const message = "ARMIN SAYS HI";
    const msgPadRight = Math.max(0, width - padding - message.length);
    this.cachedLines.push(` ${theme.fg("accent", message)}${" ".repeat(msgPadRight)}`);

    this.cachedWidth = width;
    this.cachedVersion = this.gridVersion;

    return this.cachedLines;
  }

  private createEmptyGrid(): string[][] {
    return Array.from({ length: DISPLAY_HEIGHT }, () => Array(WIDTH).fill(" "));
  }

  private initEffect(): void {
    switch (this.effect) {
      case "typewriter":
        this.effectState = { pos: 0 };
        break;
      case "scanline":
        this.effectState = { row: 0 };
        break;
      case "rain":
        this.effectState = {
          drops: Array.from({ length: WIDTH }, () => ({
            y: -Math.floor(randomUnit() * DISPLAY_HEIGHT * 2),
            settled: 0,
          })),
        };
        break;
      case "fade": {
        const positions: [number, number][] = [];
        for (let row = 0; row < DISPLAY_HEIGHT; row++) {
          for (let x = 0; x < WIDTH; x++) {
            positions.push([row, x]);
          }
        }
        shuffle(positions);
        this.effectState = { positions, idx: 0 };
        break;
      }
      case "crt":
        this.effectState = { expansion: 0 };
        break;
      case "glitch":
        this.effectState = { phase: 0, glitchFrames: 8 };
        break;
      case "dissolve": {
        this.currentGrid = Array.from({ length: DISPLAY_HEIGHT }, () =>
          Array.from({ length: WIDTH }, () => {
            const chars = [" ", "░", "▒", "▓", "█", "▀", "▄"];
            return chars[Math.floor(randomUnit() * chars.length)] ?? " ";
          }),
        );
        const dissolvePositions: [number, number][] = [];
        for (let row = 0; row < DISPLAY_HEIGHT; row++) {
          for (let x = 0; x < WIDTH; x++) {
            dissolvePositions.push([row, x]);
          }
        }
        shuffle(dissolvePositions);
        this.effectState = { positions: dissolvePositions, idx: 0 };
        break;
      }
    }
  }

  private startAnimation(): void {
    const fps = this.effect === "glitch" ? 60 : 30;
    this.interval = every(() => {
      const done = this.tickEffect();
      this.updateDisplay();
      this.ui.requestRender();
      if (done) {
        this.stopAnimation();
      }
    }, 1000 / fps);
  }

  private stopAnimation(): void {
    if (this.interval !== null) {
      this.interval.cancel();
      this.interval = null;
    }
  }

  private tickEffect(): boolean {
    switch (this.effect) {
      case "typewriter":
        return this.tickTypewriter();
      case "scanline":
        return this.tickScanline();
      case "rain":
        return this.tickRain();
      case "fade":
        return this.tickFade();
      case "crt":
        return this.tickCrt();
      case "glitch":
        return this.tickGlitch();
      case "dissolve":
        return this.tickDissolve();
      default:
        return true;
    }
  }

  private tickTypewriter(): boolean {
    const state = this.effectState as { pos: number };
    const pixelsPerFrame = 3;

    for (let i = 0; i < pixelsPerFrame; i++) {
      const row = Math.floor(state.pos / WIDTH);
      const x = state.pos % WIDTH;
      if (row >= DISPLAY_HEIGHT) return true;
      this.copyCell(row, x);
      state.pos++;
    }
    return false;
  }

  private tickScanline(): boolean {
    const state = this.effectState as { row: number };
    if (state.row >= DISPLAY_HEIGHT) return true;

    for (let x = 0; x < WIDTH; x++) {
      this.copyCell(state.row, x);
    }
    state.row++;
    return false;
  }

  private tickRain(): boolean {
    const state = this.effectState as {
      drops: { y: number; settled: number }[];
    };

    let allSettled = true;
    this.currentGrid = this.createEmptyGrid();

    for (const [x, drop] of state.drops.entries()) {
      for (let row = DISPLAY_HEIGHT - 1; row >= DISPLAY_HEIGHT - drop.settled; row--) {
        if (row >= 0) {
          this.copyCell(row, x);
        }
      }

      if (drop.settled >= DISPLAY_HEIGHT) continue;

      allSettled = false;

      let targetRow = -1;
      for (let row = DISPLAY_HEIGHT - 1 - drop.settled; row >= 0; row--) {
        if (this.finalGrid[row]?.[x] !== " ") {
          targetRow = row;
          break;
        }
      }

      drop.y++;

      if (drop.y >= 0 && drop.y < DISPLAY_HEIGHT) {
        if (targetRow >= 0 && drop.y >= targetRow) {
          drop.settled = DISPLAY_HEIGHT - targetRow;
          drop.y = -Math.floor(randomUnit() * 5) - 1;
        } else {
          this.setCell(drop.y, x, "▓");
        }
      }
    }

    return allSettled;
  }

  private tickFade(): boolean {
    const state = this.effectState as { positions: [number, number][]; idx: number };
    const pixelsPerFrame = 15;

    for (let i = 0; i < pixelsPerFrame; i++) {
      const position = state.positions[state.idx];
      if (position === undefined) return true;
      const [row, x] = position;
      this.copyCell(row, x);
      state.idx++;
    }
    return false;
  }

  private tickCrt(): boolean {
    const state = this.effectState as { expansion: number };
    const midRow = Math.floor(DISPLAY_HEIGHT / 2);

    this.currentGrid = this.createEmptyGrid();

    const top = midRow - state.expansion;
    const bottom = midRow + state.expansion;

    for (let row = Math.max(0, top); row <= Math.min(DISPLAY_HEIGHT - 1, bottom); row++) {
      for (let x = 0; x < WIDTH; x++) {
        this.copyCell(row, x);
      }
    }

    state.expansion++;
    return state.expansion > DISPLAY_HEIGHT;
  }

  private tickGlitch(): boolean {
    const state = this.effectState as { phase: number; glitchFrames: number };

    if (state.phase < state.glitchFrames) {
      this.currentGrid = this.finalGrid.map((row) => {
        const offset = Math.floor(randomUnit() * 7) - 3;
        const glitchRow = [...row];

        if (randomUnit() < 0.3) {
          const shifted = glitchRow.slice(offset).concat(glitchRow.slice(0, offset));
          return shifted.slice(0, WIDTH);
        }

        if (randomUnit() < 0.2) {
          const swapRow = Math.floor(randomUnit() * DISPLAY_HEIGHT);
          return [...(this.finalGrid[swapRow] ?? row)];
        }

        return glitchRow;
      });
      state.phase++;
      return false;
    }

    this.currentGrid = this.finalGrid.map((row) => [...row]);
    return true;
  }

  private tickDissolve(): boolean {
    const state = this.effectState as { positions: [number, number][]; idx: number };
    const pixelsPerFrame = 20;

    for (let i = 0; i < pixelsPerFrame; i++) {
      const position = state.positions[state.idx];
      if (position === undefined) return true;
      const [row, x] = position;
      this.copyCell(row, x);
      state.idx++;
    }
    return false;
  }

  private copyCell(row: number, x: number): void {
    const cell = this.finalGrid[row]?.[x];
    if (cell !== undefined) this.setCell(row, x, cell);
  }

  private setCell(row: number, x: number, cell: string): void {
    const line = this.currentGrid[row];
    if (line !== undefined) line[x] = cell;
  }

  private updateDisplay(): void {
    this.gridVersion++;
  }

  dispose(): void {
    this.stopAnimation();
  }
}
