import { Effect } from "effect";

import type { Terminal } from "../src/terminal.ts";

export const COLUMNS = 100;
export const ROWS = 30;

export class NullTerminal implements Terminal {
  bytesWritten = 0;
  start(_onInput: (data: string) => void, _onResize: () => void): void {}
  stop(): void {}
  drainInput(): Promise<void> {
    return Effect.runPromise(Effect.sync(() => {}));
  }
  write(data: string): void {
    this.bytesWritten += data.length;
  }
  get columns(): number {
    return COLUMNS;
  }
  get rows(): number {
    return ROWS;
  }
  get kittyProtocolActive(): boolean {
    return false;
  }
  moveBy(_lines: number): void {}
  hideCursor(): void {}
  showCursor(): void {}
  clearLine(): void {}
  clearFromCursor(): void {}
  clearScreen(): void {}
  setTitle(_title: string): void {}
  setProgress(_active: boolean): void {}
  setProgramStatus(): void {}
}
