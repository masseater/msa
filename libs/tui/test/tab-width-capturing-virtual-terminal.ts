import { VirtualTerminal } from "./virtual-terminal.ts";

class CapturingVirtualTerminal extends VirtualTerminal {
  private output = "";

  override write(data: string): void {
    this.output += data;
    super.write(data);
  }

  getOutput(): string {
    return this.output;
  }
}

export default CapturingVirtualTerminal;
