import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import tuiModule from "../src/index.ts";
import terminalImageKitty from "../src/terminal-image-kitty.ts";
import tuiAltScreenHelpers from "./tui-alt-screen-helpers.ts";
import RecordingTerminal from "./tui-alt-screen-recording-terminal.ts";

const { Image, TuiAltScreen } = tuiModule;
const { encodeKitty, registerKittyImageMetadata } = terminalImageKitty;

const { someWriteSince, withCapabilities } = tuiAltScreenHelpers;

describe("TuiAltScreen", () => {
  doesNotEmitKittyGraphics();
  clearsStaleITerm2ImagePlacements();
  cropsKittyImageWhoseFirst();
});

function doesNotEmitKittyGraphics(): void {
  it("does not emit Kitty graphics commands or OSC 133 zones in iTerm2", () =>
    Effect.runPromise(
      withCapabilities(
        { hyperlinks: true, images: "iterm2", trueColor: true },
        Effect.gen(function* () {
          const terminal = new RecordingTerminal(20, 3);
          const tui = new TuiAltScreen(terminal);
          tui.addChild({
            invalidate: () => {},
            render: () => ["\x1b]133;B\x07\x1b]133;C\x07\x1b]133;A\x07content"],
          });
          tui.addChild(
            new Image(
              "AAAA",
              "image/png",
              { fallbackColor: (value) => value },
              { filename: "example.png" },
              { heightPx: 10, widthPx: 10 },
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
        { hyperlinks: true, images: "iterm2", trueColor: true },
        Effect.gen(function* () {
          const terminal = new RecordingTerminal(20, 3);
          const tui = new TuiAltScreen(terminal);
          const imageLine = "\x1b]1337;File=inline=1;width=2;height=auto:AAAA\x07";
          tui.addChild({
            invalidate: () => {},
            render: () => [imageLine, "", "", "after", "more", "end"],
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
        const imageLine = encodeKitty("AAAA", { columns: 2, imageId, moveCursor: false, rows: 3 });
        registerKittyImageMetadata({ columns: 2, heightPx: 100, imageId, rows: 3, widthPx: 100 });
        tui.addChild({
          invalidate: () => {},
          render: () => ["before", imageLine, "", "", "after", "end"],
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
