import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Image } from "../src/components/image.ts";
import {
  deleteKittyImage,
  encodeKitty,
  resetCapabilitiesCache,
  setCapabilities,
  setCellDimensions,
} from "../src/terminal-image.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { withEnv } from "./tui-render-helpers.ts";
import { LoggingVirtualTerminal } from "./tui-render-logging-virtual-terminal.ts";
import { TestComponent } from "./tui-render-test-component.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI Kitty image cleanup", () => {
  tuiKittyImageCleanupCases2();
});

function tuiKittyImageCleanupCases2(): void {
  it("reserves Kitty image rows before drawing during full redraw fallbacks", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
        setCellDimensions({ widthPx: 10, heightPx: 10 });
        yield* Effect.gen(function* () {
          const terminal = new LoggingVirtualTerminal(40, 5);
          const tui: TUI = new TuiMainScreen(terminal);
          const component = new TestComponent();
          tui.addChild(component);

          component.lines = ["l0", "l1", "l2", "l3", "l4"];
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
          const imageLines = image.render(40);
          const imageSequence = imageLines[0];
          assert.ok(imageSequence !== undefined);
          component.lines = ["l0", "l1", "l2", "l3", "l4", ...imageLines, "after"];
          tui.requestRender();
          yield* Effect.promise(() => terminal.waitForRender());

          const writes = terminal.getWrites();
          assert.ok(
            tui.fullRedraws > redrawsBeforeImage,
            "scrolling image append should force a full redraw",
          );
          assert.ok(
            writes.includes(`\r\n\r\n\x1b[2A${imageSequence}\x1b[2B`),
            "full redraw should reserve visible image rows before drawing the placement",
          );
          assert.ok(
            !writes.includes(`${imageSequence}\r\n\x1b[0m`),
            "full redraw must not write reserved padding rows after drawing the placement",
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

describe("TUI Kitty image cleanup", () => {
  it("does not use cursor-up placement for Kitty images taller than the viewport", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
        setCellDimensions({ widthPx: 10, heightPx: 10 });
        yield* Effect.gen(function* () {
          const terminal = new LoggingVirtualTerminal(40, 5);
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
            { maxWidthCells: 6 },
            { widthPx: 60, heightPx: 60 },
          );
          const imageLines = image.render(40);
          const imageSequence = imageLines[0];
          assert.ok(imageSequence !== undefined);
          assert.ok(
            imageLines.length > terminal.rows,
            "test image should exceed the viewport height",
          );

          component.lines = ["before", ...imageLines, "after"];
          tui.requestRender(true);
          yield* Effect.promise(() => terminal.waitForRender());

          const writes = terminal.getWrites();
          assert.ok(writes.includes(imageSequence), "image placement should be drawn");
          assert.ok(
            !writes.includes(`\x1b[${imageLines.length - 1}A${imageSequence}`),
            "taller-than-viewport images must keep the #4461 first-row placement path",
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
});

describe("TUI Kitty image cleanup", () => {
  it("deletes changed image ids before drawing moved placements", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new LoggingVirtualTerminal(40, 10);
        const tui: TUI = new TuiMainScreen(terminal);
        const component = new TestComponent();
        tui.addChild(component);

        const oldImage = encodeKitty("AAAA", {
          columns: 2,
          rows: 2,
          imageId: 42,
          moveCursor: false,
        });
        component.lines = ["top", oldImage];
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        terminal.clearWrites();

        const newImage = encodeKitty("BBBB", {
          columns: 2,
          rows: 1,
          imageId: 42,
          moveCursor: false,
        });
        component.lines = [newImage, ""];
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        const writes = terminal.getWrites();
        const deleteIndex = writes.indexOf(deleteKittyImage(42));
        const drawIndex = writes.indexOf(newImage);
        assert.ok(deleteIndex >= 0, "changed old image should be deleted");
        assert.ok(drawIndex >= 0, "new image should be drawn");
        assert.ok(
          deleteIndex < drawIndex,
          "old image must be deleted before the new placement is drawn",
        );

        tui.stop();
      }),
    ));
});

describe("TUI Kitty image cleanup", () => {
  it("redraws image lines when an earlier reserved image row changes", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new LoggingVirtualTerminal(40, 10);
        const tui: TUI = new TuiMainScreen(terminal);
        const component = new TestComponent();
        tui.addChild(component);

        const image = encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 88, moveCursor: false });
        component.lines = ["", image];
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        terminal.clearWrites();

        component.lines = ["covered", image];
        tui.requestRender();
        yield* Effect.promise(() => terminal.waitForRender());

        const writes = terminal.getWrites();
        const deleteIndex = writes.indexOf(deleteKittyImage(88));
        const drawIndex = writes.indexOf(image);
        assert.ok(deleteIndex >= 0, "image should be deleted when a reserved row changes");
        assert.ok(
          drawIndex >= 0,
          "unchanged image line should be redrawn after deleting the placement",
        );
        assert.ok(
          deleteIndex < drawIndex,
          "old placement must be deleted before the image line is redrawn",
        );
        assert.ok(
          !writes.includes("\x1b[2J"),
          "reserved row changes should not force a full redraw",
        );

        tui.stop();
      }),
    ));
});

describe("TUI Kitty image cleanup", () => {
  it("deletes previously rendered image ids during full redraws", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new LoggingVirtualTerminal(40, 10);
        const tui: TUI = new TuiMainScreen(terminal);
        const component = new TestComponent();
        tui.addChild(component);

        component.lines = [
          encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 77, moveCursor: false }),
        ];
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        terminal.clearWrites();

        component.lines = ["plain text"];
        tui.requestRender(true);
        yield* Effect.promise(() => terminal.waitForRender());

        const writes = terminal.getWrites();
        const deleteIndex = writes.indexOf(deleteKittyImage(77));
        const clearIndex = writes.indexOf("\x1b[2J");
        assert.ok(deleteIndex >= 0, "previous image should be deleted during full redraw");
        assert.ok(clearIndex >= 0, "full redraw should clear the screen");
        assert.ok(
          deleteIndex < clearIndex,
          "old image should be deleted before the screen is cleared",
        );

        tui.stop();
      }),
    ));
});

describe("TUI resize handling", () => {
  it("triggers full re-render when terminal height changes", () =>
    Effect.runPromise(
      withEnv(
        { TERMUX_VERSION: undefined },
        Effect.gen(function* () {
          const terminal = new VirtualTerminal(40, 10);
          const tui: TUI = new TuiMainScreen(terminal);
          const component = new TestComponent();
          tui.addChild(component);

          component.lines = ["Line 0", "Line 1", "Line 2"];
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());

          const initialRedraws = tui.fullRedraws;

          terminal.resize(40, 15);
          yield* Effect.promise(() => terminal.waitForRender());

          assert.ok(tui.fullRedraws > initialRedraws, "Height change should trigger full redraw");

          const viewport = terminal.getViewport();
          assert.ok(viewport[0]?.includes("Line 0"), "Content preserved after height change");

          tui.stop();
        }),
      ),
    ));
});
