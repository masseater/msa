import assert from "node:assert";

import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { Effect } from "effect";
import { dual } from "effect/Function";

import { overrideEnv } from "../src/env.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export const MAX_RENDER_WRITE_CHARS = 1024 * 1024;

export const withEnv: {
  <A, E, R>(
    updates: Readonly<Record<string, string | undefined>>,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R>;
  <A, E, R>(
    effect: Effect.Effect<A, E, R>,
  ): (updates: Readonly<Record<string, string | undefined>>) => Effect.Effect<A, E, R>;
} = dual(
  2,
  <A, E, R>(
    updates: Readonly<Record<string, string | undefined>>,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E, R> =>
    Effect.acquireUseRelease(
      Effect.sync(() => overrideEnv(updates)),
      () => effect,
      (restore) => Effect.sync(restore),
    ),
);

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
