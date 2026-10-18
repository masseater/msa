import assert from "node:assert";

import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { Effect } from "effect";
import { dual } from "effect/Function";

import type { TUI } from "../src/tui-interface.ts";
import { nextTick } from "./effect-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export const getCellItalic: {
  (terminal: VirtualTerminal, row: number, col: number): number;
  (row: number, col: number): (terminal: VirtualTerminal) => number;
} = dual(3, (terminal: VirtualTerminal, row: number, col: number): number => {
  const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
  const buffer = xterm.buffer.active;
  const line = buffer.getLine(buffer.viewportY + row);
  assert.ok(line, `Missing buffer line at row ${row}`);
  const cell = line.getCell(col);
  assert.ok(cell, `Missing cell at row ${row} col ${col}`);
  return cell.isItalic();
});

export const renderAndFlush: {
  (tui: TUI, terminal: VirtualTerminal): Effect.Effect<void>;
  (terminal: VirtualTerminal): (tui: TUI) => Effect.Effect<void>;
} = dual(2, (tui: TUI, terminal: VirtualTerminal): Effect.Effect<void> =>
  Effect.sync(() => {
    tui.requestRender(true);
  }).pipe(Effect.andThen(nextTick), Effect.andThen(Effect.promise(() => terminal.waitForRender()))),
);
