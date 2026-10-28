import ai from "@msa/ai";
import type codingAgentTypes from "@msa/coding-agent/index.types";
import tui from "@msa/tui";
import { Effect } from "effect";
import { Type } from "typebox";

import type ticTacToeActionsTypes from "./tic-tac-toe-actions.types.ts";
import BannerMessageComponent from "./tic-tac-toe-banner.ts";
import TicTacToeError from "./tic-tac-toe-error.ts";
import ticTacToeGame from "./tic-tac-toe-game.ts";
import type ticTacToeGameTypes from "./tic-tac-toe-game.types.ts";

const { AGENT_CURSOR_HOME_COL, AGENT_CURSOR_HOME_ROW, boardToAscii, checkWin, getCell, setCell } =
  ticTacToeGame;
const { StringEnum } = ai;

const { Text } = tui;

const ACTION_DELAYS: Record<ticTacToeActionsTypes.Action, number> = {
  move_down: 300,
  move_left: 300,
  move_right: 300,
  move_up: 300,
  play: 0,
};

const applyAction = (request: {
  readonly access: ticTacToeActionsTypes.GameAccess;
  readonly action: ticTacToeActionsTypes.Action;
}): string => {
  const { access, action } = request;
  const gameState = access.getState();
  switch (action) {
    case "move_up":
      if (gameState.agentCursorRow > 0) gameState.agentCursorRow--;
      return `Moved up. Cursor: (${gameState.agentCursorRow}, ${gameState.agentCursorCol})`;
    case "move_down":
      if (gameState.agentCursorRow < 2) gameState.agentCursorRow++;
      return `Moved down. Cursor: (${gameState.agentCursorRow}, ${gameState.agentCursorCol})`;
    case "move_left":
      if (gameState.agentCursorCol > 0) gameState.agentCursorCol--;
      return `Moved left. Cursor: (${gameState.agentCursorRow}, ${gameState.agentCursorCol})`;
    case "move_right":
      if (gameState.agentCursorCol < 2) gameState.agentCursorCol++;
      return `Moved right. Cursor: (${gameState.agentCursorRow}, ${gameState.agentCursorCol})`;
    case "play":
      return playForAgent(access);
  }
};

const playForAgent = (access: ticTacToeActionsTypes.GameAccess): string => {
  const gameState = access.getState();
  if (gameState.status !== "playing") {
    throw TicTacToeError.make({ message: `Game is over (${gameState.status}).` });
  }
  if (gameState.currentTurn !== gameState.agentMark) {
    throw TicTacToeError.make({ message: "It is not your turn." });
  }

  const r = gameState.agentCursorRow;
  const c = gameState.agentCursorCol;
  const target = getCell({ board: gameState.board, col: c, row: r });
  if (target !== " ") {
    access.syncComponent();
    access.save();
    throw TicTacToeError.make({
      message: `Cell (${r},${c}) is already ${target}. Your cursor is still at (${r},${c}). Move to an empty cell and retry play.`,
    });
  }

  setCell({ board: gameState.board, col: c, mark: gameState.agentMark, row: r });
  gameState.status = checkWin(gameState.board);
  gameState.agentCursorRow = AGENT_CURSOR_HOME_ROW;
  gameState.agentCursorCol = AGENT_CURSOR_HOME_COL;

  if (gameState.status === "playing") {
    gameState.currentTurn = gameState.userMark;
    return `Placed O at (${r},${c}). Cursor reset to (${AGENT_CURSOR_HOME_ROW},${AGENT_CURSOR_HOME_COL}). Your turn, X!`;
  }
  if (gameState.status === "win_O") {
    access.setActive(false);
    access.emitGameOver();
    return `Placed O at (${r},${c}). Player O wins!`;
  }
  if (gameState.status === "draw") {
    access.setActive(false);
    access.emitGameOver();
    return `Placed O at (${r},${c}). It's a draw!`;
  }
  return `Placed O at (${r},${c}).`;
};

const renderMoveResult = (
  result: { content: ReadonlyArray<{ type: string; text?: string }>; details: unknown },
  options: { expanded: boolean },
  theme: codingAgentTypes.Theme,
  context: { isError?: boolean } | undefined,
) => {
  const details = result.details as ticTacToeGameTypes.BoardDetails | undefined;
  const content = result.content[0];
  const message = content?.type === "text" ? (content.text ?? "") : "";
  const prefix =
    context?.isError === true ? theme.fg("error", "\u2717 ") : theme.fg("success", "\u2713 ");
  const summary = prefix + theme.fg("muted", message);

  if (options.expanded && details !== undefined) {
    return new BannerMessageComponent(summary, details, true, theme);
  }
  return new Text(summary, 0, 0);
};

