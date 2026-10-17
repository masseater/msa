import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Image, type TUI, TuiMainScreen } from "../src/index.ts";
import { tuiKittyImageCleanupCases1 } from "./tui-render-cases-helpers.ts";
import { withKittyCells } from "./tui-render-kitty-helpers.ts";
import { LoggingVirtualTerminal } from "./tui-render-logging-virtual-terminal.ts";
import { TestComponent } from "./tui-render-test-component.ts";

describe("TUI Kitty image cleanup", () => {
  tuiKittyImageCleanupCases1();
});

describe("TUI Kitty image cleanup", () => {
  it("falls back to full redraw when Kitty image pre-clear would scroll", () =>
    Effect.runPromise(
      withKittyCells(
        Effect.gen(function* () {
          const terminal = new LoggingVirtualTerminal(40, 2);
          const tui: TUI = new TuiMainScreen(terminal);
          const component = new TestComponent();
          tui.addChild(component);

          component.lines = ["before"];
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
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
          yield* Effect.promise(() => terminal.waitForRender());

          assert.ok(
            tui.fullRedraws > redrawsBeforeImage,
            "unsafe image pre-clear should force a full redraw",
          );
          assert.ok(
            terminal.getWrites().includes("\x1b[2J"),
            "fallback should clear and fully redraw",
          );

          tui.stop();
        }),
      ),
    ));
});
