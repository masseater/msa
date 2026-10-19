import { visibleWidth } from "@msa/tui";

import {
  type Bullet,
  GAME_HEIGHT,
  GAME_WIDTH,
  type GameState,
  PLAYER_Y,
  type Shield,
} from "./space-invaders-state.ts";

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");

const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const magenta = (s: string) => `\x1b[35m${s}\x1b[0m`;
const white = (s: string) => `\x1b[97m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

const padLine = (line: string, width: number): string => {
  const visibleLen = line.replace(ANSI_SGR, "").length;
  const padding = Math.max(0, width - visibleLen);
  return line + " ".repeat(padding);
};

const alienAt = (state: GameState, x: number, y: number): string | undefined => {
  for (const alien of state.aliens) {
    if (!alien.alive || alien.y !== y || Math.abs(alien.x - x) > 1) continue;
    const sprites = [
      x === alien.x ? "▼" : x < alien.x ? "╲" : "╱",
      x === alien.x ? "◆" : x < alien.x ? "╱" : "╲",
      x === alien.x ? "☆" : x < alien.x ? "◄" : "►",
    ] as const;
    const colors = [green, cyan, magenta] as const;
    return colors[alien.type](sprites[alien.type]);
  }
  return undefined;
};

const shieldAt = (state: GameState, x: number, y: number): string | undefined => {
  const shield: Shield | undefined = state.shields.find(
    (s) => x - s.x >= 0 && x - s.x < 4 && y - (PLAYER_Y - 5) >= 0 && y - (PLAYER_Y - 5) < 3,
  );
  if (shield === undefined) return undefined;

  const relX = x - shield.x;
  const relY = y - (PLAYER_Y - 5);
  return shield.segments[relY]?.[relX] === true ? dim("█") : undefined;
};

const playerAt = (state: GameState, x: number, y: number): string | undefined => {
  if (y !== PLAYER_Y || Math.abs(x - state.player.x) > 1) return undefined;
  return white(x === state.player.x ? "▲" : "═");
};

const bulletAt = (state: GameState, x: number, y: number): string | undefined => {
  const bullet: Bullet | undefined = state.bullets.find((b) => b.x === x && b.y === y);
  if (bullet === undefined) return undefined;
  return bullet.direction === -1 ? yellow("│") : red("│");
};

const cellAt = (state: GameState, x: number, y: number): string => {
  const layers = [alienAt, shieldAt, playerAt, bulletAt];
  for (const layer of layers) {
    const cell = layer(state, x, y);
    if (cell !== undefined) return cell;
  }
  return " ";
};

const renderRow = (state: GameState, y: number): string => {
  let row = "";
  for (let x = 0; x < GAME_WIDTH; x++) {
    row += cellAt(state, x, y);
  }
  return row;
};

const footerText = (state: GameState, paused: boolean): string => {
  if (paused) {
    return `${yellow(bold("PAUSED"))} Press any key to continue, ${bold("Q")} to quit`;
  }
  if (state.gameOver) {
    return `${red(bold("GAME OVER!"))} Press ${bold("R")} to restart, ${bold("Q")} to quit`;
  }
  if (state.victory) {
    return `${green(bold("VICTORY!"))} Press ${bold("R")} for level ${state.level + 1}, ${bold("Q")} to quit`;
  }
  return `←→ or AD to move, ${bold("SPACE")}/F to fire, ${bold("ESC")} pause, ${bold("Q")} quit`;
};

export interface FrameOptions {
  readonly state: GameState;
  readonly paused: boolean;
  readonly width: number;
}

export function renderFrame({ state, paused, width }: FrameOptions): string[] {
  const boxWidth = GAME_WIDTH;
  const lines: string[] = [];

  const boxLine = (content: string) => {
    const padding = Math.max(0, boxWidth - visibleWidth(content));
    return dim(" │") + content + " ".repeat(padding) + dim("│");
  };

  lines.push(padLine(dim(` ╭${"─".repeat(boxWidth)}╮`), width));

  const scoreText = `Score: ${bold(yellow(String(state.score)))}`;
  const highText = `Hi: ${bold(yellow(String(state.highScore)))}`;
  const levelText = `Lv: ${bold(cyan(String(state.level)))}`;
  const livesText = red("♥".repeat(state.player.lives));
  const header = `${bold(green("SPACE INVADERS"))} │ ${scoreText} │ ${highText} │ ${levelText} │ ${livesText}`;
  lines.push(padLine(boxLine(header), width));

  lines.push(padLine(dim(` ├${"─".repeat(boxWidth)}┤`), width));

  for (let y = 0; y < GAME_HEIGHT; y++) {
    lines.push(padLine(dim(" │") + renderRow(state, y) + dim("│"), width));
  }

  lines.push(padLine(dim(` ├${"─".repeat(boxWidth)}┤`), width));
  lines.push(padLine(boxLine(footerText(state, paused)), width));
  lines.push(padLine(dim(` ╰${"─".repeat(boxWidth)}╯`), width));

  return lines;
}
