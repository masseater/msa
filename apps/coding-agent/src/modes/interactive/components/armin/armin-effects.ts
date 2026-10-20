import platform from "../../../../core/platform.ts";
import arminHelpers from "../armin-helpers.ts";
import arminSupport from "../armin-support.ts";
import type ArminComponent from "../armin.ts";

const { WIDTH } = arminSupport;
const { randomUnit } = platform;
const { DISPLAY_HEIGHT, shuffle } = arminHelpers;

export default class ArminEffects {
  private readonly armin: ArminComponent;

  constructor(armin: ArminComponent) {
    this.armin = armin;
  }

  createEmptyGrid(): string[][] {
    return Array.from({ length: DISPLAY_HEIGHT }, () => Array(WIDTH).fill(" "));
  }

  private initRainDrops() {
    this.armin.effectState = {
      drops: Array.from({ length: WIDTH }, () => ({
        settled: 0,
        y: -Math.floor(randomUnit() * DISPLAY_HEIGHT * 2),
      })),
    };
  }

  tickEffect(): boolean {
    switch (this.armin.effect) {
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
    const state = this.armin.effectState as { pos: number };
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
    const state = this.armin.effectState as { row: number };
    if (state.row >= DISPLAY_HEIGHT) return true;

    for (let x = 0; x < WIDTH; x++) {
      this.copyCell(state.row, x);
    }
    state.row++;
    return false;
  }

  private tickRain(): boolean {
    const state = this.armin.effectState as {
      drops: { y: number; settled: number }[];
    };

    let allSettled = true;
    this.armin.currentGrid = this.createEmptyGrid();

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
        if (this.armin.finalGrid[row]?.[x] !== " ") {
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
    const state = this.armin.effectState as { positions: [number, number][]; idx: number };
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
    const state = this.armin.effectState as { expansion: number };
    const midRow = Math.floor(DISPLAY_HEIGHT / 2);

    this.armin.currentGrid = this.createEmptyGrid();

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
    const state = this.armin.effectState as { phase: number; glitchFrames: number };

    if (state.phase < state.glitchFrames) {
      this.armin.currentGrid = this.armin.finalGrid.map((row) => {
        const offset = Math.floor(randomUnit() * 7) - 3;
        const glitchRow = [...row];

        if (randomUnit() < 0.3) {
          const shifted = glitchRow.slice(offset).concat(glitchRow.slice(0, offset));
          return shifted.slice(0, WIDTH);
        }

        if (randomUnit() < 0.2) {
          const swapRow = Math.floor(randomUnit() * DISPLAY_HEIGHT);
          return [...(this.armin.finalGrid[swapRow] ?? row)];
        }

        return glitchRow;
      });
      state.phase++;
      return false;
    }

    this.armin.currentGrid = this.armin.finalGrid.map((row) => [...row]);
    return true;
  }

  private tickDissolve(): boolean {
    const state = this.armin.effectState as { positions: [number, number][]; idx: number };
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
    const cell = this.armin.finalGrid[row]?.[x];
    if (cell !== undefined) this.setCell(row, x, cell);
  }

  private setCell(row: number, x: number, cell: string): void {
    const line = this.armin.currentGrid[row];
    if (line !== undefined) line[x] = cell;
  }

  initEffect(): void {
    switch (this.armin.effect) {
      case "typewriter":
        this.armin.effectState = { pos: 0 };
        break;
      case "scanline":
        this.armin.effectState = { row: 0 };
        break;
      case "rain":
        this.initRainDrops();
        break;
      case "fade": {
        const positions: [number, number][] = [];
        for (let row = 0; row < DISPLAY_HEIGHT; row++) {
          for (let x = 0; x < WIDTH; x++) {
            positions.push([row, x]);
          }
        }
        shuffle(positions);
        this.armin.effectState = { idx: 0, positions };
        break;
      }
      case "crt":
        this.armin.effectState = { expansion: 0 };
        break;
      case "glitch":
        this.armin.effectState = { glitchFrames: 8, phase: 0 };
        break;
      case "dissolve": {
        this.armin.currentGrid = Array.from({ length: DISPLAY_HEIGHT }, () =>
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
        this.armin.effectState = { idx: 0, positions: dissolvePositions };
        break;
      }
    }
  }
}
