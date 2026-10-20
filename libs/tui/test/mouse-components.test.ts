import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import tuiModule from "../src/index.ts";
import mouseAwareComponentsCases1 from "./mouse-components-cases-helpers.ts";
import mouseComponentsHelpers from "./mouse-components-helpers.ts";
import InputOverlay from "./mouse-components-input-overlay.ts";
import virtualTerminal from "./virtual-terminal.ts";

const { Input, SelectList, SettingsList, TuiAltScreen } = tuiModule;
const { VirtualTerminal } = virtualTerminal;

const { mouse, selectTheme, settingsTheme } = mouseComponentsHelpers;

describe("mouse-aware components", () => {
  it("positions a single-line input cursor on press", () => {
    const input = new Input();
    input.setValue("hello");
    input.render(20);

    assert.strictEqual(input.handleMouse(mouse("press", 4, 0, 20, 1))?.handled, true);
    input.handleInput("X");
    assert.strictEqual(input.getValue(), "heXllo");
  });

  it("selects and activates list rows", () => {
    const list = new SelectList(
      [
        { label: "A", value: "a" },
        { label: "B", value: "b" },
        { label: "C", value: "c" },
        { label: "D", value: "d" },
        { label: "E", value: "e" },
      ],
      3,
      selectTheme,
    );
    let selected: string | undefined;
    list.onSelect = (item) => {
      selected = item.value;
    };

    assert.strictEqual(list.handleMouse(mouse("press", 1, 2, 40, 3))?.handled, true);
    assert.strictEqual(list.getSelectedItem()?.value, "c");
    assert.strictEqual(list.handleMouse(mouse("click", 1, 2, 40, 3))?.handled, true);
    assert.strictEqual(selected, "c");
  });
});

describe("mouse-aware components", () => {
  it("activates settings rows", () => {
    const changes: Array<{ id: string; value: string }> = [];
    const list = new SettingsList(
      [
        { currentValue: "one", id: "mode", label: "Mode", values: ["one", "two"] },
        { currentValue: "off", id: "other", label: "Other", values: ["off", "on"] },
        { currentValue: "low", id: "third", label: "Third", values: ["low", "high"] },
        { currentValue: "x", id: "fourth", label: "Fourth", values: ["x", "y"] },
      ],
      3,
      settingsTheme,
      (id, value) => changes.push({ id, value }),
      () => {},
    );

    list.handleMouse(mouse("press", 1, 2, 40, 5));
    list.handleMouse(mouse("click", 1, 2, 40, 5));
    assert.deepStrictEqual(changes, [{ id: "third", value: "high" }]);
  });
});

describe("mouse-aware components", () => {
  mouseAwareComponentsCases1();
});

describe("mouse-aware components", () => {
  it("keeps a delegating overlay focused when its nested input is clicked", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 4);
        const tui = new TuiAltScreen(terminal);
        const overlay = new InputOverlay();
        overlay.input.setValue("hi");
        tui.start();
        tui.showOverlay(overlay, { anchor: "top-left", width: 20 });
        yield* Effect.promise(() => terminal.waitForRender());

        terminal.sendInput("\x1b[<0;5;1M");
        terminal.sendInput("\x1b[<0;5;1m");
        terminal.sendInput("!");
        yield* Effect.promise(() => terminal.waitForRender());

        assert.strictEqual(overlay.input.getValue(), "hi!");
        assert.strictEqual(tui.getFocusedComponent(), overlay);
        tui.stop();
      }),
    ));
});
