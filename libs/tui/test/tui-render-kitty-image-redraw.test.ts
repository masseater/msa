import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Image, type TUI, TuiMainScreen } from "../src/index.ts";
import { withEnv } from "./tui-render-helpers.ts";
import { withKittyCells, renderKittyTestImage } from "./tui-render-kitty-helpers.ts";
import { LoggingVirtualTerminal } from "./tui-render-logging-virtual-terminal.ts";
import { TestComponent } from "./tui-render-test-component.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI Kitty image cleanup", () => {
  cases();
  fallsBackFullRedrawKitty();
  reservesKittyImageRowsBefore();
  doesNotUseCursorUp();
});
describe("TUI resize handling", () => {
  triggersFullReRenderTerminal();
});

function cases(): void {
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

function fallsBackFullRedrawKitty(): void {
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
}

function reservesKittyImageRowsBefore(): void {
  it("reserves Kitty image rows before drawing during full redraw fallbacks", () =>
    Effect.runPromise(
      withKittyCells(
        Effect.gen(function* () {
          const terminal = new LoggingVirtualTerminal(40, 5);
          const tui: TUI = new TuiMainScreen(terminal);
          const component = new TestComponent();
          tui.addChild(component);

          component.lines = ["l0", "l1", "l2", "l3", "l4"];
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          const redrawsBeforeImage = tui.fullRedraws;
          terminal.clearWrites();

          const { imageLines, imageSequence } = renderKittyTestImage(3);
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
        }),
      ),
    ));
}

function doesNotUseCursorUp(): void {
  it("does not use cursor-up placement for Kitty images taller than the viewport", () =>
    Effect.runPromise(
      withKittyCells(
        Effect.gen(function* () {
          const terminal = new LoggingVirtualTerminal(40, 5);
          const tui: TUI = new TuiMainScreen(terminal);
          const component = new TestComponent();
          tui.addChild(component);

          component.lines = ["before"];
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          terminal.clearWrites();

          const { imageLines, imageSequence } = renderKittyTestImage(6);
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
        }),
      ),
    ));
}

function triggersFullReRenderTerminal(): void {
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
}
