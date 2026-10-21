import assert from "node:assert";

import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { Chalk } from "chalk";
import { dual } from "effect/Function";

import ansiSequences from "../src/ansi-sequences.ts";
import type virtualTerminalTypes from "./virtual-terminal.types.ts";

const { stripStyleSequences } = ansiSequences;

const chalk = new Chalk({ level: 3 });

const getCell: {
  (
    terminal: virtualTerminalTypes.VirtualTerminal,
    row: number,
    col: number,
  ): import("@xterm/headless").IBufferCell;
  (
    row: number,
    col: number,
  ): (terminal: virtualTerminalTypes.VirtualTerminal) => import("@xterm/headless").IBufferCell;
} = dual(
  3,
  (
    terminal: virtualTerminalTypes.VirtualTerminal,
    row: number,
    col: number,
  ): import("@xterm/headless").IBufferCell => {
    const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
    const buffer = xterm.buffer.active;
    const line = buffer.getLine(buffer.viewportY + row);
    assert.ok(line, `Missing buffer line at row ${row}`);
    const cell = line.getCell(col);
    assert.ok(cell, `Missing cell at row ${row} col ${col}`);
    return cell;
  },
);

function stripAnsi(line: string): string {
  return stripStyleSequences(line);
}

const markdownHelpers = {
  chalk,
  getCell,
  stripAnsi,
};

export default markdownHelpers;
