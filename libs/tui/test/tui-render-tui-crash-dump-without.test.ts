import assert from "node:assert";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { describe, it, mock } from "node:test";

import { Effect } from "effect";

import { Image } from "../src/components/image.ts";
import { pathOperations } from "../src/platform.ts";
import {
  resetCapabilitiesCache,
  setCapabilities,
  setCellDimensions,
} from "../src/terminal-image.ts";
import { TuiMainScreen } from "../src/tui-main-screen.ts";
import { type TUI } from "../src/tui.ts";
import { makeTempDirectory, readFileString, removeRecursive } from "./test-platform.ts";
import { tuiKittyImageCleanupCases1 } from "./tui-render-cases-helpers.ts";
import { LoggingVirtualTerminal } from "./tui-render-logging-virtual-terminal.ts";
import { TestComponent } from "./tui-render-test-component.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI crash dump without configured log directory", () => {
  it("writes the crash dump to the OS temp directory instead of a home-directory default", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const crashDir = yield* makeTempDirectory("msa-tui-crash-");
        const crashLogPath = pathOperations.join(crashDir, "msa-tui-crash.log");
        const tmpdirMock = mock.method(os, "tmpdir", () => crashDir);
        syncBuiltinESMExports();
        yield* Effect.gen(function* () {
          const terminal = new VirtualTerminal(40, 10);
          const tui: TUI = new TuiMainScreen(terminal);
          const component = new TestComponent();
          tui.addChild(component);
          component.lines = ["ok"];
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());

          component.lines = ["ok", "x".repeat(60)];
          assert.throws(
            () => tui.renderNow(),
            (error: unknown) => {
              assert.ok(error instanceof Error);
              assert.ok(
                error.message.includes(crashLogPath),
                `error message should reference ${crashLogPath}`,
              );
              return true;
            },
          );
          assert.match(yield* readFileString(crashLogPath), /Terminal width: 40/u);
        }).pipe(
          Effect.ensuring(
            Effect.andThen(
              Effect.sync(() => {
                tmpdirMock.mock.restore();
                syncBuiltinESMExports();
              }),
              removeRecursive(crashDir),
            ),
          ),
        );
      }),
    ));
});

describe("TUI Kitty image cleanup", () => {
  tuiKittyImageCleanupCases1();
});

describe("TUI Kitty image cleanup", () => {
  it("falls back to full redraw when Kitty image pre-clear would scroll", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        setCapabilities({ images: "kitty", trueColor: true, hyperlinks: true });
        setCellDimensions({ widthPx: 10, heightPx: 10 });
        yield* Effect.gen(function* () {
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
