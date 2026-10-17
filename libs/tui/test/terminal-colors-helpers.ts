import { type TUI, TuiMainScreen } from "../src/index.ts";
import { InputRecorder } from "./terminal-colors-input-recorder.ts";
import { TestTerminal } from "./terminal-colors-test-terminal.ts";

export const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

export const PALETTE_REPLIES = Array.from(
  { length: 16 },
  (_, index) => `\x1b]4;${index};#000000\x07`,
);

export const DA1 = "\x1b[?62;22c";

export const BLACK = { r: 0, g: 0, b: 0 };

export const WHITE = { r: 255, g: 255, b: 255 };

export function setup(): { terminal: TestTerminal; tui: TUI; component: InputRecorder } {
  const terminal = new TestTerminal();
  const tui: TUI = new TuiMainScreen(terminal);
  const component = new InputRecorder();
  tui.addChild(component);
  tui.setFocus(component);
  tui.start();
  return { terminal, tui, component };
}
