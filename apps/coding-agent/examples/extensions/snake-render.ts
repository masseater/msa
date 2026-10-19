import { visibleWidth } from "@msa/tui";

import { GAME_HEIGHT, GAME_WIDTH, type GameState } from "./snake-state.ts";

const ANSI_SGR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "gu");

const padLine = (line: string, width: number): string => {
  const visibleLen = line.replace(ANSI_SGR, "").length;
  const padding = Math.max(0, width - visibleLen);
  return line + " ".repeat(padding);
};

const dim = (s: string) => `\x1b[2m${s}\x1b[22m`;
const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const yellow = (s: string) => `\x1b[33m${s}\x1b[0m`;
const bold = (s: string) => `\x1b[1m${s}\x1b[22m`;

const renderRow = (state: GameState, y: number, effectiveWidth: number): string => {
  const head = state.snake[0];
  let row = "";
  for (let x = 0; x < effectiveWidth; x++) {
    const isHead = head !== undefined && head.x === x && head.y === y;
    const isBody = state.snake.slice(1).some((s) => s.x === x && s.y === y);
    const isFood = state.food.x === x && state.food.y === y;

    if (isHead) {
      row += green("██");
    } else if (isBody) {
      row += green("▓▓");
    } else if (isFood) {
      row += red("◆ ");
    } else {
      row += "  ";
    }
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
  return `↑↓←→ or WASD to move, ${bold("ESC")} pause, ${bold("Q")} quit`;
};

export interface FrameOptions {
  readonly state: GameState;
  readonly paused: boolean;
  readonly width: number;
}

export function renderFrame({ state, paused, width }: FrameOptions): string[] {
  const lines: string[] = [];

  const cellWidth = 2;
  const effectiveWidth = Math.min(GAME_WIDTH, Math.floor((width - 4) / cellWidth));
  const boxWidth = effectiveWidth * cellWidth;

  const boxLine = (content: string) => {
    const contentLen = visibleWidth(content);
    const padding = Math.max(0, boxWidth - contentLen);
    return dim(" │") + content + " ".repeat(padding) + dim("│");
  };

  lines.push(padLine(dim(` ╭${"─".repeat(boxWidth)}╮`), width));

  const scoreText = `Score: ${bold(yellow(String(state.score)))}`;
  const highText = `High: ${bold(yellow(String(state.highScore)))}`;
  const title = `${bold(green("SNAKE"))} │ ${scoreText} │ ${highText}`;
  lines.push(padLine(boxLine(title), width));

  lines.push(padLine(dim(` ├${"─".repeat(boxWidth)}┤`), width));

  for (let y = 0; y < GAME_HEIGHT; y++) {
    lines.push(padLine(dim(" │") + renderRow(state, y, effectiveWidth) + dim("│"), width));
  }

  lines.push(padLine(dim(` ├${"─".repeat(boxWidth)}┤`), width));
  lines.push(padLine(boxLine(footerText(state, paused)), width));
  lines.push(padLine(dim(` ╰${"─".repeat(boxWidth)}╯`), width));

  return lines;
}
