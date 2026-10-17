import assert from "node:assert";
import { describe, it } from "node:test";

import { TuiMainScreen } from "../src/tui-main-screen.ts";
import type { TUI } from "../src/tui.ts";
import { SimpleContent } from "./overlay-short-content-simple-content.ts";
import { SimpleOverlay } from "./overlay-short-content-simple-overlay.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI overlay with short content", () => {
  it("should render overlay when content is shorter than terminal height", async () => {
    const terminal = new VirtualTerminal(80, 24);
    const tui: TUI = new TuiMainScreen(terminal);

    tui.addChild(new SimpleContent(["Line 1", "Line 2", "Line 3"]));

    const overlay = new SimpleOverlay();
    tui.showOverlay(overlay);

    tui.start();
    await terminal.waitForRender();

    const viewport = terminal.getViewport();
    const hasOverlay = viewport.some((line) => line.includes("OVERLAY"));

    console.log("Terminal rows:", terminal.rows);
    console.log("Content lines: 3");
    console.log("Overlay visible:", hasOverlay);

    if (!hasOverlay) {
      console.log("\nViewport contents:");
      for (let i = 0; i < viewport.length; i++) {
        console.log(`  [${i}]: "${viewport[i]}"`);
      }
    }

    assert.ok(hasOverlay, "Overlay should be visible when content is shorter than terminal");

    tui.stop();
  });
});
