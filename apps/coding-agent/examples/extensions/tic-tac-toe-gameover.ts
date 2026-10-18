import type { Theme } from "@msa/coding-agent";
import { type Component, visibleWidth } from "@msa/tui";

import type { BoardDetails, GameStatus } from "./tic-tac-toe-game.ts";
import { renderBoardSnapshot } from "./tic-tac-toe-render.ts";

export class GameOverMessageComponent implements Component {
  private readonly status: GameStatus;
  private readonly details: BoardDetails | undefined;
  private readonly theme: Theme;

  constructor(status: GameStatus, details: BoardDetails | undefined, theme: Theme) {
    this.status = status;
    this.details = details;
    this.theme = theme;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const dim = (s: string) => this.theme.fg("dim", s);
    const bold = (s: string) => this.theme.bold(s);

    const hr = dim("\u2500".repeat(width));
    const lines: string[] = [];
    lines.push(hr);
    lines.push("");

    let title: string;
    let sub: string;
    switch (this.status) {
      case "win_X":
        title = bold(this.theme.fg("accent", "\u2605 Player X wins \u2605"));
        sub = "You beat the agent.";
        break;
      case "win_O":
        title = bold(this.theme.fg("warning", "\u2605 Player O wins \u2605"));
        sub = "The agent beat you.";
        break;
      case "draw":
        title = bold(this.theme.fg("muted", "\u2014 Draw \u2014"));
        sub = "No winner.";
        break;
      default:
        title = bold("Game over");
        sub = "";
        break;
    }

    for (const line of [title, dim(sub)]) {
      const pad = Math.max(0, width - visibleWidth(line));
      lines.push(`${" ".repeat(Math.floor(pad / 2))}${line}`);
    }

    lines.push("");
    if (this.details !== undefined) {
      lines.push(...renderBoardSnapshot({ board: this.details.board, maxWidth: width }));
      lines.push("");
    }
    lines.push(hr);

    return lines;
  }
}
