import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { TuiAltScreen, Image } from "../src/index.ts";
import { encodeKitty, registerKittyImageMetadata } from "../src/terminal-image-kitty.ts";
import { someWriteSince, withCapabilities } from "./tui-alt-screen-helpers.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";

describe("TuiAltScreen", () => {
  doesNotEmitKittyGraphics();
  clearsStaleITerm2ImagePlacements();
  cropsKittyImageWhoseFirst();
});

function doesNotEmitKittyGraphics(): void {
  it("does not emit Kitty graphics commands or OSC 133 zones in iTerm2", () =>
    Effect.runPromise(
      withCapabilities(
        { images: "iterm2", trueColor: true, hyperlinks: true },
        Effect.gen(function* () {
          const terminal = new RecordingTerminal(20, 3);
          const tui = new TuiAltScreen(terminal);
          tui.addChild({
            render: () => ["\x1b]133;B\x07\x1b]133;C\x07\x1b]133;A\x07content"],
            invalidate: () => {},
          });
          tui.addChild(
            new Image(
              "AAAA",
              "image/png",
              { fallbackColor: (value) => value },
              { filename: "example.png" },
              { widthPx: 10, heightPx: 10 },
            ),
          );
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          tui.stop();
          assert.ok(
            terminal.events.every(
              (event) => event.type !== "write" || !event.data.includes("\x1b_G"),
            ),
          );
          assert.ok(
            terminal.events.every(
              (event) => event.type !== "write" || !event.data.includes("\x1b]133;"),
            ),
          );
          assert.ok(
            terminal.events.every(
              (event) => event.type !== "write" || !event.data.includes("\x1b]1337;File="),
            ),
          );
          assert.ok(someWriteSince(terminal, 0, "[Image:"));
        }),
      ),
    ));
}

function clearsStaleITerm2ImagePlacements(): void {
  it("clears stale iTerm2 image placements when they leave the viewport", () =>
    Effect.runPromise(
      withCapabilities(
        { images: "iterm2", trueColor: true, hyperlinks: true },
        Effect.gen(function* () {
          const terminal = new RecordingTerminal(20, 3);
          const tui = new TuiAltScreen(terminal);
          const imageLine = "\x1b]1337;File=inline=1;width=2;height=auto:AAAA\x07";
          tui.addChild({
            render: () => [imageLine, "", "", "after", "more", "end"],
            invalidate: () => {},
          });
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          tui.scrollToTop();
          yield* Effect.promise(() => terminal.waitForRender());
          const eventCount = terminal.events.length;

          tui.scrollBy(1);
          yield* Effect.promise(() => terminal.waitForRender());
          assert.ok(
            terminal.events
              .slice(eventCount)
              .some((event) => event.type === "write" && event.data.includes("\x1b[2J")),
          );
          tui.stop();
        }),
      ),
    ));
}

function cropsKittyImageWhoseFirst(): void {
  it("crops a Kitty image whose first line is above the viewport", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new RecordingTerminal(20, 3);
        const tui = new TuiAltScreen(terminal);
        const imageId = 123;
        const imageLine = encodeKitty("AAAA", { columns: 2, rows: 3, imageId, moveCursor: false });
        registerKittyImageMetadata({ imageId, columns: 2, rows: 3, widthPx: 100, heightPx: 100 });
        tui.addChild({
          render: () => ["before", imageLine, "", "", "after", "end"],
          invalidate: () => {},
        });
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());

        assert.strictEqual(tui.viewportTop, 3);
        assert.ok(
          terminal.events.some(
            (event) =>
              event.type === "write" &&
              event.data.includes("i=123") &&
              event.data.includes("y=66,h=34,r=1"),
          ),
        );

        tui.stop();
      }),
    ));
}
