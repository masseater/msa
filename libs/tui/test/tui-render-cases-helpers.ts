import assert from "node:assert";
import { it } from "node:test";

import { Effect } from "effect";

import { type TUI } from "../src/tui-interface.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { withKittyCells, renderKittyTestImage } from "./tui-render-kitty-helpers.ts";
import { LoggingVirtualTerminal } from "./tui-render-logging-virtual-terminal.ts";
import { TestComponent } from "./tui-render-test-component.ts";

export function tuiKittyImageCleanupCases1(): void {
  it("clears reserved Kitty image rows before drawing appended image placements", () =>
    Effect.runPromise(
      withKittyCells(
        Effect.gen(function* () {
          const terminal = new LoggingVirtualTerminal(40, 10);
          const tui: TUI = new TuiMainScreen(terminal);
          const component = new TestComponent();
          tui.addChild(component);

          component.lines = ["before"];
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          terminal.clearWrites();

          const { imageLines, imageSequence } = renderKittyTestImage(2);
          component.lines = ["before", ...imageLines, "after"];
          tui.requestRender();
          yield* Effect.promise(() => terminal.waitForRender());

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
        }),
      ),
    ));
}
