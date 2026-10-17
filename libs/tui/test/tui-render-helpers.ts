import assert from "node:assert";

import type { Terminal as XtermTerminalType } from "@xterm/headless";

import { VirtualTerminal } from "./virtual-terminal.ts";

export const MAX_RENDER_WRITE_CHARS = 1024 * 1024;

export async function withEnv<T>(
  updates: Record<string, string | undefined>,
  run: () => Promise<T>,
): Promise<T> {
  const previousValues = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previousValues.set(key, process.env[key]);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  try {
    return await run();
  } finally {
    for (const [key, value] of previousValues) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

export function getCellItalic(terminal: VirtualTerminal, row: number, col: number): number {
  const xterm = (terminal as unknown as { xterm: XtermTerminalType }).xterm;
  const buffer = xterm.buffer.active;
  const line = buffer.getLine(buffer.viewportY + row);
  assert.ok(line, `Missing buffer line at row ${row}`);
  const cell = line.getCell(col);
  assert.ok(cell, `Missing cell at row ${row} col ${col}`);
  return cell.isItalic();
}

/**
 * Set each environment variable to `value`, returning a function that restores the previous state.
 *
 * @param {readonly string[]} names - Variable names.
 * @param {string} value - The value to set.
 * @returns {() => void} Restores the previous values.
 */
export function overrideEnv(names: readonly string[], value: string): () => void {
  const previousValues = names.map((name) => [name, process.env[name]] as const);
  for (const name of names) {
    process.env[name] = value;
  }
  return () => {
    for (const [name, previousValue] of previousValues) {
      if (previousValue === undefined) delete process.env[name];
      else process.env[name] = previousValue;
    }
  };
}
