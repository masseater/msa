import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

export const OSC133_ZONE_START = "\x1b]133;A\x07";

export async function scrollLineByLine(
  tui: TuiAltScreen,
  terminal: VirtualTerminal,
  steps: number,
): Promise<void> {
  if (steps <= 0) return;
  tui.scrollBy(1);
  await terminal.waitForRender();
  await scrollLineByLine(tui, terminal, steps - 1);
}
