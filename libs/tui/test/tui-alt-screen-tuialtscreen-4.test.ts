import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import { Text } from "../src/components/text.ts";
import {
  getKeybindings,
  KeybindingsManager,
  setKeybindings,
  TUI_KEYBINDINGS,
} from "../src/keybindings.ts";
import { TuiAltScreen } from "../src/tui-alt-screen.ts";
import { OSC133_ZONE_START } from "./tui-alt-screen-helpers.ts";
import { tuialtscreenCases5 } from "./tui-alt-screen-tuialtscreen-4-cases-helpers.ts";
import { VirtualTerminal } from "./virtual-terminal.ts";

describe("TuiAltScreen", () => {
  it("scrolls the transcript by one line with custom bindings", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const originalKeybindings = getKeybindings();
        const terminal = new VirtualTerminal(20, 10);
        const tui = new TuiAltScreen(terminal);
        setKeybindings(
          new KeybindingsManager(TUI_KEYBINDINGS, {
            "tui.altScreen.lineUp": "ctrl+y",
            "tui.altScreen.lineDown": "ctrl+e",
          }),
        );
        yield* Effect.gen(function* () {
          tui.addChild(
            new Text(
              Array.from({ length: 30 }, (_, index) => `line ${index + 1}`).join("\n"),
              0,
              0,
            ),
          );
          tui.start();
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(tui.viewportTop, 20);

          terminal.sendInput("\x19");
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(tui.viewportTop, 19);

          terminal.sendInput("\x05");
          yield* Effect.promise(() => terminal.waitForRender());
          assert.strictEqual(tui.viewportTop, 20);
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              tui.stop();
              setKeybindings(originalKeybindings);
            }),
          ),
        );
      }),
    ));
});

describe("TuiAltScreen", () => {
  tuialtscreenCases5();
});

describe("TuiAltScreen", () => {
  it("jumps between OSC 133 semantic prompt markers", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const terminal = new VirtualTerminal(20, 3);
        const tui = new TuiAltScreen(terminal);
        tui.addChild(
          new Text(
            [1, 2, 3, 4]
              .flatMap((message) => [`${OSC133_ZONE_START}message ${message}`, "detail"])
              .join("\n"),
            0,
            0,
          ),
        );
        tui.start();
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 5);

        terminal.sendInput("\x1b[57419;6u");
        terminal.sendInput("\x1b[57419;6:3u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 4);
        assert.strictEqual(terminal.getViewport()[0]?.trimEnd(), "message 3");

        terminal.sendInput("\x1b[1;6A");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 2);
        assert.strictEqual(terminal.getViewport()[0]?.trimEnd(), "message 2");

        terminal.sendInput("\x1b[57420;6u");
        terminal.sendInput("\x1b[57420;6:3u");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 4);
        assert.strictEqual(terminal.getViewport()[0]?.trimEnd(), "message 3");

        terminal.sendInput("\x1b[1;6B");
        yield* Effect.promise(() => terminal.waitForRender());
        assert.strictEqual(tui.viewportTop, 5);
        assert.strictEqual(terminal.getViewport()[1]?.trimEnd(), "message 4");
        assert.strictEqual(tui.isFollowingOutput, true);

        tui.stop();
      }),
    ));
});
