import { VirtualTerminal } from "./virtual-terminal.ts";

class LoggingVirtualTerminal extends VirtualTerminal {
  private writes: string[] = [];

  override write(data: string): void {
    this.writes.push(data);
    super.write(data);
  }

  getWrites(): string {
    return this.writes.join("");
  }

  clearWrites(): void {
    this.writes = [];
  }
}

export default LoggingVirtualTerminal;
