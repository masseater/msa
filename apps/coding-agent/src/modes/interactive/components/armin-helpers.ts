import platform from "../../../core/platform.ts";
import type arminInternalTypes from "./armin-internal.types.ts";
import arminSupport from "./armin-support.ts";

const { HEIGHT, WIDTH, isArminPixel } = arminSupport;
const { randomUnit } = platform;

const DISPLAY_HEIGHT = Math.ceil(HEIGHT / 2);

const EFFECTS: arminInternalTypes.Effect[] = [
  "typewriter",
  "scanline",
  "rain",
  "fade",
  "crt",
  "glitch",
  "dissolve",
];

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

const arminHelpers = { DISPLAY_HEIGHT, EFFECTS, buildFinalGrid, getChar, shuffle };

export default arminHelpers;
