import assert from "node:assert";
import { it } from "node:test";

import { Effect } from "effect";

import { Image } from "../src/components/image.ts";
import {
  resetCapabilitiesCache,
  setCapabilities,
  setCellDimensions,
} from "../src/terminal-image.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { LoggingVirtualTerminal } from "./tui-render-logging-virtual-terminal.ts";
import { TestComponent } from "./tui-render-test-component.ts";

export function tuiKittyImageCleanupCases1(): void {
  it("clears reserved Kitty image rows before drawing appended image placements", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
        setCellDimensions({ widthPx: 10, heightPx: 10 });
        yield* Effect.gen(function* () {
          const terminal = new LoggingVirtualTerminal(40, 10);
          const tui: TUI = new TuiMainScreen(terminal);
          const component = new TestComponent();
          tui.addChild(component);

          component.lines = ["before"];
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
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
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              resetCapabilitiesCache();
              setCellDimensions({ widthPx: 9, heightPx: 18 });
            }),
          ),
        );
      }),
    ));
}
