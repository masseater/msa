import assert from "node:assert";

import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type tuiInterfaceTypes from "../src/tui-interface.types.ts";
import effectHelpers from "./effect-helpers.ts";
import type virtualTerminalTypes from "./virtual-terminal.types.ts";

const { nextTick } = effectHelpers;

const getCellItalic: {
  (terminal: virtualTerminalTypes.VirtualTerminal, row: number, col: number): number;
  (row: number, col: number): (terminal: virtualTerminalTypes.VirtualTerminal) => number;
} = dual(3, (terminal: virtualTerminalTypes.VirtualTerminal, row: number, col: number): number => {
  const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
  const buffer = xterm.buffer.active;
  const line = buffer.getLine(buffer.viewportY + row);
  assert.ok(line, `Missing buffer line at row ${row}`);
  const cell = line.getCell(col);
  assert.ok(cell, `Missing cell at row ${row} col ${col}`);
  return cell.isItalic();
});

const renderAndFlush: {
  (tui: tuiInterfaceTypes.TUI, terminal: virtualTerminalTypes.VirtualTerminal): Effect.Effect<void>;
  (
    terminal: virtualTerminalTypes.VirtualTerminal,
  ): (tui: tuiInterfaceTypes.TUI) => Effect.Effect<void>;
} = dual(
  2,
  (
    tui: tuiInterfaceTypes.TUI,
    terminal: virtualTerminalTypes.VirtualTerminal,
  ): Effect.Effect<void> =>
    Effect.sync(() => {
      tui.requestRender(true);
    }).pipe(
      Effect.andThen(nextTick),
      Effect.andThen(Effect.promise(() => terminal.waitForRender())),
    ),
);

const tuiOverlayStyleLeakHelpers = {
  getCellItalic,
  renderAndFlush,
};

export default tuiOverlayStyleLeakHelpers;
