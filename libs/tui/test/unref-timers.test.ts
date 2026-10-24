import assert from "node:assert";
import { describe, it } from "node:test";

import testing from "@msa/testing";
import { Effect } from "effect";

import AltScreenFlashContainer from "../src/components/alt-screen-flash.ts";
import tuiModule from "../src/index.ts";
import layout from "../src/layout.ts";
import RecordingTerminal from "./tui-alt-screen-recording-terminal.ts";

const { ScrollView, Text, TuiAltScreen } = tuiModule;
const { renderLayoutFrame } = layout;
const { timersArmedBy } = testing;

const LONG_MS = 60_000;

const settle = Effect.repeat(Effect.yieldNow, { times: 3 });

const lines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

const scrollbarHideLeavesTheProcessFree = Effect.gen(function* () {
  const scrollView = new ScrollView(new Text(lines(20), 0, 0), {
    scrollbar: "auto",
    scrollbarHideDelayMs: LONG_MS,
  });
  renderLayoutFrame(scrollView, 10, 4, () => {});
  const [, timers] = yield* timersArmedBy(
    Effect.sync(() => scrollView.scrollBy(2)).pipe(Effect.andThen(settle)),
  );
  scrollView.setScrollbar("hidden");
  assert.ok(timers.armed > 0);
  assert.strictEqual(timers.holding, 0);
});

const flashLeavesTheProcessFree = Effect.gen(function* () {
  const flash = new AltScreenFlashContainer(() => {});
  const [, timers] = yield* timersArmedBy(
    Effect.sync(() => flash.flash("copied", LONG_MS)).pipe(Effect.andThen(settle)),
  );
  flash.dispose();
  assert.ok(timers.armed > 0);
  assert.strictEqual(timers.holding, 0);
});

const selectionAutoScrollLeavesTheProcessFree = Effect.gen(function* () {
  const terminal = new RecordingTerminal(20, 4);
  const tui = new TuiAltScreen(terminal);
  tui.addChild(new Text(lines(200), 0, 0));
  tui.start();
  yield* Effect.promise(() => terminal.waitForRender());
  const [, timers] = yield* timersArmedBy(
    Effect.gen(function* () {
      terminal.sendInput("\x1b[<0;1;3M");
      terminal.sendInput("\x1b[<32;1;1M");
      yield* Effect.promise(() => terminal.waitForRender());
    }),
  );
  terminal.sendInput("\x1b[<0;1;1m");
  tui.stop();
  assert.ok(timers.armed > 0);
  assert.strictEqual(timers.holding, 0);
});

describe("background TUI timers leave the process free to exit", () => {
  it("while the scroll view waits to hide its scrollbar", () =>
    Effect.runPromise(scrollbarHideLeavesTheProcessFree));

  it("while a flash message waits to expire", () => Effect.runPromise(flashLeavesTheProcessFree));

  it("while a drag selection auto-scrolls at the viewport edge", () =>
    Effect.runPromise(selectionAutoScrollLeavesTheProcessFree));
});
