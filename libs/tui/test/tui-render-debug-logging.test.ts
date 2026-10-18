import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { flushBackgroundFileWrites } from "../src/file-log.ts";
import { type TUI, TuiMainScreen } from "../src/index.ts";
import { pathOperations } from "../src/platform.ts";
import { makeTempDirectory, readFileString, removeRecursive } from "./test-platform.ts";
import { withEnv } from "./tui-render-helpers.ts";
import { TestComponent } from "./tui-render-test-component.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TUI debug logging", () => {
  it("writes redraw logs to the provided directory", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const logDir = yield* makeTempDirectory("msa-tui-log-");
        yield* withEnv(
          { MSA_TUI_DEBUG_REDRAW: "1" },
          Effect.gen(function* () {
            const terminal = new VirtualTerminal(40, 10);
            const tui: TUI = new TuiMainScreen(terminal, undefined, logDir);
            const component = new TestComponent();
            tui.addChild(component);
            component.lines = ["test"];
            tui.start();
            yield* Effect.promise(() => terminal.waitForRender());
            yield* Effect.promise(flushBackgroundFileWrites);

            assert.match(
              yield* readFileString(pathOperations.join(logDir, "msa-tui-debug.log")),
              /fullRender: first render/u,
            );
            tui.stop();
          }),
        ).pipe(Effect.ensuring(removeRecursive(logDir)));
      }),
    ));
});
