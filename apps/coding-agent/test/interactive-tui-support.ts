import type { Terminal } from "@msa/tui";

import { VirtualTerminal } from "../../../libs/tui/test/virtual-terminal.ts";

class RecordingTerminal extends VirtualTerminal implements Terminal {
  readonly writes: string[] = [];
  startCount = 0;
  stopCount = 0;

  override start(onInput: (data: string) => void, onResize: () => void): void {
    this.startCount += 1;
    super.start(onInput, onResize);
  }

  override write(data: string): void {
    this.writes.push(data);
    super.write(data);
  }

  override stop(): void {
    this.stopCount += 1;
    super.stop();
  }
}

const interactiveTuiSupport = {
  RecordingTerminal,
};

export default interactiveTuiSupport;
