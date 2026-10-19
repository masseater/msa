import { type Component, matchesKey, visibleWidth } from "@msa/tui";

import { type GameState, getCell } from "./tic-tac-toe-game.ts";
import { centerPad, renderVisualBoard } from "./tic-tac-toe-render.ts";

const ESC = "\x1b[";
const reset = `${ESC}0m`;
const bold = (s: string) => `${ESC}1m${s}${reset}`;
const dim = (s: string) => `${ESC}2m${s}${reset}`;
const blue = (s: string) => `${ESC}34m${s}${reset}`;
const yellow = (s: string) => `${ESC}33m${s}${reset}`;
const green = (s: string) => `${ESC}32m${s}${reset}`;

const titleLine = (width: number): string[] => {
  const titleText = " Tic-Tac-Toe ";
  const borderLen = Math.max(0, width - visibleWidth(titleText));
  const leftBorder = Math.floor(borderLen / 2);
  const rightBorder = borderLen - leftBorder;
  return [
    dim("\u2500".repeat(leftBorder)) + bold(blue(titleText)) + dim("\u2500".repeat(rightBorder)),
  ];
};

const statusLine = (state: GameState, width: number): string => {
  if (state.status !== "playing") {
    const text =
      state.status === "draw"
        ? bold(yellow("Draw!"))
        : state.status === "win_X"
          ? bold(green("X wins!"))
          : bold(yellow("O wins!"));
    return centerPad({ content: text, width });
  }
  if (state.currentTurn === "X") {
    return centerPad({
      content: `Turn: ${bold(blue("X"))} (You)  ${dim("|")}  ${bold(yellow("O"))} (Agent)`,
      width,
    });
  }
  return centerPad({
    content: `${blue("X")} (You)  ${dim("|")}  Turn: ${bold(yellow("O"))} (Agent)`,
    width,
  });
};

const footerLine = (state: GameState): string => {
  if (state.status !== "playing") {
    return `${bold("R")} restart  ${dim("|")}  ${bold("Q")}/${bold("ESC")} quit`;
  }
  if (state.currentTurn === state.userMark) {
    return `${bold("\u2190\u2191\u2193\u2192")} move  ${dim("|")}  ${bold("ENTER")} play  ${dim("|")}  ${bold("ESC")} quit`;
  }
  return dim("Agent is thinking...");
};

export class TicTacToeComponent implements Component {
  private state: GameState;
  private onClose: () => void;
  private onUserPlay: (row: number, col: number) => void;
  private tui: { requestRender: () => void };
  private cachedLines: string[] = [];
  private cachedWidth = 0;
  private version = 0;
  private cachedVersion = -1;

  constructor(
    tui: { requestRender: () => void },
    onClose: () => void,
    onUserPlay: (row: number, col: number) => void,
    state: GameState,
  ) {
    this.tui = tui;
    this.onClose = onClose;
    this.onUserPlay = onUserPlay;
    this.state = state;
  }

  updateState(state: GameState): void {
    this.state = state;
    this.version++;
    this.tui.requestRender();
  }

  handleInput(data: string): boolean {
    if (matchesKey(data, "escape") || data === "q" || data === "Q") {
      this.onClose();
      return true;
    }
    if (this.state.status !== "playing") {
      if (data === "r" || data === "R") {
        this.onClose();
        return true;
      }
      return true;
    }
    if (this.state.currentTurn !== this.state.userMark) return true;

    if (matchesKey(data, "up") && this.state.userCursorRow > 0) {
      this.state.userCursorRow--;
      this.version++;
      this.tui.requestRender();
    } else if (matchesKey(data, "down") && this.state.userCursorRow < 2) {
      this.state.userCursorRow++;
      this.version++;
      this.tui.requestRender();
    } else if (matchesKey(data, "left") && this.state.userCursorCol > 0) {
      this.state.userCursorCol--;
      this.version++;
      this.tui.requestRender();
    } else if (matchesKey(data, "right") && this.state.userCursorCol < 2) {
      this.state.userCursorCol++;
      this.version++;
      this.tui.requestRender();
    } else if (matchesKey(data, "return") || data === " ") {
      const { userCursorRow, userCursorCol } = this.state;
      if (getCell({ board: this.state.board, row: userCursorRow, col: userCursorCol }) === " ") {
        this.onUserPlay(userCursorRow, userCursorCol);
      }
    }
    return true;
  }

  invalidate(): void {
    this.cachedWidth = 0;
  }

  render(width: number): string[] {
    if (width === this.cachedWidth && this.cachedVersion === this.version) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    lines.push(...titleLine(width));
    lines.push("");
    lines.push(statusLine(this.state, width));
    lines.push("");
    lines.push("");
    lines.push(...renderVisualBoard({ state: this.state, maxWidth: width }));
    lines.push("");
    lines.push("");
    lines.push(centerPad({ content: footerLine(this.state), width }));
    lines.push("");
    lines.push(`${ESC}2m${"\u2500".repeat(width)}${ESC}0m`);

    this.cachedLines = lines;
    this.cachedWidth = width;
    this.cachedVersion = this.version;
    return lines;
  }
}
