import type codingAgentTypes from "@msa/coding-agent/index.types";

import type ticTacToeGameTypes from "./tic-tac-toe-game.types.ts";

declare namespace ticTacToeActionsTypes {
  type Action = "move_up" | "move_down" | "move_left" | "move_right" | "play";

  interface GameAccess {
    readonly msa: codingAgentTypes.ExtensionAPI;
    readonly getState: () => ticTacToeGameTypes.GameState;
    readonly syncComponent: () => void;
    readonly save: () => void;
    readonly setActive: (active: boolean) => void;
    readonly emitGameOver: () => void;
  }
}

export type { ticTacToeActionsTypes as default };
