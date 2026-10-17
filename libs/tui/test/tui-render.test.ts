import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { BoundedWriteTerminal } from "./tui-render-bounded-write-terminal.ts";
import { MAX_RENDER_WRITE_CHARS, withEnv } from "./tui-render-helpers.ts";
import { InputComponent } from "./tui-render-input-component.ts";
import { TestComponent } from "./tui-render-test-component.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI render scheduling", () => {
  it("renders keyboard input without waiting for a throttled frame", async () => {
    const terminal = new VirtualTerminal(40, 10);
    const tui: TUI = new TuiMainScreen(terminal);
    const component = new InputComponent();
    component.lines = ["initial"];
    tui.addChild(component);
    tui.setFocus(component);
    tui.start();
    tui.renderNow();
    const renderCountBeforeInput = component.renderCount;

    // Queue a normal throttled render first. Keyboard input should preempt it.
    component.lines = ["pending"];
    tui.requestRender();
    terminal.sendInput("first");
    terminal.sendInput("second");
    terminal.sendInput("typed");
    await new Promise<void>((resolve) => {
      process.nextTick(resolve);
    });

    assert.strictEqual(component.renderCount, renderCountBeforeInput + 1);
    assert.deepStrictEqual(component.lines, ["typed"]);
    tui.stop();
  });
});

describe("TUI debug logging", () => {
  it("writes redraw logs to the provided directory", async () => {
    const logDir = mkdtempSync(join(tmpdir(), "msa-tui-log-"));
    try {
      await withEnv({ MSA_TUI_DEBUG_REDRAW: "1" }, async () => {
        const terminal = new VirtualTerminal(40, 10);
        const tui: TUI = new TuiMainScreen(terminal, undefined, logDir);
        const component = new TestComponent();
        tui.addChild(component);
        component.lines = ["test"];
        tui.start();
        await terminal.waitForRender();

        assert.match(
          readFileSync(join(logDir, "msa-tui-debug.log"), "utf-8"),
          /fullRender: first render/u,
        );
        tui.stop();
      });
    } finally {
      rmSync(logDir, { recursive: true, force: true });
    }
  });
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
