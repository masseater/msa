import platform from "../../../core/platform.ts";
import intervalModule from "../../interval.ts";
import themeModule from "../theme/theme.ts";
import arminHelpers from "./armin-helpers.ts";
import ArminComponentLayer0 from "./armin-layer-0.ts";
import arminSupport from "./armin-support.ts";

const { theme } = themeModule;
const { WIDTH } = arminSupport;
const { randomUnit } = platform;
const { every } = intervalModule;
const { DISPLAY_HEIGHT } = arminHelpers;

export default abstract class ArminComponentLayer1 extends ArminComponentLayer0 {
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

  protected createEmptyGrid(): string[][] {
    return Array.from({ length: DISPLAY_HEIGHT }, () => Array(WIDTH).fill(" "));
  }

  protected initEffectPart1() {
    this.effectState = {
      drops: Array.from({ length: WIDTH }, () => ({
        settled: 0,
        y: -Math.floor(randomUnit() * DISPLAY_HEIGHT * 2),
      })),
    };
  }

  protected startAnimation(): void {
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

  protected stopAnimation(): void {
    if (this.interval !== null) {
      this.interval.cancel();
      this.interval = null;
    }
  }

  protected tickEffect(): boolean {
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

  protected tickTypewriter(): boolean {
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

  protected tickScanline(): boolean {
    const state = this.effectState as { row: number };
    if (state.row >= DISPLAY_HEIGHT) return true;

    for (let x = 0; x < WIDTH; x++) {
      this.copyCell(state.row, x);
    }
    state.row++;
    return false;
  }

  protected tickRain(): boolean {
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

  protected tickFade(): boolean {
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

  protected tickCrt(): boolean {
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

  protected tickGlitch(): boolean {
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

  protected tickDissolve(): boolean {
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

  protected copyCell(row: number, x: number): void {
    const cell = this.finalGrid[row]?.[x];
    if (cell !== undefined) this.setCell(row, x, cell);
  }

  protected setCell(row: number, x: number, cell: string): void {
    const line = this.currentGrid[row];
    if (line !== undefined) line[x] = cell;
  }

  protected updateDisplay(): void {
    this.gridVersion++;
  }

  dispose(): void {
    this.stopAnimation();
  }
}