const registerPlayTool = (access: ticTacToeActionsTypes.GameAccess): void => {
  const { msa } = access;
  msa.registerTool({
    description:
      "Execute ONE tic-tac-toe action as Player O. `action` is exactly one of: move_up, move_down, move_left, move_right (move YOUR cursor one cell, clamped at edges), or play (place O under YOUR cursor; errors if the cell is not empty). There is no batched form. To play at (r, c) from your current cursor (r0, c0), emit the required move_down/move_up and move_right/move_left calls, then play, all as separate tool_use blocks in the SAME assistant response. Do not split the sequence across responses and do not wait for a result before emitting the next call. Your cursor position persists between turns and is reset to (0,0) only after a successful play.",
    execute: (_toolCallId, params, _signal, _onUpdate, _ctx) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const actionDelay = ACTION_DELAYS[params.action];
          if (actionDelay > 0) yield* Effect.sleep(actionDelay);

          const result = applyAction({ access, action: params.action });
          access.syncComponent();
          access.save();

          return {
            content: [{ text: result, type: "text" as const }],
            details: access.getState() as unknown as ticTacToeGameTypes.BoardDetails,
          };
        }),
      ),
    executionMode: "sequential" as codingAgentTypes.ToolExecutionMode,
    label: "Tic-Tac-Toe",
    name: "tic_tac_toe",
    parameters: Type.Object({
      action: StringEnum(["move_up", "move_down", "move_left", "move_right", "play"] as const, {
        description:
          "The single action to perform this call. Emit multiple tic_tac_toe calls in one response to string actions together.",
      }),
    }),
    promptGuidelines: [
      "When it is your tic-tac-toe turn, decide the target cell first, then emit every move_* plus the final play as separate tic_tac_toe tool calls in a SINGLE assistant response. Never split them across responses or wait for intermediate results.",
      "Never ask the user for the board. The board and your cursor position are included in the user's move message; use tic_tac_toe_see_board if you need them restated.",
    ],
    promptSnippet: "Play a tic-tac-toe action (move_up/down/left/right or play) as Player O",
    renderCall(args, theme) {
      const action = typeof args.action === "string" ? args.action : "";
      return new Text(
        theme.fg("toolTitle", theme.bold("tic_tac_toe ")) + theme.fg("muted", action),
        0,
        0,
      );
    },
    renderResult: renderMoveResult,
  });
};

const boardText = (state: ticTacToeGameTypes.GameState): string => {
  const boardAscii = boardToAscii({
    agentCursorCol: state.agentCursorCol,
    agentCursorRow: state.agentCursorRow,
    board: state.board,
  });
  return (
    `Board (your cursor marked with <>):\n${boardAscii}\n\n` +
    `Your cursor: (row=${state.agentCursorRow}, col=${state.agentCursorCol})\n` +
    `Status: ${state.status}\n` +
    `Turn: ${state.currentTurn === state.agentMark ? "Player O (you)" : "Player X"}`
  );
};

const renderSeeBoardResult = (
  result: { content: ReadonlyArray<{ type: string; text?: string }>; details: unknown },
  options: { expanded: boolean },
  theme: codingAgentTypes.Theme,
) => {
  const details = result.details as ticTacToeGameTypes.BoardDetails | undefined;
  const summary =
    theme.fg("success", "\u2713 ") +
    theme.fg("muted", `cursor (${details?.agentCursorRow ?? 0},${details?.agentCursorCol ?? 0})`);
  if (options.expanded && details !== undefined) {
    return new BannerMessageComponent(summary, details, true, theme);
  }
  return new Text(summary, 0, 0);
};

const registerSeeBoardTool = (request: {
  readonly access: ticTacToeActionsTypes.GameAccess;
  readonly getBoardDetails: () => ticTacToeGameTypes.BoardDetails;
}): void => {
  const { access, getBoardDetails } = request;

  access.msa.registerTool({
    description:
      "Return the current tic-tac-toe board state and YOUR cursor position (Player O). Takes no arguments. Use this if you need the current state restated mid-turn (for example after a failed play). The user's cursor is never exposed.",
    execute: (_toolCallId, _params, _signal, _onUpdate, _ctx) =>
      Effect.runPromise(
        Effect.sync(() => ({
          content: [{ text: boardText(access.getState()), type: "text" as const }],
          details: getBoardDetails(),
        })),
      ),
    label: "See Board",
    name: "tic_tac_toe_see_board",
    parameters: Type.Object({}),
    promptSnippet: "Inspect the tic-tac-toe board and your cursor",
    renderCall(_args, theme) {
      return new Text(theme.fg("toolTitle", theme.bold("tic_tac_toe_see_board")), 0, 0);
    },
    renderResult: renderSeeBoardResult,
  });
};

const ticTacToeActions = {
  ACTION_DELAYS,
  applyAction,
  registerPlayTool,
  registerSeeBoardTool,
};

export default ticTacToeActions;
