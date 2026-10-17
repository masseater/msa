import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { ScrollView } from "../src/components/scroll-view.ts";
import { overrideEnv } from "../src/env.ts";
import {
  encodeKitty,
  registerKittyImageMetadata,
  resetCapabilitiesCache,
  setCapabilities,
} from "../src/terminal-image.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { someWriteSince, writesSince } from "./tui-alt-screen-helpers.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";
import {
  tuialtscreenCases6,
  tuialtscreenCases7,
} from "./tui-alt-screen-tuialtscreen-5-cases-helpers.ts";

describe("TuiAltScreen", () => {
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
});

describe("TuiAltScreen", () => {
  tuialtscreenCases6();
});

describe("TuiAltScreen", () => {
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
});

describe("TuiAltScreen", () => {
  tuialtscreenCases7();
});
