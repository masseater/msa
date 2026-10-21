import { Effect } from "effect";

import tuiModule from "../src/index.ts";
import type tuiTypes from "../src/index.types.ts";
import InputRecorder from "./terminal-colors-input-recorder.ts";
import TestTerminal from "./terminal-colors-test-terminal.ts";

const { TuiMainScreen } = tuiModule;

const wait = (ms: number): Effect.Effect<void> => Effect.sleep(ms);

const PALETTE_REPLIES = Array.from({ length: 16 }, (_, index) => `\x1b]4;${index};#000000\x07`);

const DA1 = "\x1b[?62;22c";

const BLACK = { b: 0, g: 0, r: 0 };

const WHITE = { b: 255, g: 255, r: 255 };

function setup(): { terminal: TestTerminal; tui: tuiTypes.TUI; component: InputRecorder } {
  const terminal = new TestTerminal();
  const tui: tuiTypes.TUI = new TuiMainScreen(terminal);
  const component = new InputRecorder();
  tui.addChild(component);
  tui.setFocus(component);
  tui.start();
  return { component, terminal, tui };
}

const terminalColorsHelpers = {
  BLACK,
  DA1,
  PALETTE_REPLIES,
  WHITE,
  setup,
  wait,
};

export default terminalColorsHelpers;
