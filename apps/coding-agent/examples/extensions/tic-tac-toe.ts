import type { ExtensionAPI, ExtensionContext } from "@msa/coding-agent";
import { Effect } from "effect";

import { registerPlayTool, registerSeeBoardTool } from "./tic-tac-toe-actions.ts";
import { BannerMessageComponent } from "./tic-tac-toe-banner.ts";
import { TicTacToeComponent } from "./tic-tac-toe-component.ts";
import {
  type BoardDetails,
  type GameState,
  type GameStatus,
  boardToAscii,
  checkWin,
  createInitialState,
  setCell,
} from "./tic-tac-toe-game.ts";
import { GameOverMessageComponent } from "./tic-tac-toe-gameover.ts";
import { ticTacToeInstructions } from "./tic-tac-toe-prompt.ts";

const SAVE_TYPE = "tic-tac-toe-save";
const MOVE_MESSAGE_TYPE = "tic-tac-toe-move";
const GAME_OVER_MESSAGE_TYPE = "tic-tac-toe-game-over";

let gameState: GameState = createInitialState();
let component: TicTacToeComponent | null = null;
let gameActive = false;

const getBoardDetails = (): BoardDetails => ({
  agentCursorCol: gameState.agentCursorCol,
  agentCursorRow: gameState.agentCursorRow,
  board: gameState.board.map((row) => [...row]),
  currentTurn: gameState.currentTurn,
  status: gameState.status,
});

const reconstructState = (ctx: ExtensionContext): void => {
  gameState = createInitialState();
  gameActive = false;

  for (const entry of ctx.sessionManager.getBranch()) {
    if (entry.type !== "message") continue;
    const msg = entry.message;
    if (msg.role !== "toolResult") continue;
    if (msg.toolName !== "tic_tac_toe" && msg.toolName !== "tic_tac_toe_see_board") continue;

    const details = msg.details as BoardDetails | undefined;
    if (details !== undefined) {
      gameState.board = details.board.map((row) => [...row]);
      gameState.agentCursorRow = details.agentCursorRow;
      gameState.agentCursorCol = details.agentCursorCol;
      gameState.status = details.status;
      gameState.currentTurn = details.currentTurn;
    }
  }
};

const gameOverLabel = (): string => {
  switch (gameState.status) {
    case "win_X":
      return "Player X (human) wins";
    case "win_O":
      return "Player O (agent) wins";
    case "draw":
      return "Draw";
    default:
      return "Game over";
  }
};

const emitGameOverMessage = (msa: ExtensionAPI): void => {
  msa.sendMessage({
    content: `Game over: ${gameOverLabel()}.`,
    customType: GAME_OVER_MESSAGE_TYPE,
    details: getBoardDetails(),
    display: true,
  });
};

const registerSessionEvents = (msa: ExtensionAPI): void => {
  msa.on("session_start", (_event, ctx) => reconstructState(ctx));
  msa.on("session_tree", (_event, ctx) => reconstructState(ctx));
};

const registerMessageRenderers = (msa: ExtensionAPI): void => {
  msa.registerMessageRenderer(MOVE_MESSAGE_TYPE, (message, { expanded }, theme) => {
    const details = message.details as BoardDetails | undefined;
    const turnLabel =
      details?.currentTurn === "O"
        ? `${theme.fg("warning", theme.bold("O"))} (Agent)`
        : `${theme.fg("accent", theme.bold("X"))} (You)`;
    const title = `${theme.fg("accent", theme.bold("Player X played"))}  ${theme.fg("dim", "\u2192")}  next: ${turnLabel}`;
    return new BannerMessageComponent(title, details, expanded, theme);
  });

  msa.registerMessageRenderer(GAME_OVER_MESSAGE_TYPE, (message, _options, theme) => {
    const details = message.details as BoardDetails | undefined;
    const status = (details?.status ?? "draw") as GameStatus;
    return new GameOverMessageComponent(status, details, theme);
  });
};

const registerPrompt = (msa: ExtensionAPI): void => {
  msa.on("before_agent_start", (event) => {
    if (!gameActive) return undefined;
    return { systemPrompt: event.systemPrompt + ticTacToeInstructions };
  });
};

const announceTurn = (msa: ExtensionAPI, row: number, col: number): void => {
  const boardAscii = boardToAscii({
    agentCursorCol: gameState.agentCursorCol,
    agentCursorRow: gameState.agentCursorRow,
    board: gameState.board,
  });
  msa.sendMessage(
    {
      content:
        `Player X played at (row=${row}, col=${col}). It is now Player O's turn.\n\n` +
        `Board (your cursor marked with <>):\n${boardAscii}\n\n` +
        `Your cursor is at (row=${gameState.agentCursorRow}, col=${gameState.agentCursorCol}). ` +
        `Decide your target cell, then emit every move_* and the final play ` +
        `as separate tic_tac_toe tool calls in THIS response.`,
      customType: MOVE_MESSAGE_TYPE,
      details: getBoardDetails(),
      display: true,
    },
    { triggerTurn: true },
  );
};

const handleUserPlay = (msa: ExtensionAPI, row: number, col: number): void => {
  setCell({ board: gameState.board, col, mark: gameState.userMark, row });
  gameState.status = checkWin(gameState.board);
  if (gameState.status === "playing") {
    gameState.currentTurn = gameState.agentMark;
  }
  component?.updateState(gameState);
  msa.appendEntry(SAVE_TYPE, getBoardDetails());

  if (gameState.status === "playing") {
    announceTurn(msa, row, col);
    return;
  }
  emitGameOverMessage(msa);
  gameActive = false;
};

const openBoard = (msa: ExtensionAPI, ctx: ExtensionContext): Promise<void> =>
  ctx.ui.custom<void>((tui, _theme, _kb, done) => {
    component = new TicTacToeComponent(
      tui,
      () => {
        component = null;
        gameActive = false;
        done(undefined);
      },
      (row, col) => handleUserPlay(msa, row, col),
      gameState,
    );
    return component;
  });

const registerCommand = (msa: ExtensionAPI): void => {
  msa.registerCommand("tic-tac-toe", {
    description: "Play tic-tac-toe against the agent",
    handler: (_args, ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          if (ctx.mode !== "tui") {
            ctx.ui.notify("Tic-tac-toe requires interactive mode", "error");
            return;
          }

          reconstructState(ctx);
          if (gameState.status !== "playing") {
            gameState = createInitialState();
          }
          gameActive = true;
          msa.setSessionName("Tic-Tac-Toe");
          yield* Effect.promise(() => openBoard(msa, ctx));
        }),
      ),
  });
};

export default function (msa: ExtensionAPI) {
  const access = {
    emitGameOver: () => emitGameOverMessage(msa),
    getState: () => gameState,
    msa,
    save: () => msa.appendEntry(SAVE_TYPE, getBoardDetails()),
    setActive: (active: boolean) => {
      gameActive = active;
    },
    syncComponent: () => component?.updateState(gameState),
  };

  registerSessionEvents(msa);
  registerMessageRenderers(msa);
  registerPrompt(msa);
  registerCommand(msa);
  registerPlayTool(access);
  registerSeeBoardTool({ access, getBoardDetails });
}
