import type TicTacToeErrorClass from "./tic-tac-toe-error.ts";

declare namespace ticTacToeGameTypes {
  type Cell = " " | "X" | "O";

  type GameStatus = "playing" | "win_X" | "win_O" | "draw";

  interface GameState {
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

  interface BoardDetails {
    board: Cell[][];
    agentCursorRow: number;
    agentCursorCol: number;
    status: GameStatus;
    currentTurn: Cell;
  }

  type TicTacToeError = (typeof TicTacToeErrorClass)["prototype"];
}

export type { ticTacToeGameTypes as default };
