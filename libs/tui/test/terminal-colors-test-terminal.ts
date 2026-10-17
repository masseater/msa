import { type Terminal } from "../src/index.ts";

export class TestTerminal implements Terminal {
  private inputHandler?: ((data: string) => void) | undefined;
  private resizeHandler?: (() => void) | undefined;
  private readonly columnCount: number;
  private readonly rowCount: number;
  readonly writes: string[] = [];

  constructor(columnCount = 80, rowCount = 24) {
    this.columnCount = columnCount;
    this.rowCount = rowCount;
  }

  start(onInput: (data: string) => void, onResize: () => void): void {
    this.inputHandler = onInput;
    this.resizeHandler = onResize;
  }

  stop(): void {
    this.inputHandler = undefined;
    this.resizeHandler = undefined;
  }

  async drainInput(_maxMs?: number, _idleMs?: number): Promise<void> {}

  write(data: string): void {
    this.writes.push(data);
  }

  get columns(): number {
    return this.columnCount;
  }

  get rows(): number {
    return this.rowCount;
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

  sendInput(data: string): void {
    this.inputHandler?.(data);
  }

  sendResize(): void {
    this.resizeHandler?.();
  }
}
