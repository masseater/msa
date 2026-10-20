import { Effect } from "effect";

import type terminalProtocolTypes from "../src/terminal-protocol.types.ts";

const COLUMNS = 100;
const ROWS = 30;

class NullTerminal implements terminalProtocolTypes.Terminal {
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

const renderChurnNullTerminal = {
  COLUMNS,
  NullTerminal,
  ROWS,
};

export default renderChurnNullTerminal;
