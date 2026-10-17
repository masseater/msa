import assert from "node:assert";

import type { Terminal as XtermTerminalType } from "@xterm/headless";

import type { TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export function getCellItalic(terminal: VirtualTerminal, row: number, col: number): number {
  const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
  const buffer = xterm.buffer.active;
  const line = buffer.getLine(buffer.viewportY + row);
  assert.ok(line, `Missing buffer line at row ${row}`);
  const cell = line.getCell(col);
  assert.ok(cell, `Missing cell at row ${row} col ${col}`);
  return cell.isItalic();
}

export async function renderAndFlush(tui: TUI, terminal: VirtualTerminal): Promise<void> {
  tui.requestRender(true);
  await new Promise<void>((resolve) => {
    process.nextTick(resolve);
  });
  await terminal.waitForRender();
}
