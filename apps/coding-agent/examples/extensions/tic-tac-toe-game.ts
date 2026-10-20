import { Data } from "effect";

export class TicTacToeError extends Data.TaggedError("TicTacToeError")<{
  readonly message: string;
}> {}

export type Cell = " " | "X" | "O";
export type GameStatus = "playing" | "win_X" | "win_O" | "draw";

export interface GameState {
  board: Cell[][];

  userCursorRow: number;
  userCursorCol: number;

  agentCursorRow: number;
  agentCursorCol: number;
  status: GameStatus;
  userMark: Cell;
  agentMark: Cell;
  currentTurn: Cell;
}

export interface BoardDetails {
  board: Cell[][];
  agentCursorRow: number;
  agentCursorCol: number;
  status: GameStatus;
  currentTurn: Cell;
}

export const AGENT_CURSOR_HOME_ROW = 0;
export const AGENT_CURSOR_HOME_COL = 0;

export function createInitialState(): GameState {
  return {
    agentCursorCol: AGENT_CURSOR_HOME_COL,
    agentCursorRow: AGENT_CURSOR_HOME_ROW,
    agentMark: "O",
    board: [
      [" ", " ", " "],
      [" ", " ", " "],
      [" ", " ", " "],
    ],
    currentTurn: "X",
    status: "playing",
    userCursorCol: 1,
    userCursorRow: 1,
    userMark: "X",
  };
}

export function getCell(request: {
  readonly board: Cell[][];
  readonly row: number;
  readonly col: number;
}): Cell {
  const { board, row, col } = request;
  const cell = board[row]?.[col];
  if (cell === undefined) throw new RangeError(`No cell at (${row},${col}).`);
  return cell;
}

export function setCell(request: {
  readonly board: Cell[][];
  readonly row: number;
  readonly col: number;
  readonly mark: Cell;
}): void {
  const { board, row, col, mark } = request;
  const boardRow = board[row];
  if (boardRow === undefined) throw new RangeError(`No row ${row}.`);
  boardRow[col] = mark;
}

const WIN_LINES: readonly (readonly [number, number])[][] = [
  [
    [0, 0],
    [0, 1],
    [0, 2],
  ],
  [
    [1, 0],
    [1, 1],
    [1, 2],
  ],
  [
    [2, 0],
    [2, 1],
    [2, 2],
  ],
  [
    [0, 0],
    [1, 0],
    [2, 0],
  ],
  [
    [0, 1],
    [1, 1],
    [2, 1],
  ],
  [
    [0, 2],
    [1, 2],
    [2, 2],
  ],
  [
    [0, 0],
    [1, 1],
    [2, 2],
  ],
  [
    [0, 2],
    [1, 1],
    [2, 0],
  ],
];

const isWinningLine = (board: Cell[][], line: readonly (readonly [number, number])[]): boolean => {
  const vals = line.map(([r, c]) => getCell({ board, col: c, row: r }));
  return vals[0] !== " " && vals[0] === vals[1] && vals[1] === vals[2];
};

export function getWinLine(board: Cell[][]): [number, number][] | null {
  for (const line of WIN_LINES) {
    if (isWinningLine(board, line)) return line.map(([r, c]) => [r, c]);
  }
  return null;
}

export function checkWin(board: Cell[][]): GameStatus {
  const winStart = getWinLine(board)?.[0];
  if (winStart !== undefined) {
    const [r, c] = winStart;
    return getCell({ board, col: c, row: r }) === "X" ? "win_X" : "win_O";
  }
  if (board.every((row) => row.every((c) => c !== " "))) {
    return "draw";
  }
  return "playing";
}

export function boardToAscii(request: {
  readonly board: Cell[][];
  readonly agentCursorRow: number;
  readonly agentCursorCol: number;
}): string {
  const { board, agentCursorRow, agentCursorCol } = request;
  const rows = board.map((row, r) =>
    row
      .map((c, cIdx) => {
        const onCursor = r === agentCursorRow && cIdx === agentCursorCol;
        if (c === " ") return onCursor ? `<[${r},${cIdx}]>` : ` [${r},${cIdx}] `;
        return onCursor ? `   <${c}>   ` : `    ${c}    `;
      })
      .join("|"),
  );
  const separator = "---------+---------+---------";
  return rows.join(`\n${separator}\n`);
}
