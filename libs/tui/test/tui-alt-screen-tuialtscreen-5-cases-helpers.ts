import assert from "node:assert";
import { it } from "node:test";

import { Effect } from "effect";

import { HStack, Image, ScrollView, Text, TuiAltScreen, VStack } from "../src/index.ts";
import { encodeKitty, registerKittyImageMetadata } from "../src/terminal-image-kitty.ts";
import {
  scrollLineByLine,
  someWriteSince,
  withCapabilities,
  writesSince,
} from "./tui-alt-screen-helpers.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";

function mountImageRow(tui: TuiAltScreen): { label: Text; header: Text } {
  const label = new Text("left", 0, 0);
  const image = new Image(
    "A".repeat(8192),
    "image/png",
    { fallbackColor: (value) => value },
    {},
    { widthPx: 100, heightPx: 100 },
  );
  const header = new Text("header", 0, 0);
  const row = new HStack([
    { component: label, basis: 10 },
    { component: image, basis: 10 },
  ]);
  tui.setLayoutRoot(
    new VStack([
      { component: header, basis: "auto" },
      { component: row, basis: 4 },
    ]),
  );
  return { label, header };
}

export function tuialtscreenCases6(): void {
  it("reuses moved Kitty images without dropping HStack siblings", () =>
    Effect.runPromise(
      withCapabilities(
        { images: "kitty", trueColor: true, hyperlinks: true },
        Effect.gen(function* () {
          const terminal = new RecordingTerminal(20, 6);
          const tui = new TuiAltScreen(terminal);
          const { label, header } = mountImageRow(tui);
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          assert.ok(someWriteSince(terminal, 0, "\x1b_Ga=T"));

          const eventCount = terminal.events.length;
          label.setText("changed");
          header.setText("header\nsecond");
          tui.requestRender();
          yield* Effect.promise(() => terminal.waitForRender());
          const redrawWrites = writesSince(terminal, eventCount);
          const placementIndex = redrawWrites.indexOf("\x1b_Ga=p,q=2");
          assert.ok(redrawWrites.includes("\x1b_Ga=d,d=a,q=2\x1b\\"));
          assert.ok(placementIndex > redrawWrites.indexOf("changed"));
          assert.ok(!redrawWrites.includes("\x1b_Ga=T"));
          assert.ok(
            redrawWrites.length < 2000,
            `expected placement-only redraw, got ${redrawWrites.length} bytes`,
          );
          assert.ok(terminal.getViewport().some((line) => line.trimEnd() === "changed"));
          tui.stop();
        }),
      ),
    ));
}

export function tuialtscreenCases7(): void {
  it("evicts the least recently visible Kitty image when the cache is full", () =>
    Effect.runPromise(
      withCapabilities(
        { images: "kitty", trueColor: true, hyperlinks: true },
        Effect.gen(function* () {
          const terminal = new RecordingTerminal(20, 1);
          const tui = new TuiAltScreen(terminal);
          const firstImageId = 500;
          const imageLines = Array.from({ length: 18 }, (_, index) => {
            const imageId = firstImageId + index;
            registerKittyImageMetadata({
              imageId,
              columns: 2,
              rows: 1,
              widthPx: 100,
              heightPx: 50,
            });
            return encodeKitty("AAAA", { columns: 2, rows: 1, imageId, moveCursor: false });
          });
          tui.setLayoutRoot(
            new ScrollView(
              {
                render: () => imageLines,
                invalidate: () => {},
              },
              { primary: true },
            ),
          );
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          yield* scrollLineByLine(tui, terminal, imageLines.length - 1);
          assert.ok(someWriteSince(terminal, 0, `\x1b_Ga=d,d=I,i=${firstImageId},q=2\x1b\\`));

          const eventCount = terminal.events.length;
          tui.scrollToTop();
          yield* Effect.promise(() => terminal.waitForRender());
          const reentryWrites = writesSince(terminal, eventCount);
          assert.ok(reentryWrites.includes("\x1b_Ga=T"));
          tui.stop();
        }),
      ),
    ));
}
