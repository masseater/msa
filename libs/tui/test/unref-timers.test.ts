import assert from "node:assert";
import { describe, it } from "node:test";

import { Effect } from "effect";

import AltScreenFlashContainer from "../src/components/alt-screen-flash.ts";
import tuiModule from "../src/index.ts";
import layout from "../src/layout.ts";
import RecordingTerminal from "./tui-alt-screen-recording-terminal.ts";

const { ScrollView, Text, TuiAltScreen } = tuiModule;
const { renderLayoutFrame } = layout;

const LONG_MS = 60_000;

const timersHoldingTheProcess = (): number =>
  process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;

const settle = Effect.repeat(Effect.yieldNow, { times: 3 });

const lines = (count: number): string =>
  Array.from({ length: count }, (_, index) => `line ${index + 1}`).join("\n");

const scrollbarHideLeavesTheProcessFree = Effect.gen(function* () {
  const scrollView = new ScrollView(new Text(lines(20), 0, 0), {
    scrollbar: "auto",
    scrollbarHideDelayMs: LONG_MS,
  });
  renderLayoutFrame(scrollView, 10, 4, () => {});
  const before = timersHoldingTheProcess();
  scrollView.scrollBy(2);
  yield* settle;
  const pending = timersHoldingTheProcess();
  scrollView.setScrollbar("hidden");
  assert.strictEqual(pending, before);
});

const flashLeavesTheProcessFree = Effect.gen(function* () {
  const flash = new AltScreenFlashContainer(() => {});
  const before = timersHoldingTheProcess();
  flash.flash("copied", LONG_MS);
  yield* settle;
  const pending = timersHoldingTheProcess();
  flash.dispose();
  assert.strictEqual(pending, before);
});

const selectionAutoScrollLeavesTheProcessFree = Effect.gen(function* () {
  const terminal = new RecordingTerminal(20, 4);
  const tui = new TuiAltScreen(terminal);
  tui.addChild(new Text(lines(200), 0, 0));
  tui.start();
  yield* Effect.promise(() => terminal.waitForRender());
  const before = timersHoldingTheProcess();
  terminal.sendInput("\x1b[<0;1;3M");
  terminal.sendInput("\x1b[<32;1;1M");
  yield* Effect.promise(() => terminal.waitForRender());
  const pending = timersHoldingTheProcess();
  terminal.sendInput("\x1b[<0;1;1m");
  tui.stop();
  assert.strictEqual(pending, before);
});

describe("background TUI timers leave the process free to exit", () => {
  it("while the scroll view waits to hide its scrollbar", () =>
    Effect.runPromise(scrollbarHideLeavesTheProcessFree));

  it("while a flash message waits to expire", () => Effect.runPromise(flashLeavesTheProcessFree));

  it("while a drag selection auto-scrolls at the viewport edge", () =>
    Effect.runPromise(selectionAutoScrollLeavesTheProcessFree));
});
