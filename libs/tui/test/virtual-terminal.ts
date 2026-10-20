import type { Terminal as XtermTerminalType } from "@xterm/headless";
import xterm from "@xterm/headless";
import { Effect } from "effect";

import type terminalProtocolTypes from "../src/terminal-protocol.types.ts";
import effectHelpers from "./effect-helpers.ts";

const { nextTick } = effectHelpers;

const XtermTerminal = xterm.Terminal;

export default class VirtualTerminal implements terminalProtocolTypes.Terminal {
  private xterm: XtermTerminalType;
  private inputHandler?: ((data: string) => void) | undefined;
  private resizeHandler?: (() => void) | undefined;
  private columnCount: number;
  private rowCount: number;

  constructor(columns = 80, rows = 24) {
    this.columnCount = columns;
    this.rowCount = rows;

    this.xterm = new XtermTerminal({
      allowProposedApi: true,
      cols: columns,
      disableStdin: true,
      rows: rows,
    });
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;
    this.xterm.write("\x1b[?2004h");
  }

  drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {
    return Promise.resolve();
  }

  stop(): void {
    this.xterm.write("\x1b[?2004l");
    this.inputHandler = undefined;
    this.resizeHandler = undefined;
  }

  write(data: string): void {
    this.xterm.write(data);
  }

  get columns(): number {
    return this.columnCount;
  }

  get rows(): number {
    return this.rowCount;
  }

  get kittyProtocolActive(): boolean {
    return true;
  }

  moveBy(lines: number): void {
    if (lines > 0) {
      this.xterm.write(`\x1b[${lines}B`);
    } else if (lines < 0) {
      this.xterm.write(`\x1b[${-lines}A`);
    }
  }

  hideCursor(): void {
    this.xterm.write("\x1b[?25l");
  }

  showCursor(): void {
    this.xterm.write("\x1b[?25h");
  }

  clearLine(): void {
    this.xterm.write("\x1b[K");
  }

  clearFromCursor(): void {
    this.xterm.write("\x1b[J");
  }

  clearScreen(): void {
    this.xterm.write("\x1b[2J\x1b[H");
  }

  setTitle(title: string): void {
    this.xterm.write(`\x1b]0;${title}\x07`);
  }

  setProgress(_active: boolean): void {}
  setProgramStatus(): void {}

  sendInput(data: string): void {
    if (this.inputHandler !== undefined) {
      this.inputHandler(data);
    }
  }

  resize(columns: number, rows: number): void {
    this.columnCount = columns;
    this.rowCount = rows;
    this.xterm.resize(columns, rows);
    if (this.resizeHandler !== undefined) {
      this.resizeHandler();
    }
  }

  flush(): Promise<void> {
    return Effect.runPromise(this.flushEffect());
  }

  flushAndGetViewport(): Promise<string[]> {
    return Effect.runPromise(this.flushEffect().pipe(Effect.map(() => this.getViewport())));
  }

  private flushEffect(): Effect.Effect<void> {
    return Effect.callback<void>((resume) => {
      this.xterm.write("", () => resume(Effect.void));
    });
  }

  getViewport(): string[] {
    const lines: string[] = [];
    const buffer = this.xterm.buffer.active;

    for (let i = 0; i < this.xterm.rows; i++) {
      const line = buffer.getLine(buffer.viewportY + i);
      if (line === undefined) {
        lines.push("");
      } else {
        lines.push(line.translateToString(true));
      }
    }

    return lines;
  }

  getScrollBuffer(): string[] {
    const lines: string[] = [];
    const buffer = this.xterm.buffer.active;

    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line === undefined) {
        lines.push("");
      } else {
        lines.push(line.translateToString(true));
      }
    }

    return lines;
  }

  clear(): void {
    this.xterm.clear();
  }

  reset(): void {
    this.xterm.reset();
  }

  getCursorPosition(): { x: number; y: number } {
    const buffer = this.xterm.buffer.active;
    return {
      x: buffer.cursorX,
      y: buffer.cursorY,
    };
  }

  waitForRender(): Promise<void> {
    return Effect.runPromise(
      nextTick.pipe(Effect.andThen(Effect.sleep(20)), Effect.andThen(this.flushEffect())),
    );
  }
}
