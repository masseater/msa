import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import orchestratorPaneScreen from "./orchestrator-pane-screen.ts";

const { awaited, runTest } = testing;

const { prepareUi, screen, stopScreens } = orchestratorPaneScreen;

const SHIFT_RIGHT = "\x1b[1;2C";
const CTRL_SHIFT_RIGHT = "\x1b[1;6C";
const CTRL_SHIFT_LEFT = "\x1b[1;6D";

beforeAll(prepareUi);

afterEach(stopScreens);

const press = (column: number) => `\x1b[<0;${column + 1};3M`;
const drag = (column: number) => `\x1b[<32;${column + 1};3M`;
const release = (column: number) => `\x1b[<0;${column + 1};3m`;

const splitsTheScreen73WithA = () =>
  runTest(
    Effect.gen(function* () {
      const view = yield* awaited(screen());
      expect(view.divider()).toBe(69);
      expect(view.lines().every((line) => line[69] === "│")).toBe(true);
      expect(view.lines()[0]).toContain("Threads");
    }),
  );

const movesTheDividerWhenItIsDragged = () =>
  runTest(
    Effect.gen(function* () {
      const view = yield* awaited(screen());
      yield* view.send(press(69), drag(55), drag(49), release(49));
      expect(view.divider()).toBe(49);
      expect(view.lines()[0]!.slice(50)).toContain("Threads");
    }),
  );

const movesTheDividerWithCtrlShiftArrows = () =>
  runTest(
    Effect.gen(function* () {
      const view = yield* awaited(screen());
      yield* view.send(CTRL_SHIFT_LEFT);
      expect(view.divider()).toBe(67);
      yield* view.send(CTRL_SHIFT_RIGHT);
      expect(view.divider()).toBe(69);
    }),
  );

const keepsTheDraggedShareWhenTheTerminal = () =>
  runTest(
    Effect.gen(function* () {
      const view = yield* awaited(screen());
      yield* view.send(press(69), drag(49), release(49));
      yield* view.resize(200);
      expect(view.divider()).toBe(98);
    }),
  );

const hidesThePaneOnceItWouldBe = () =>
  runTest(
    Effect.gen(function* () {
      const view = yield* awaited(screen());
      yield* view.resize(79);
      expect(view.divider()).toBe(-1);
      expect(view.lines().join("\n")).not.toContain("Threads");

      yield* view.resize(80);
      expect(view.divider()).toBe(55);
      expect(view.lines()[0]).toContain("Threads");
    }),
  );

const hidesAWidenedPaneOnceTheConversation = () =>
  runTest(
    Effect.gen(function* () {
      const view = yield* awaited(screen());
      yield* view.send(press(69), drag(20), release(20));
      expect(view.divider()).toBe(40);
      yield* view.resize(90);
      expect(view.divider()).toBe(-1);
      yield* view.resize(100);
      expect(view.divider()).toBe(40);
    }),
  );

const hidesThePaneWhenDraggedPastIts = () =>
  runTest(
    Effect.gen(function* () {
      const view = yield* awaited(screen());
      yield* view.send(press(69), drag(90), release(90));
      expect(view.divider()).toBe(-1);
      yield* view.send(CTRL_SHIFT_LEFT);
      expect(view.divider()).toBe(75);
    }),
  );

const drawsOnePaneWithoutAnOrchestratorAnd = () =>
  runTest(
    Effect.gen(function* () {
      const view = yield* awaited(screen({ orchestrator: undefined }));
      yield* view.send(SHIFT_RIGHT, CTRL_SHIFT_LEFT);
      expect(view.divider()).toBe(-1);
      expect(view.lines().join("\n")).not.toContain("Threads");
      expect(view.ui.getFocusedComponent()).toBe(view.editor);
    }),
  );

describe("orchestrator pane layout", () => {
  it("splits the screen 7:3 with a divider on every row", splitsTheScreen73WithA);

  it("moves the divider when it is dragged with the mouse", movesTheDividerWhenItIsDragged);

  it("moves the divider with ctrl+shift+arrows", movesTheDividerWithCtrlShiftArrows);

  it("keeps the dragged share when the terminal resizes", keepsTheDraggedShareWhenTheTerminal);

  it("hides the pane once it would be narrower than 24 columns", hidesThePaneOnceItWouldBe);

  it(
    "hides a widened pane once the conversation would be narrower than 40 columns",
    hidesAWidenedPaneOnceTheConversation,
  );

  it(
    "hides the pane when dragged past its minimum and brings it back with the widen key",
    hidesThePaneWhenDraggedPastIts,
  );

  it(
    "draws one pane without an orchestrator and ignores the pane keys",
    drawsOnePaneWithoutAnOrchestratorAnd,
  );
});
