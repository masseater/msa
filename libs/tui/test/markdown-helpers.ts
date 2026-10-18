import assert from "node:assert";

import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { Chalk } from "chalk";
import { dual } from "effect/Function";

import { stripStyleSequences } from "../src/ansi-sequences.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export const chalk = new Chalk({ level: 3 });

export const getCell: {
  (terminal: VirtualTerminal, row: number, col: number): import("@xterm/headless").IBufferCell;
  (row: number, col: number): (terminal: VirtualTerminal) => import("@xterm/headless").IBufferCell;
} = dual(
  3,
  (terminal: VirtualTerminal, row: number, col: number): import("@xterm/headless").IBufferCell => {
    const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
    const buffer = xterm.buffer.active;
    const line = buffer.getLine(buffer.viewportY + row);
    assert.ok(line, `Missing buffer line at row ${row}`);
    const cell = line.getCell(col);
    assert.ok(cell, `Missing cell at row ${row} col ${col}`);
    return cell;
  },
);

export function stripAnsi(line: string): string {
  return stripStyleSequences(line);
}
