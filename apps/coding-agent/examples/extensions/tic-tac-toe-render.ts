import tui from "@msa/tui";

import ticTacToeGame from "./tic-tac-toe-game.ts";
import type ticTacToeGameTypes from "./tic-tac-toe-game.types.ts";
import type ticTacToeRenderTypes from "./tic-tac-toe-render.types.ts";

const { getCell, getWinLine } = ticTacToeGame;

const { truncateToWidth, visibleWidth } = tui;

const CELL_WIDTH = 7;
const CELL_HEIGHT = 3;

const FG_CODE_X = "34";
const FG_CODE_O = "33";
const FG_CODE_WIN = "32";

const GLYPH_X = "\u2573";
const GLYPH_O = "\u25ef";

const DIM = (s: string) => `\x1b[2m${s}\x1b[22m`;
const RESET = "\x1b[0m";

function centerPad(request: { readonly content: string; readonly width: number }): string {
  const { content, width } = request;
  const contentLen = visibleWidth(content);
  if (contentLen >= width) return truncateToWidth(content, width);
  const pad = width - contentLen;
  const left = Math.floor(pad / 2);
  return " ".repeat(left) + content + " ".repeat(pad - left);
}

function cellFgCode(cell: ticTacToeGameTypes.Cell, isWin: boolean): string | undefined {
  if (cell === " ") return undefined;
  if (isWin) return FG_CODE_WIN;
  return cell === "X" ? FG_CODE_X : FG_CODE_O;
}

function buildCellContent(request: {
  readonly mark: ticTacToeGameTypes.Cell;
  readonly lineIdx: number;
  readonly isWin: boolean;
}): string {
  const { mark, lineIdx, isWin } = request;
  const empty = " ".repeat(CELL_WIDTH);
  if (mark === " ") return empty;

  const isMidLine = lineIdx === Math.floor(CELL_HEIGHT / 2);
  if (!isMidLine) return empty;

  const glyph = mark === "X" ? GLYPH_X : GLYPH_O;
  const fg = cellFgCode(mark, isWin) as string;
  const padLen = CELL_WIDTH - visibleWidth(glyph);
  const leftPad = Math.floor(padLen / 2);
  const rightPad = padLen - leftPad;
  return `${" ".repeat(leftPad)}\x1b[${fg};1m${glyph}${RESET}${" ".repeat(rightPad)}`;
}

function borderFgCode(
  adjacent: ReadonlyArray<{ cell: ticTacToeGameTypes.Cell; isWin: boolean }>,
): string | undefined {
  const fgs = adjacent
    .map((a) => cellFgCode(a.cell, a.isWin))
    .filter((f): f is string => f !== undefined && f.length > 0);
  if (fgs.length === 0) return undefined;
  const first = fgs[0];
  return fgs.every((f) => f === first) ? first : undefined;
}

interface RenderContext {
  readonly board: ticTacToeGameTypes.Cell[][];
  readonly maxWidth: number;
  readonly showCursor: boolean;
  readonly row: number;
  readonly col: number;
  readonly cursorSgr: string;
  readonly winCells: Set<string>;
}

const cellAt = (ctx: RenderContext, r: number, c: number) => ({
  cell: getCell({ board: ctx.board, col: c, row: r }),
  isWin: ctx.winCells.has(`${r},${c}`),
});

const isCursorCorner = (ctx: RenderContext, gridR: number, gridC: number): boolean =>
  ctx.showCursor &&
  (gridR === ctx.row || gridR === ctx.row + 1) &&
  (gridC === ctx.col || gridC === ctx.col + 1);

const isCursorHSegment = (ctx: RenderContext, gridR: number, c: number): boolean =>
  ctx.showCursor && c === ctx.col && (gridR === ctx.row || gridR === ctx.row + 1);

const isCursorVBorder = (ctx: RenderContext, r: number, gridC: number): boolean =>
  ctx.showCursor && r === ctx.row && (gridC === ctx.col || gridC === ctx.col + 1);

const paintBorder = (
  ctx: RenderContext,
  ch: string,
  highlighted: boolean,
  fgCode: string | undefined,
): string => {
  if (highlighted) return `${ctx.cursorSgr}${ch}${RESET}`;
  if (fgCode !== undefined && fgCode.length > 0) return `\x1b[${fgCode};1m${ch}${RESET}`;
  return DIM(ch);
};

const cornerChar = (gridR: number, gridC: number): string => {
  if (gridR === 0 && gridC === 0) return "\u250c";
  if (gridR === 0 && gridC === 3) return "\u2510";
  if (gridR === 3 && gridC === 0) return "\u2514";
  if (gridR === 3 && gridC === 3) return "\u2518";
  if (gridR === 0) return "\u252c";
  if (gridR === 3) return "\u2534";
  if (gridC === 0) return "\u251c";
  if (gridC === 3) return "\u2524";
  return "\u253c";
};

