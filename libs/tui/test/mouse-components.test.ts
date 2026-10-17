import assert from "node:assert";
import { describe, it } from "node:test";

import { Input } from "../src/components/input.ts";
import { SelectList } from "../src/components/select-list.ts";
import { SettingsList } from "../src/components/settings-list.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { mouseAwareComponentsCases1 } from "./mouse-components-cases-helpers.ts";
import { mouse, selectTheme, settingsTheme } from "./mouse-components-helpers.ts";
import { InputOverlay } from "./mouse-components-input-overlay.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

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
        { value: "a", label: "A" },
        { value: "b", label: "B" },
        { value: "c", label: "C" },
        { value: "d", label: "D" },
        { value: "e", label: "E" },
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
        { id: "mode", label: "Mode", currentValue: "one", values: ["one", "two"] },
        { id: "other", label: "Other", currentValue: "off", values: ["off", "on"] },
        { id: "third", label: "Third", currentValue: "low", values: ["low", "high"] },
        { id: "fourth", label: "Fourth", currentValue: "x", values: ["x", "y"] },
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
  it("keeps a delegating overlay focused when its nested input is clicked", async () => {
    const terminal = new VirtualTerminal(20, 4);
    const tui = new TuiAltScreen(terminal);
    const overlay = new InputOverlay();
    overlay.input.setValue("hi");
    tui.start();
    tui.showOverlay(overlay, { anchor: "top-left", width: 20 });
    await terminal.waitForRender();

    terminal.sendInput("\x1b[<0;5;1M");
    terminal.sendInput("\x1b[<0;5;1m");
    terminal.sendInput("!");
    await terminal.waitForRender();

    assert.strictEqual(overlay.input.getValue(), "hi!");
    assert.strictEqual(tui.getFocusedComponent(), overlay);
    tui.stop();
  });
});
