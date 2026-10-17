import assert from "node:assert";
import { describe, it } from "node:test";

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
  it("reserves Kitty image rows before drawing during full redraw fallbacks", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const terminal = new LoggingVirtualTerminal(40, 5);
      const tui: TUI = new TuiMainScreen(terminal);
      const component = new TestComponent();
      tui.addChild(component);

      component.lines = ["l0", "l1", "l2", "l3", "l4"];
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
      const imageLines = image.render(40);
      const imageSequence = imageLines[0];
      assert.ok(imageSequence !== undefined);
      component.lines = ["l0", "l1", "l2", "l3", "l4", ...imageLines, "after"];
      tui.requestRender();
      await terminal.waitForRender();

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
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });
}

describe("TUI Kitty image cleanup", () => {
  it("does not use cursor-up placement for Kitty images taller than the viewport", async () => {
    setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
    setCellDimensions({ widthPx: 10, heightPx: 10 });
    try {
      const terminal = new LoggingVirtualTerminal(40, 5);
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
        { maxWidthCells: 6 },
        { widthPx: 60, heightPx: 60 },
      );
      const imageLines = image.render(40);
      const imageSequence = imageLines[0];
      assert.ok(imageSequence !== undefined);
      assert.ok(imageLines.length > terminal.rows, "test image should exceed the viewport height");

      component.lines = ["before", ...imageLines, "after"];
      tui.requestRender(true);
      await terminal.waitForRender();

      const writes = terminal.getWrites();
      assert.ok(writes.includes(imageSequence), "image placement should be drawn");
      assert.ok(
        !writes.includes(`\x1b[${imageLines.length - 1}A${imageSequence}`),
        "taller-than-viewport images must keep the #4461 first-row placement path",
      );

      tui.stop();
    } finally {
      resetCapabilitiesCache();
      setCellDimensions({ widthPx: 9, heightPx: 18 });
    }
  });
});

describe("TUI Kitty image cleanup", () => {
  it("deletes changed image ids before drawing moved placements", async () => {
    const terminal = new LoggingVirtualTerminal(40, 10);
    const tui: TUI = new TuiMainScreen(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    const oldImage = encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 42, moveCursor: false });
    component.lines = ["top", oldImage];
    tui.start();
    await terminal.waitForRender();
    terminal.clearWrites();

    const newImage = encodeKitty("BBBB", { columns: 2, rows: 1, imageId: 42, moveCursor: false });
    component.lines = [newImage, ""];
    tui.requestRender();
    await terminal.waitForRender();

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
  });
});

describe("TUI Kitty image cleanup", () => {
  it("redraws image lines when an earlier reserved image row changes", async () => {
    const terminal = new LoggingVirtualTerminal(40, 10);
    const tui: TUI = new TuiMainScreen(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    const image = encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 88, moveCursor: false });
    component.lines = ["", image];
    tui.start();
    await terminal.waitForRender();
    terminal.clearWrites();

    component.lines = ["covered", image];
    tui.requestRender();
    await terminal.waitForRender();

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
    assert.ok(!writes.includes("\x1b[2J"), "reserved row changes should not force a full redraw");

    tui.stop();
  });
});

describe("TUI Kitty image cleanup", () => {
  it("deletes previously rendered image ids during full redraws", async () => {
    const terminal = new LoggingVirtualTerminal(40, 10);
    const tui: TUI = new TuiMainScreen(terminal);
    const component = new TestComponent();
    tui.addChild(component);

    component.lines = [
      encodeKitty("AAAA", { columns: 2, rows: 2, imageId: 77, moveCursor: false }),
    ];
    tui.start();
    await terminal.waitForRender();
    terminal.clearWrites();

    component.lines = ["plain text"];
    tui.requestRender(true);
    await terminal.waitForRender();

    const writes = terminal.getWrites();
    const deleteIndex = writes.indexOf(deleteKittyImage(77));
    const clearIndex = writes.indexOf("\x1b[2J");
    assert.ok(deleteIndex >= 0, "previous image should be deleted during full redraw");
    assert.ok(clearIndex >= 0, "full redraw should clear the screen");
    assert.ok(deleteIndex < clearIndex, "old image should be deleted before the screen is cleared");

    tui.stop();
  });
});

describe("TUI resize handling", () => {
  it("triggers full re-render when terminal height changes", async () => {
    await withEnv({ TERMUX_VERSION: undefined }, async () => {
      const terminal = new VirtualTerminal(40, 10);
      const tui: TUI = new TuiMainScreen(terminal);
      const component = new TestComponent();
      tui.addChild(component);

      component.lines = ["Line 0", "Line 1", "Line 2"];
      tui.start();
      await terminal.waitForRender();

      const initialRedraws = tui.fullRedraws;

      // Resize height
      terminal.resize(40, 15);
      await terminal.waitForRender();

      // Should have triggered a full redraw
      assert.ok(tui.fullRedraws > initialRedraws, "Height change should trigger full redraw");

      const viewport = terminal.getViewport();
      assert.ok(viewport[0]?.includes("Line 0"), "Content preserved after height change");

      tui.stop();
    });
  });
});
