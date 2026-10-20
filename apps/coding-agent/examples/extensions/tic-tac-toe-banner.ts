import type { Theme } from "@msa/coding-agent";
import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import type { BoardDetails } from "./tic-tac-toe-game.ts";
import { renderBoardSnapshot } from "./tic-tac-toe-render.ts";

const { visibleWidth } = tui;

export class BannerMessageComponent implements tuiTypes.Component {
  private readonly title: string;
  private readonly details: BoardDetails | undefined;
  private readonly expanded: boolean;
  private readonly theme: Theme;

  constructor(title: string, details: BoardDetails | undefined, expanded: boolean, theme: Theme) {
    this.title = title;
    this.details = details;
    this.expanded = expanded;
    this.theme = theme;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const dim = (s: string) => this.theme.fg("dim", s);
    const lines: string[] = [];
    const titleLen = visibleWidth(this.title);
    const fillLen = Math.max(0, width - titleLen - 2);
    const leftFill = Math.floor(fillLen / 2);
    const rightFill = fillLen - leftFill;
    lines.push(
      `${dim("\u2500".repeat(leftFill))} ${this.title} ${dim("\u2500".repeat(rightFill))}`,
    );

    if (this.expanded && this.details !== undefined) {
      lines.push("");
      lines.push(...renderBoardSnapshot({ board: this.details.board, maxWidth: width }));
    }

    return lines;
  }
}
