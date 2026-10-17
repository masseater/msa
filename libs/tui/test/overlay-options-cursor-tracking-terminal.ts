import { VirtualTerminal } from "./virtual-terminal.ts";

export class CursorTrackingTerminal extends VirtualTerminal {
  cursorVisible = true;

  override hideCursor(): void {
    this.cursorVisible = false;
    super.hideCursor();
  }

  override showCursor(): void {
    this.cursorVisible = true;
    super.showCursor();
  }
}
