import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import type tuiTypes from "../src/index.types.ts";
import BoundedWriteTerminal from "./tui-render-bounded-write-terminal.ts";
import tuiRenderHelpers from "./tui-render-helpers.ts";
import InputComponent from "./tui-render-input-component.ts";
import tuiRenderKit from "./tui-render-kit.ts";
import TestComponent from "./tui-render-test-component.ts";
import virtualTerminal from "./virtual-terminal.ts";

const { effectHelpers, src: tuiModule } = tuiRenderKit;

const { VirtualTerminal } = virtualTerminal;
const { TuiMainScreen } = tuiModule;
const { nextTick } = effectHelpers;

const { MAX_RENDER_WRITE_CHARS } = tuiRenderHelpers;

describe("TUI render scheduling", () => {
  it("renders keyboard input without waiting for a throttled frame", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(40, 10);
        const tui: tuiTypes.TUI = new TuiMainScreen(terminal);
        const component = new InputComponent();
        component.lines = ["initial"];
        tui.addChild(component);
        tui.setFocus(component);
        tui.start();
        tui.renderNow();
        const renderCountBeforeInput = component.renderCount;

        component.lines = ["pending"];
        tui.requestRender();
        terminal.sendInput("first");
        terminal.sendInput("second");
        terminal.sendInput("typed");
        yield* nextTick;

        assert.strictEqual(component.renderCount, renderCountBeforeInput + 1);
        assert.deepStrictEqual(component.lines, ["typed"]);
        tui.stop();
      }),
    ));
});

describe("TUI bounded render output", () => {
  it("splits a large full render without changing its output", () => {
    const terminal = new BoundedWriteTerminal();
    const tui = new TuiMainScreen(terminal);
    const component = new TestComponent();
    const kittyLine = `\x1b_Ga=T,f=100;${"A".repeat(1_200_000)}\x1b\\`;
    component.lines = [kittyLine, kittyLine];
    tui.addChild(component);

    tui.renderNow();

    assert.ok(terminal.writes.length > 2, "large output should be split across terminal writes");
    assert.ok(
      terminal.writes.every((write) => write.length <= MAX_RENDER_WRITE_CHARS),
      "each terminal write should stay below the configured limit",
    );
    assert.strictEqual(
      terminal.writes.join(""),
      `\x1b[?2026h${kittyLine}\r\n${kittyLine}\x1b[?2026l`,
      "chunking must preserve the synchronized render output",
    );
  });
});

describe("TUI bounded render output", () => {
  it("splits large differential updates without a full redraw", () => {
    const terminal = new BoundedWriteTerminal();
    const tui = new TuiMainScreen(terminal);
    const component = new TestComponent();
    tui.addChild(component);
    component.lines = ["before"];
    tui.renderNow();
    terminal.writes.length = 0;

    const kittyLine = `\x1b_Ga=T,f=100;${"A".repeat(1_200_000)}\x1b\\`;
    component.lines = ["before", kittyLine, kittyLine];
    tui.renderNow();

    assert.ok(terminal.writes.length > 2, "large output should be split across terminal writes");
    assert.ok(terminal.writes.every((write) => write.length <= MAX_RENDER_WRITE_CHARS));
    const output = terminal.writes.join("");
    assert.ok(output.startsWith("\x1b[?2026h"));
    assert.ok(output.endsWith("\x1b[?2026l"));
    assert.ok(
      !output.includes("\x1b[2J"),
      "the update should stay on the differential render path",
    );
  });
});
