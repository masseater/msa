import assert from "node:assert";
import { describe, it } from "node:test";

import { Console, Effect } from "effect";

import type tuiInterfaceTypes from "../src/tui-interface.types.ts";
import TuiMainScreen from "../src/tui-main-screen.ts";
import SimpleContent from "./overlay-short-content-simple-content.ts";
import SimpleOverlay from "./overlay-short-content-simple-overlay.ts";
import VirtualTerminal from "./virtual-terminal.ts";
describe("TUI overlay with short content", () => {
  it("should render overlay when content is shorter than terminal height", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(80, 24);
        const tui: tuiInterfaceTypes.TUI = new TuiMainScreen(terminal);

        tui.addChild(new SimpleContent(["Line 1", "Line 2", "Line 3"]));

        const overlay = new SimpleOverlay();
        tui.showOverlay(overlay);

        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        const viewport = terminal.getViewport();
        const hasOverlay = viewport.some((line) => line.includes("OVERLAY"));

        yield* Console.log("Terminal rows:", terminal.rows);
        yield* Console.log("Content lines: 3");
        yield* Console.log("Overlay visible:", hasOverlay);

        if (!hasOverlay) {
          yield* Console.log("\nViewport contents:");
          for (let i = 0; i < viewport.length; i++) {
            yield* Console.log(`  [${i}]: "${viewport[i]}"`);
          }
        }

        assert.ok(hasOverlay, "Overlay should be visible when content is shorter than terminal");

        tui.stop();
      }),
    ));
});
