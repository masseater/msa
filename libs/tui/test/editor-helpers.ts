import { Editor } from "../src/components/editor.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export function createTestTUI(cols = 80, rows = 24): TUI {
  return new TuiMainScreen(new VirtualTerminal(cols, rows));
}

/**
 * Standard applyCompletion that replaces prefix with item.value
 *
 * @param {string[]} lines - Editor lines.
 * @param {number} cursorLine - Cursor line.
 * @param {number} cursorCol - Cursor column.
 * @param {{ value: string }} item - The selected item.
 * @param {string} prefix - The typed prefix.
 * @returns {{ lines: string[]; cursorLine: number; cursorCol: number }} The lines and cursor after completion.
 */
export function applyCompletion(
  lines: string[],
  cursorLine: number,
  cursorCol: number,
  item: { value: string },
  prefix: string,
): { lines: string[]; cursorLine: number; cursorCol: number } {
  const line = lines[cursorLine] || "";
  const before = line.slice(0, cursorCol - prefix.length);
  const after = line.slice(cursorCol);
  const newLines = [...lines];
  newLines[cursorLine] = before + item.value + after;
  return {
    lines: newLines,
    cursorLine,
    cursorCol: cursorCol - prefix.length + item.value.length,
  };
}

export async function flushAutocomplete(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => {
    setImmediate(resolve);
  });
}

// Helper: position cursor at a specific line and column
export function positionCursor(editor: Editor, line: number, col: number): void {
  // Go to line 0 first
  for (let i = 0; i < 20; i++) editor.handleInput("\x1b[A");
  // Go to target line
  for (let i = 0; i < line; i++) editor.handleInput("\x1b[B");
  // Go to target col
  // Ctrl+A
  editor.handleInput("\x01");
  for (let i = 0; i < col; i++) editor.handleInput("\x1b[C");
}

/**
 * Helper: simulate a large paste that creates a marker
 *
 * @param {Editor} editor - The editor to paste into.
 * @returns {string} The marker text.
 */
export function pasteWithMarker(editor: Editor): string {
  // 20 lines
  const bigContent = "line\n".repeat(20).trimEnd();
  editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
  // The editor replaces large pastes with a marker like "[paste #1 +20 lines]"
  return editor.getText();
}

/**
 * Helper: 12-line paste content with a distinguishing tag
 *
 * @param {string} tag - Text that tells the pastes apart.
 * @returns {string} The paste content.
 */
export function bigPaste(tag: string): string {
  return Array.from({ length: 12 }, (_, i) => `${tag}${i}`).join("\n");
}
