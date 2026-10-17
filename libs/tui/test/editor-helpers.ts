import { Editor } from "../src/components/editor.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export function createTestTUI(cols = 80, rows = 24): TUI {
  return new TuiMainScreen(new VirtualTerminal(cols, rows));
}

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

export function positionCursor(editor: Editor, line: number, col: number): void {
  for (let i = 0; i < 20; i++) editor.handleInput("\x1b[A");
  for (let i = 0; i < line; i++) editor.handleInput("\x1b[B");
  editor.handleInput("\x01");
  for (let i = 0; i < col; i++) editor.handleInput("\x1b[C");
}

export function pasteWithMarker(editor: Editor): string {
  const bigContent = "line\n".repeat(20).trimEnd();
  editor.handleInput(`\x1b[200~${bigContent}\x1b[201~`);
  return editor.getText();
}

export function bigPaste(tag: string): string {
  return Array.from({ length: 12 }, (_, i) => `${tag}${i}`).join("\n");
}

export function typeText(target: { handleInput(data: string): void }, text: string): void {
  for (const char of text) target.handleInput(char);
}
