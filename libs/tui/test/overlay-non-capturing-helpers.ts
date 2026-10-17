import { type TUI } from "../src/tui.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export async function renderAndFlush(tui: TUI, terminal: VirtualTerminal): Promise<void> {
  tui.requestRender(true);
  await new Promise<void>((resolve) => {
    process.nextTick(resolve);
  });
  await terminal.waitForRender();
}
