import assert from "node:assert";
import { describe, it } from "node:test";

import env from "../src/env.ts";
import terminalCapabilities from "../src/terminal-capabilities.ts";
import type tuiComponentTypes from "../src/tui-component.types.ts";
import type tuiInterfaceTypes from "../src/tui-interface.types.ts";
import TuiMainScreen from "../src/tui-main-screen.ts";
import VirtualTerminal from "./virtual-terminal.ts";

const { overrideEnv } = env;
const { getCellDimensions, resetCapabilitiesCache, setCellDimensions } = terminalCapabilities;

class InputRecorder implements tuiComponentTypes.Component {
  readonly inputs: string[] = [];

  render(): string[] {
    return [""];
  }

  handleInput(data: string): void {
    this.inputs.push(data);
  }

  invalidate(): void {}
}

function withImageTerminal<T>(fn: () => T): T {
  const restoreEnv = overrideEnv({
    GHOSTTY_RESOURCES_DIR: undefined,
    TERM: undefined,
    TERM_PROGRAM: "ghostty",
  });
  resetCapabilitiesCache();

  try {
    return fn();
  } finally {
    restoreEnv();
    resetCapabilitiesCache();
  }
}

describe("TUI cell size responses", () => {
  it("forwards bare escape even when a cell size query was sent at startup", () => {
    withImageTerminal(() => {
      const terminal = new VirtualTerminal(80, 24);
      const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);
      const recorder = new InputRecorder();

      tui.setFocus(recorder);
      tui.start();

      terminal.sendInput("\x1b");

      assert.deepStrictEqual(recorder.inputs, ["\x1b"]);
      tui.stop();
    });
  });

  it("consumes cell size responses and still forwards later user input", () => {
    withImageTerminal(() => {
      setCellDimensions({ heightPx: 18, widthPx: 9 });

      const terminal = new VirtualTerminal(80, 24);
      const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);
      const recorder = new InputRecorder();

      tui.setFocus(recorder);
      tui.start();

      terminal.sendInput("\x1b[6;20;10t");
      assert.deepStrictEqual(recorder.inputs, []);
      assert.deepStrictEqual(getCellDimensions(), { heightPx: 20, widthPx: 10 });

      terminal.sendInput("q");
      assert.deepStrictEqual(recorder.inputs, ["q"]);
      tui.stop();
    });
  });
});
