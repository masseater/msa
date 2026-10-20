import testing from "@msa/testing";
import { Effect } from "effect";
import { afterEach, beforeAll, describe, expect, it } from "vite-plus/test";

import { viewHelpers } from "../src/modes/interactive/components/tasks-view-helpers.ts";
import { TasksView } from "../src/modes/interactive/components/tasks-view.ts";
import { ThreadPane } from "../src/modes/interactive/components/thread-pane.ts";
import { stripAnsi } from "../src/utils/ansi.ts";
import orchestratorPaneFixtures from "./orchestrator-pane-fixtures.ts";
import orchestratorPaneScreen from "./orchestrator-pane-screen.ts";

const { awaited, runTest } = testing;

const { FIRST, orchestratorFor, paneTasks } = orchestratorPaneFixtures;

const { prepareUi, screen, stopScreens } = orchestratorPaneScreen;

const SHIFT_RIGHT = "\x1b[1;2C";
const SHIFT_LEFT = "\x1b[1;2D";
const DOWN = "\x1b[B";
const ESC = "\x1b";

beforeAll(prepareUi);

afterEach(stopScreens);

const opensThreadsFullWidthWithShiftRight = () =>
  runTest(
    Effect.gen(function* () {
      const view = yield* awaited(screen());
      yield* view.send(SHIFT_RIGHT);
      expect(view.ui.getFocusedComponent()).toBeInstanceOf(TasksView);
      expect(view.divider()).toBe(-1);
      expect(view.lines().join("\n")).toContain("build the pane");

      yield* view.send(ESC);
      expect(view.ui.getFocusedComponent()).toBe(view.editor);
      expect(view.divider()).toBe(69);
    }),
  );

const returnsWithShiftLeft = () =>
  runTest(
    Effect.gen(function* () {
      const view = yield* awaited(screen());
      yield* view.send(SHIFT_RIGHT, SHIFT_LEFT);
      expect(view.ui.getFocusedComponent()).toBe(view.editor);
      expect(view.divider()).toBe(69);
    }),
  );

const keepsTheSelectionMadeInThreadsIn = () =>
  runTest(
    Effect.gen(function* () {
      const view = yield* awaited(screen());
      yield* view.send(SHIFT_RIGHT, DOWN, ESC);
      expect(view.state.selectedId).toBe("b");
      const pane = view
        .lines()
        .map((line) => line.slice(70))
        .join("\n");
      expect(pane).toContain("› ○ wire the keys");
      expect(pane).toContain("build the pane");
    }),
  );

describe("threads view from the pane", () => {
  it(
    "opens /threads full width with shift+right and returns with escape",
    opensThreadsFullWidthWithShiftRight,
  );

  it("returns with shift+left", returnsWithShiftLeft);

  it("keeps the selection made in /threads in the pane", keepsTheSelectionMadeInThreadsIn);
});

const summarizesTheListAndTheSelectedTask = () => {
  const tasks = paneTasks();
  const orchestrator = orchestratorFor(tasks);
  const state = { selectedId: FIRST, showFinished: false };
  const pane = new ThreadPane({ height: () => 40, orchestrator: () => orchestrator, state });
  const text = stripAnsi(pane.render(48).join("\n"));
  expect(text).toContain("› ● build the pane");
  expect(text).toContain("01a1518a · flash · 2m ago");
  expect(text).toContain("○ wire the keys");
  expect(text).toContain("● running · main");
  expect(text).toContain("now    the screen has one pane");
  expect(text).toContain("goal   the pane splits 7:3");
  expect(text).toContain("report 1m ago worker: the divider renders");
  expect(text.match(/the divider renders/gu)).toHaveLength(1);

  state.selectedId = "b";
  expect(stripAnsi(pane.render(48).join("\n"))).toContain("deps   ● build the pane");
};

const fitsItsWidthAndHeight = () => {
  const pane = new ThreadPane({
    height: () => 10,
    orchestrator: () => orchestratorFor(paneTasks()),
    state: viewHelpers.createTasksViewState(),
  });
  const lines = pane.render(24);
  expect(lines.length).toBeLessThanOrEqual(10);
  expect(lines.every((line) => stripAnsi(line).length <= 24)).toBe(true);
};

describe("orchestrator pane contents", () => {
  it("summarizes the list and the selected task", summarizesTheListAndTheSelectedTask);

  it("fits its width and height", fitsItsWidthAndHeight);
});
