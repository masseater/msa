import type ticTacToeGameTypes from "./tic-tac-toe-game.types.ts";

declare namespace ticTacToeRenderTypes {
  interface BoardRenderOpts {
    board: ticTacToeGameTypes.Cell[][];
    maxWidth: number;

    cursor?: { row: number; col: number; owner: "user" | "agent" } | undefined;
  }
}

export type { ticTacToeRenderTypes as default };
