import assert from "node:assert";

import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { Effect } from "effect";
import { dual } from "effect/Function";

import env from "../src/env.ts";
import type virtualTerminalTypes from "./virtual-terminal.types.ts";

const { overrideEnv } = env;

const MAX_RENDER_WRITE_CHARS = 1024 * 1024;

const withEnv: {
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

const tuiRenderHelpers = {
  MAX_RENDER_WRITE_CHARS,
  getCellItalic,
  withEnv,
};

export default tuiRenderHelpers;
