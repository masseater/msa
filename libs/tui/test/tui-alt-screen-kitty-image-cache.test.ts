import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { overrideEnv } from "../src/env.ts";
import {
  HStack,
  ScrollView,
  Text,
  TuiAltScreen,
  VStack,
  resetCapabilitiesCache,
  setCapabilities,
  Image,
} from "../src/index.ts";
import { encodeKitty, registerKittyImageMetadata } from "../src/terminal-image-kitty.ts";
import {
  someWriteSince,
  writesSince,
  withCapabilities,
  scrollLineByLine,
} from "./tui-alt-screen-helpers.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";

describe("TuiAltScreen", () => {
  redrawsWezTermKittyImagesAfter();
  cases();
  retainsRecentlyOffscreenKittyImages();
  cases2();
  evictsOffscreenKittyImagesDecoded();
});

function redrawsWezTermKittyImagesAfter(): void {
  it("redraws WezTerm Kitty images after writes to covered rows", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        let tui: TuiAltScreen | undefined;
        const restoreEnv = overrideEnv({ WEZTERM_PANE: "1" });
        setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
        yield* Effect.gen(function* () {
          const terminal = new RecordingTerminal(20, 4);
          const imageId = 10319;
          const imageLine = encodeKitty("AAAA", {
            columns: 2,
            rows: 3,
            imageId,
            moveCursor: false,
          });
          registerKittyImageMetadata({ imageId, columns: 2, rows: 3, widthPx: 100, heightPx: 100 });
          let coveredLine = "";
          tui = new TuiAltScreen(terminal);
          tui.setLayoutRoot({
            render: () => [imageLine, coveredLine, "", "after"],
            invalidate: () => {},
          });
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          const eventCount = terminal.events.length;

          coveredLine = "changed";
          tui.requestRender();
          yield* Effect.promise(() => terminal.waitForRender());
          const redrawWrites = writesSince(terminal, eventCount);
          const placementIndex = redrawWrites.indexOf("\x1b_Ga=p,q=2");
          assert.ok(redrawWrites.includes("\x1b_Ga=d,d=a,q=2\x1b\\"));
          assert.ok(placementIndex > redrawWrites.indexOf("changed"));
          assert.ok(!redrawWrites.includes("\x1b_Ga=T"));
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              tui?.stop();
              resetCapabilitiesCache();
              restoreEnv();
            }),
          ),
        );
      }),
    ));
}

function cases(): void {
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

function retainsRecentlyOffscreenKittyImages(): void {
  it("retains recently offscreen Kitty images for placement-only reuse", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
        yield* Effect.gen(function* () {
          const terminal = new RecordingTerminal(20, 1);
          const tui = new TuiAltScreen(terminal);
          const imageId = 321;
          const imageLine = encodeKitty("AAAA", {
            columns: 2,
            rows: 1,
            imageId,
            moveCursor: false,
          });
          registerKittyImageMetadata({ imageId, columns: 2, rows: 1, widthPx: 100, heightPx: 50 });
          tui.setLayoutRoot(
            new ScrollView(
              {
                render: () => [imageLine, "after"],
                invalidate: () => {},
              },
              { primary: true },
            ),
          );
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          assert.ok(someWriteSince(terminal, 0, "\x1b_Ga=T"));

          const eventCount = terminal.events.length;
          tui.scrollBy(1);
          yield* Effect.promise(() => terminal.waitForRender());
          tui.scrollBy(-1);
          yield* Effect.promise(() => terminal.waitForRender());
          const reentryWrites = writesSince(terminal, eventCount);
          assert.ok(reentryWrites.includes("\x1b_Ga=p,q=2"));
          assert.ok(!reentryWrites.includes("\x1b_Ga=T"));
          assert.ok(!reentryWrites.includes(`\x1b_Ga=d,d=I,i=${imageId},q=2\x1b\\`));
          tui.stop();
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              resetCapabilitiesCache();
            }),
          ),
        );
      }),
    ));
}

function cases2(): void {
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

function evictsOffscreenKittyImagesDecoded(): void {
  it("evicts offscreen Kitty images when decoded raster memory exceeds the cache quota", () =>
    Effect.runPromise(
      withCapabilities(
        { images: "kitty", trueColor: true, hyperlinks: true },
        Effect.gen(function* () {
          const terminal = new RecordingTerminal(20, 1);
          const tui = new TuiAltScreen(terminal);
          const firstImageId = 600;
          const imageLines = Array.from({ length: 4 }, (_, index) => {
            const imageId = firstImageId + index;
            registerKittyImageMetadata({
              imageId,
              columns: 2,
              rows: 1,
              widthPx: 3840,
              heightPx: 2160,
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
          tui.stop();
        }),
      ),
    ));
}

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
