import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { type TUI, TuiMainScreen, deleteKittyImage, encodeKitty } from "../src/index.ts";
import { LoggingVirtualTerminal } from "./tui-render-logging-virtual-terminal.ts";
import { TestComponent } from "./tui-render-test-component.ts";

describe("TUI Kitty image cleanup", () => {
  deletesChangedImageIdsBefore();
  redrawsImageLinesEarlierReserved();
  deletesPreviouslyRenderedImageIds();
});

function deletesChangedImageIdsBefore(): void {
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
}

function redrawsImageLinesEarlierReserved(): void {
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
}

function deletesPreviouslyRenderedImageIds(): void {
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
}