const cornerAdjacent = (ctx: RenderContext, gridR: number, gridC: number) => {
  const out: { cell: ticTacToeGameTypes.Cell; isWin: boolean }[] = [];
  for (const [dr, dc] of [
    [-1, -1],
    [-1, 0],
    [0, -1],
    [0, 0],
  ] as const) {
    const r = gridR + dr;
    const c = gridC + dc;
    if (r >= 0 && r < 3 && c >= 0 && c < 3) out.push(cellAt(ctx, r, c));
  }
  return out;
};

const horizontalRow = (ctx: RenderContext, gridR: number): string => {
  let row = "";
  for (let gridC = 0; gridC <= 3; gridC++) {
    const cornerColor = borderFgCode(cornerAdjacent(ctx, gridR, gridC));
    row += paintBorder(
      ctx,
      cornerChar(gridR, gridC),
      isCursorCorner(ctx, gridR, gridC),
      cornerColor,
    );
    if (gridC >= 3) continue;

    const adj: { cell: ticTacToeGameTypes.Cell; isWin: boolean }[] = [];
    if (gridR > 0) adj.push(cellAt(ctx, gridR - 1, gridC));
    if (gridR < 3) adj.push(cellAt(ctx, gridR, gridC));
    row += paintBorder(
      ctx,
      "\u2500".repeat(CELL_WIDTH),
      isCursorHSegment(ctx, gridR, gridC),
      borderFgCode(adj),
    );
  }
  return row;
};

const cellRows = (ctx: RenderContext, gridR: number, lineIdx: number): string => {
  let contentRow = "";
  for (let gridC = 0; gridC <= 3; gridC++) {
    const adj: { cell: ticTacToeGameTypes.Cell; isWin: boolean }[] = [];
    if (gridC > 0) adj.push(cellAt(ctx, gridR, gridC - 1));
    if (gridC < 3) adj.push(cellAt(ctx, gridR, gridC));
    contentRow += paintBorder(ctx, "\u2502", isCursorVBorder(ctx, gridR, gridC), borderFgCode(adj));
    if (gridC < 3) {
      contentRow += buildCellContent({
        isWin: ctx.winCells.has(`${gridR},${gridC}`),
        lineIdx,
        mark: getCell({ board: ctx.board, col: gridC, row: gridR }),
      });
    }
  }
  return contentRow;
};

function renderBoard(opts: ticTacToeRenderTypes.BoardRenderOpts): string[] {
  const { board, maxWidth, cursor } = opts;
  const winLine = getWinLine(board);
  const ctx: RenderContext = {
    board,
    col: cursor?.col ?? -1,
    cursorSgr: cursor?.owner === "agent" ? "\x1b[33;1m" : "\x1b[32;1m",
    maxWidth,
    row: cursor?.row ?? -1,
    showCursor: cursor !== undefined,
    winCells: new Set((winLine ?? []).map(([r, c]) => `${r},${c}`)),
  };

  const lines: string[] = [];
  for (let gridR = 0; gridR <= 3; gridR++) {
    lines.push(centerPad({ content: horizontalRow(ctx, gridR), width: maxWidth }));
    if (gridR === 3) break;

    for (let lineIdx = 0; lineIdx < CELL_HEIGHT; lineIdx++) {
      lines.push(centerPad({ content: cellRows(ctx, gridR, lineIdx), width: maxWidth }));
    }
  }
  return lines;
}

function renderVisualBoard(request: {
  readonly state: ticTacToeGameTypes.GameState;
  readonly maxWidth: number;
}): string[] {
  const { state, maxWidth } = request;
  const isUserTurn = state.currentTurn === state.userMark;
  const cursor =
    state.status === "playing"
      ? {
          col: isUserTurn ? state.userCursorCol : state.agentCursorCol,
          owner: (isUserTurn ? "user" : "agent") as "user" | "agent",
          row: isUserTurn ? state.userCursorRow : state.agentCursorRow,
        }
      : undefined;
  return renderBoard({ board: state.board, cursor, maxWidth });
}

function renderBoardSnapshot(request: {
  readonly board: ticTacToeGameTypes.Cell[][];
  readonly maxWidth: number;
}): string[] {
  const { board, maxWidth } = request;
  return renderBoard({ board, maxWidth });
}

const ticTacToeRender = {
  centerPad,
  renderBoardSnapshot,
  renderVisualBoard,
};

export default ticTacToeRender;
