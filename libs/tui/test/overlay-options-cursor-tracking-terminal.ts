import virtualTerminal from "./virtual-terminal.ts";

const { VirtualTerminal } = virtualTerminal;

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
