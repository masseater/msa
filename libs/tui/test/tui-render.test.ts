import assert from "node:assert";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";

import { Image } from "../src/components/image.ts";
import {
  resetCapabilitiesCache,
  setCapabilities,
  setCellDimensions,
} from "../src/terminal-image.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { BoundedWriteTerminal } from "./tui-render-bounded-write-terminal.ts";
import { MAX_RENDER_WRITE_CHARS, overrideEnv, withEnv } from "./tui-render-helpers.ts";
import { InputComponent } from "./tui-render-input-component.ts";
import { LoggingVirtualTerminal } from "./tui-render-logging-virtual-terminal.ts";
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

describe("TUI crash dump without configured log directory", () => {
  it("writes the crash dump to the OS temp directory instead of a home-directory default", async () => {
    // The TUI falls back to os.tmpdir() when no log directory is configured, so
    // isolate the test by pointing the temp directory at a fresh directory rather
    // than sharing the real one with concurrent test runs. os.tmpdir() reads
    // TMPDIR on POSIX and TEMP/TMP on Windows, so override all three.
    const crashDir = mkdtempSync(join(tmpdir(), "msa-tui-crash-"));
    const crashLogPath = join(crashDir, "msa-tui-crash.log");
    const restoreTmpdirEnv = overrideEnv(["TMPDIR", "TEMP", "TMP"], crashDir);
    try {
      const terminal = new VirtualTerminal(40, 10);
      const tui: TUI = new TuiMainScreen(terminal);
      const component = new TestComponent();
      tui.addChild(component);
      component.lines = ["ok"];
      tui.start();
      await terminal.waitForRender();

      // Width overflow is detected in the differential render path
      component.lines = ["ok", "x".repeat(60)];
      assert.throws(
        () => tui.renderNow(),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.ok(
            error.message.includes(crashLogPath),
            `error message should reference ${crashLogPath}`,
          );
          return true;
        },
      );
      assert.match(readFileSync(crashLogPath, "utf-8"), /Terminal width: 40/u);
    } finally {
      restoreTmpdirEnv();
      rmSync(crashDir, { recursive: true, force: true });
    }
  });
});

describe("TUI Kitty image cleanup", () => {
  tuiKittyImageCleanupCases1();
});

function tuiKittyImageCleanupCases1(): void {
  it("clears reserved Kitty image rows before drawing appended image placements", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const terminal = new LoggingVirtualTerminal(40, 10);
      const tui: TUI = new TuiMainScreen(terminal);
      const component = new TestComponent();
      tui.addChild(component);

      component.lines = ["before"];
      tui.start();
      await terminal.waitForRender();
      terminal.clearWrites();

      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { maxWidthCells: 2 },
        { widthPx: 20, heightPx: 20 },
      );
      const imageLines = image.render(40);
      const imageSequence = imageLines[0];
      assert.ok(imageSequence !== undefined);
      component.lines = ["before", ...imageLines, "after"];
      tui.requestRender();
      await terminal.waitForRender();

      const writes = terminal.getWrites();
      assert.ok(
        writes.includes(`\x1b[2K\r\n\x1b[2K\x1b[1A${imageSequence}\x1b[1B`),
        "reserved rows should be cleared before the image placement is drawn",
      );
      assert.ok(
        !writes.includes(`${imageSequence}\r\n\x1b[2K`),
        "reserved row clears must not run after the image placement is drawn",
      );

      tui.stop();
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });
}

describe("TUI Kitty image cleanup", () => {
  it("falls back to full redraw when Kitty image pre-clear would scroll", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const terminal = new LoggingVirtualTerminal(40, 2);
      const tui: TUI = new TuiMainScreen(terminal);
      const component = new TestComponent();
      tui.addChild(component);

      component.lines = ["before"];
      tui.start();
      await terminal.waitForRender();
      const redrawsBeforeImage = tui.fullRedraws;
      terminal.clearWrites();

      const image = new Image(
        "AAAA",
        "image/png",
        { fallbackColor: (value) => value },
        { maxWidthCells: 3 },
        { widthPx: 30, heightPx: 30 },
      );
      component.lines = ["before", ...image.render(40), "after"];
      tui.requestRender();
      await terminal.waitForRender();

      assert.ok(
        tui.fullRedraws > redrawsBeforeImage,
        "unsafe image pre-clear should force a full redraw",
      );
      assert.ok(terminal.getWrites().includes("\x1b[2J"), "fallback should clear and fully redraw");

      tui.stop();
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });
});
