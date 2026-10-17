import assert from "node:assert";

import type { Terminal as XtermTerminalType } from "@xterm/headless";
import { Chalk } from "chalk";

import { VirtualTerminal } from "./virtual-terminal.ts";

export const chalk = new Chalk({ level: 3 });

export function getCell(terminal: VirtualTerminal, row: number, col: number) {
  const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
  const buffer = xterm.buffer.active;
  const line = buffer.getLine(buffer.viewportY + row);
  assert.ok(line, `Missing buffer line at row ${row}`);
  const cell = line.getCell(col);
  assert.ok(cell, `Missing cell at row ${row} col ${col}`);
  return cell;
}

export function stripAnsi(line: string): string {
  return line.replace(/\x1b\[[0-9;]*m/gu, "");
}
