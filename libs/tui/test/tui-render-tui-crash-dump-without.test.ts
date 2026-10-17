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
import { tuiKittyImageCleanupCases1 } from "./tui-render-cases-helpers.ts";
import { overrideEnv } from "./tui-render-helpers.ts";
import { LoggingVirtualTerminal } from "./tui-render-logging-virtual-terminal.ts";
import { TestComponent } from "./tui-render-test-component.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI crash dump without configured log directory", () => {
  it("writes the crash dump to the OS temp directory instead of a home-directory default", async () => {
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
