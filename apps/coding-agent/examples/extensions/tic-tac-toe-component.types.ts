import type TicTacToeComponentClass from "./tic-tac-toe-component.ts";

declare namespace ticTacToeComponentTypes {
  type TicTacToeComponent = (typeof TicTacToeComponentClass)["prototype"];
}

export type { ticTacToeComponentTypes as default };
