import type GameOverMessageComponentClass from "./tic-tac-toe-gameover.ts";

declare namespace ticTacToeGameoverTypes {
  type GameOverMessageComponent = (typeof GameOverMessageComponentClass)["prototype"];
}

export type { ticTacToeGameoverTypes as default };
