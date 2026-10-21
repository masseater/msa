import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type ticTacToeGameTypes from "./tic-tac-toe-game.types.ts";
import ticTacToeRender from "./tic-tac-toe-render.ts";

const { renderBoardSnapshot } = ticTacToeRender;

const { visibleWidth } = tui;

export default class GameOverMessageComponent implements tuiTypes.Component {
  private readonly status: ticTacToeGameTypes.GameStatus;
  private readonly details: ticTacToeGameTypes.BoardDetails | undefined;
  private readonly theme: codingAgentTypes.Theme;

  constructor(
    status: ticTacToeGameTypes.GameStatus,
    details: ticTacToeGameTypes.BoardDetails | undefined,
    theme: codingAgentTypes.Theme,
  ) {
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
