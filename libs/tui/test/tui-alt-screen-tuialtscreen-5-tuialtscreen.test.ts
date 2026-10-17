import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { ScrollView } from "../src/components/scroll-view.ts";
import { encodeKitty, registerKittyImageMetadata } from "../src/terminal-image.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { scrollLineByLine, someWriteSince, withCapabilities } from "./tui-alt-screen-helpers.ts";
import { RecordingTerminal } from "./tui-alt-screen-recording-terminal.ts";

describe("TuiAltScreen", () => {
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
});
