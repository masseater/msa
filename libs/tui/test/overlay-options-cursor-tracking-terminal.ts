import VirtualTerminal from "./virtual-terminal.ts";

class CursorTrackingTerminal extends VirtualTerminal {
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

export default CursorTrackingTerminal;
