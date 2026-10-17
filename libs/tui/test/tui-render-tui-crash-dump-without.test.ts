import assert from "node:assert";
import { syncBuiltinESMExports } from "node:module";
import os from "node:os";
import { describe, it, mock } from "node:test";

import { Effect } from "effect";

import { type TUI, TuiMainScreen } from "../src/index.ts";
import { pathOperations } from "../src/platform.ts";
import { makeTempDirectory, readFileString, removeRecursive } from "./test-platform.ts";
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
