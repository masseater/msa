import { VirtualTerminal } from "./virtual-terminal.ts";

class RecordingTerminal extends VirtualTerminal {
  readonly events: Array<{ type: "write"; data: string } | { type: "start" } | { type: "stop" }> =
    [];

  override start(onInput: (data: string) => void, onResize: () => void): void {
    this.events.push({ type: "start" });
    super.start(onInput, onResize);
  }

  override write(data: string): void {
    this.events.push({ data, type: "write" });
    super.write(data);
  }

  override stop(): void {
    this.events.push({ type: "stop" });
    super.stop();
  }
}

export default RecordingTerminal;
