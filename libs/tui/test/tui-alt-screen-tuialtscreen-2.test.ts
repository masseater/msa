import assert from "node:assert";
import { describe, it } from "node:test";

import { MouseRegion } from "../src/components/mouse-region.ts";
import { ScrollView } from "../src/components/scroll-view.ts";
import { Text } from "../src/components/text.ts";
import { VStack } from "../src/components/v-stack.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
  it("jumps to a scrollbar track position and continues dragging from there", async () => {
    const terminal = new RecordingTerminal(10, 10);
    const tui = new TuiAltScreen(terminal);
    const scrollView = new ScrollView(
      new Text(Array.from({ length: 50 }, (_, index) => `line ${index + 1}`).join("\n"), 0, 0),
      { primary: true, scrollbar: "always" },
    );
    tui.setLayoutRoot(scrollView);
    tui.start();
    await terminal.waitForRender();
    assert.strictEqual(scrollView.scrollTop, 0);

    terminal.sendInput("\x1b[<0;10;6M");
    await terminal.waitForRender();
    assert.strictEqual(scrollView.scrollTop, 20);

    terminal.sendInput("\x1b[<32;10;10M");
    await terminal.waitForRender();
    assert.strictEqual(scrollView.scrollTop, 40);

    terminal.sendInput("\x1b[<0;10;10m");
    await terminal.waitForRender();
    assert.ok(
      terminal.events.every(
        (event) => event.type !== "write" || !event.data.includes("\x1b]52;c;"),
      ),
    );
    tui.stop();
  });
});

describe("TuiAltScreen", () => {
  // #9758: wheel line counts can change at runtime; Alt keeps its multiplier.
  it("applies runtime wheel line count updates", async () => {
    const terminal = new VirtualTerminal(20, 4);
    const tui = new TuiAltScreen(terminal, undefined, undefined, { wheelScrollLines: 3 });
    const deltas: Array<number | undefined> = [];
    tui.addChild(
      new MouseRegion(new Text("wheel target", 0, 0), (event) => {
        if (event.type !== "wheel") return undefined;
        deltas.push(event.wheelDelta);
        return { handled: true };
      }),
    );
    tui.start();
    try {
      await terminal.waitForRender();
      terminal.sendInput("\x1b[<64;1;1M");
      tui.setWheelScrollLines(2);
      terminal.sendInput("\x1b[<65;1;1M");
      terminal.sendInput("\x1b[<72;1;1M");
      assert.deepStrictEqual(deltas, [-3, 2, -10]);
    } finally {
      tui.stop();
    }
  });
});

describe("TuiAltScreen", () => {
  it("chains unused wheel delta to an outer scroll view", async () => {
    const terminal = new VirtualTerminal(20, 4);
    const tui = new TuiAltScreen(terminal, undefined, undefined, { wheelScrollLines: 3 });
    const inner = new ScrollView(new Text("i1\ni2\ni3\ni4\ni5\ni6", 0, 0));
    const outer = new ScrollView(
      new VStack([
        { component: inner, basis: 2 },
        new Text("tail1\ntail2\ntail3\ntail4\ntail5", 0, 0),
      ]),
      { primary: true },
    );
    tui.setLayoutRoot(outer);
    tui.start();
    await terminal.waitForRender();

    terminal.sendInput("\x1b[<65;1;1M");
    await terminal.waitForRender();
    assert.strictEqual(inner.scrollTop, 3);
    assert.strictEqual(outer.scrollTop, 0);

    terminal.sendInput("\x1b[<65;1;1M");
    await terminal.waitForRender();
    assert.strictEqual(inner.scrollTop, 4);
    assert.strictEqual(outer.scrollTop, 2);
    tui.stop();
  });
});
