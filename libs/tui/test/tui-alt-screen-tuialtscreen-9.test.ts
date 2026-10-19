import assert from "node:assert";
import { describe, it } from "node:test";

import { MouseRegion } from "../src/components/mouse-region.ts";
import { Text } from "../src/components/text.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { type TuiMouseEvent } from "../src/tui.ts";
import { InputOverlay } from "./tui-alt-screen-input-overlay.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
  it("focuses and captures drag gestures for mouse-aware components", async () => {
    const terminal = new VirtualTerminal(20, 2);
    const tui = new TuiAltScreen(terminal);
    const events: string[] = [];
    const component = {
      render: () => ["control"],
      invalidate: () => {},
      handleMouse: (event: TuiMouseEvent) => {
        events.push(event.type);
        return event.type === "press"
          ? { handled: true, capture: true, focus: true }
          : { handled: true };
      },
    };
    tui.addChild(component);
    tui.start();
    await terminal.waitForRender();

    terminal.sendInput("\x1b[<0;1;1M");
    terminal.sendInput("\x1b[<32;5;2M");
    terminal.sendInput("\x1b[<0;5;2m");
    await terminal.waitForRender();

    assert.deepStrictEqual(events, ["press", "drag", "release"]);
    assert.strictEqual(tui.getFocusedComponent(), component);
    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("reports consecutive click counts to component-owned controls", async () => {
    const terminal = new VirtualTerminal(20, 1);
    const tui = new TuiAltScreen(terminal);
    const clickCounts: number[] = [];
    tui.addChild({
      render: () => ["control"],
      invalidate: () => {},
      handleMouse: (event) => {
        if (event.type === "press") return { handled: true };
        if (event.type === "click") {
          clickCounts.push(event.clickCount ?? 0);
          return { handled: true };
        }
        return undefined;
      },
    });
    tui.start();
    await terminal.waitForRender();

    for (let count = 0; count < 3; count++) {
      terminal.sendInput("\x1b[<0;1;1M");
      terminal.sendInput("\x1b[<0;1;1m");
    }
    await terminal.waitForRender();
    assert.deepStrictEqual(clickCounts, [1, 2, 3]);
    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("does not rerender for handled no-op pointer motion", async () => {
    const terminal = new RecordingTerminal(20, 2);
    const tui = new TuiAltScreen(terminal);
    let renderCount = 0;
    tui.addChild({
      render: () => {
        renderCount += 1;
        return ["hover target"];
      },
      invalidate: () => {},
      handleMouse: (event) => (event.type === "move" ? { handled: true } : undefined),
    });
    tui.start();
    await terminal.waitForRender();
    const renderedBeforeMotion = renderCount;
    const writesBeforeMotion = terminal.events.filter((event) => event.type === "write").length;

    terminal.sendInput("\x1b[<35;1;1M");
    await terminal.waitForRender();
    assert.strictEqual(renderCount, renderedBeforeMotion);
    assert.strictEqual(
      terminal.events.filter((event) => event.type === "write").length,
      writesBeforeMotion,
    );
    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("lets mouse-aware components consume wheel events before viewport scrolling", async () => {
    const terminal = new VirtualTerminal(20, 3);
    const tui = new TuiAltScreen(terminal);
    let wheelEvents = 0;
    tui.addChild(
      new MouseRegion(
        new Text(Array.from({ length: 8 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
        (event) => {
          if (event.type !== "wheel") return undefined;
          wheelEvents += 1;
          return { handled: true };
        },
      ),
    );
    tui.start();
    await terminal.waitForRender();
    const viewportTop = tui.viewportTop;

    terminal.sendInput("\x1b[<64;1;1M");
    await terminal.waitForRender();
    assert.strictEqual(wheelEvents, 1);
    assert.strictEqual(tui.viewportTop, viewportTop);
    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("restores keyboard state before leaving alt mode and prints the full document", async () => {
    const terminal = new RecordingTerminal(20, 3);
    const tui = new TuiAltScreen(terminal);
    tui.addChild(new Text("first\nsecond\nthird\nfourth\nfifth\nsixth", 0, 0));
    tui.start();
    await terminal.waitForRender();
    tui.stop();

    const startIndex = terminal.events.findIndex((event) => event.type === "start");
    const altScreenEnterIndex = terminal.events.findIndex(
      (event) => event.type === "write" && event.data.includes("\x1b[?1049h"),
    );
    const stopIndex = terminal.events.findIndex((event) => event.type === "stop");
    const mouseDisableIndex = terminal.events.findIndex(
      (event) => event.type === "write" && event.data.includes("\x1b[?1006l"),
    );
    const mainScreenRestoreIndex = terminal.events.findIndex(
      (event) => event.type === "write" && event.data.includes("\x1b[?1049l"),
    );
    assert.ok(altScreenEnterIndex >= 0 && altScreenEnterIndex < startIndex);
    assert.ok(mouseDisableIndex >= 0 && mouseDisableIndex < stopIndex);
    assert.ok(mainScreenRestoreIndex > stopIndex);

    const restoreEvent = terminal.events[mainScreenRestoreIndex];
    assert.strictEqual(restoreEvent?.type, "write");
    if (restoreEvent?.type === "write") {
      assert.ok(restoreEvent.data.includes("first"));
      assert.ok(restoreEvent.data.includes("second"));
      assert.ok(restoreEvent.data.includes("third"));
      assert.ok(restoreEvent.data.includes("fourth"));
      assert.ok(restoreEvent.data.includes("fifth"));
      assert.ok(restoreEvent.data.includes("sixth"));
      assert.ok(restoreEvent.data.indexOf("first") < restoreEvent.data.indexOf("sixth"));
    }
  });
});

describe("TuiAltScreen", () => {
  it("gives viewport keys to a focused overlay", async () => {
    const terminal = new VirtualTerminal(20, 6);
    const tui = new TuiAltScreen(terminal);
    tui.addChild(
      new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
    );
    const overlay = new InputOverlay();
    tui.start();
    await terminal.waitForRender();
    const topBefore = tui.viewportTop;
    const handle = tui.showOverlay(overlay);
    await terminal.waitForRender();
    assert.strictEqual(overlay.focused, true);

    const keys = ["\x1b[5~", "\x1b[6~", "\x1bOH", "\x1bOF"];
    for (const key of keys) terminal.sendInput(key);
    await terminal.waitForRender();

    assert.deepStrictEqual(overlay.inputs, keys);
    assert.strictEqual(tui.viewportTop, topBefore);

    handle.hide();
    await terminal.waitForRender();
    terminal.sendInput("\x1b[5~");
    await terminal.waitForRender();
    assert.ok(tui.viewportTop < topBefore);
    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("keeps viewport scrolling when an overlay is not focused", async () => {
    const terminal = new VirtualTerminal(20, 6);
    const tui = new TuiAltScreen(terminal);
    const editor = new InputOverlay();
    tui.addChild(
      new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
    );
    tui.setFocus(editor);
    tui.start();
    await terminal.waitForRender();
    const topBefore = tui.viewportTop;

    const hidden = tui.showOverlay(new InputOverlay());
    hidden.setHidden(true);
    const nonCapturing = new InputOverlay();
    tui.showOverlay(nonCapturing, { nonCapturing: true });
    const unfocused = new InputOverlay();
    const unfocusedHandle = tui.showOverlay(unfocused);
    unfocusedHandle.unfocus();
    await terminal.waitForRender();
    assert.strictEqual(nonCapturing.focused, false);
    assert.strictEqual(unfocused.focused, false);

    terminal.sendInput("\x1b[5~");
    terminal.sendInput("\x1b[<64;10;3M");
    await terminal.waitForRender();
    assert.ok(tui.viewportTop < topBefore);
    assert.deepStrictEqual(nonCapturing.inputs, []);
    assert.deepStrictEqual(unfocused.inputs, []);
    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  it("keeps viewport scrolling while transcript search is focused", async () => {
    const terminal = new VirtualTerminal(20, 6);
    const tui = new TuiAltScreen(terminal);
    tui.addChild(
      new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
    );
    tui.start();
    await terminal.waitForRender();
    const topBefore = tui.viewportTop;

    terminal.sendInput("\x1b[102;6u");
    await terminal.waitForRender();
    assert.ok(terminal.getViewport().some((line) => line.includes("↑ ↓")));

    terminal.sendInput("\x1b[5~");
    terminal.sendInput("\x1b[<64;1;4M");
    await terminal.waitForRender();
    assert.ok(tui.viewportTop < topBefore);
    assert.ok(terminal.getViewport().some((line) => line.includes("↑ ↓")));
    tui.stop();
  });

  it("gives viewport keys to a focused component that claims them", async () => {
    const terminal = new VirtualTerminal(20, 6);
    const tui = new TuiAltScreen(terminal);
    tui.addChild(
      new Text(Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
    );
    const view = new InputOverlay();
    view.wantsViewportKeys = true;
    tui.setFocus(view);
    tui.start();
    await terminal.waitForRender();
    const topBefore = tui.viewportTop;

    const keys = ["\x1b[5~", "\x1b[6~", "\x1b[1;5A"];
    for (const key of keys) terminal.sendInput(key);
    await terminal.waitForRender();

    assert.deepStrictEqual(view.inputs, keys);
    assert.strictEqual(tui.viewportTop, topBefore);
    tui.stop();
  });
});
