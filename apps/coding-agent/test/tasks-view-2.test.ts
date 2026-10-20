import { setKeybindings } from "@msa/tui";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { TaskSnapshot } from "../src/core/orchestrator/types.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import tasksViewHarness from "./tasks-view-harness.ts";
import tasksViewSupport from "./tasks-view-support.ts";

const { DOWN, ENTER, PAGE_DOWN, PAGE_UP } = tasksViewSupport;

const { setup, task } = tasksViewHarness;

const UP = "\x1b[A";

const CTRL_D = "\x04";

const CTRL_U = "\x15";

beforeAll(() => {
  initTheme(undefined, false);
  setKeybindings(new KeybindingsManager());
});

function failedTasks(count: number): TaskSnapshot[] {
  return Array.from({ length: count }, (_, index) =>
    task(`t${index + 1}`, {
      reports: [
        {
          content: `error ${index + 1}`,
          createdAt: 0,
          id: `r${index + 1}`,
          role: "worker",
          status: "failed",
          taskId: `t${index + 1}`,
          threadId: "th-worker",
        },
      ],
      status: "failed",
      title: `task ${index + 1}`,
    }),
  );
}

const drawsTheWholeListAndNoScroll = () => {
  const { screen } = setup();
  const lines = screen();
  expect(lines.length).toBeLessThanOrEqual(40);
  expect(lines.join("\n")).toContain("Review of main");
  expect(lines.join("\n")).not.toContain("more");
};

const scrollsTheListToKeepTheSelected = () => {
  const { view, screen } = setup({ maxHeight: 12, tasks: failedTasks(12) });
  expect(screen().join("\n")).toContain("task 1");
  expect(screen().join("\n")).not.toContain("task 12");
  expect(screen().join("\n")).toContain("↓");

  for (let step = 0; step < 11; step++) view.handleInput(DOWN);
  const bottom = screen();
  expect(bottom.length).toBeLessThanOrEqual(12);
  expect(bottom.join("\n")).toContain("› ✗ task 12");
  expect(bottom.join("\n")).toContain("worker: error 12");
  expect(bottom.join("\n")).toContain("↑");
  expect(bottom.join("\n")).not.toMatch(/✗ task 1\b/u);

  view.handleInput(UP);
  expect(screen().join("\n")).toContain("› ✗ task 11");
};

const pagesTheListWithoutWrappingAround = () => {
  const { view, screen } = setup({ maxHeight: 12, replans: [], tasks: failedTasks(12) });
  screen();
  view.handleInput(PAGE_DOWN);
  expect(screen().join("\n")).toContain("› ✗ task 7");
  view.handleInput(PAGE_DOWN);
  view.handleInput(PAGE_DOWN);
  expect(screen().join("\n")).toContain("› ✗ task 12");
  view.handleInput(PAGE_UP);
  expect(screen().join("\n")).toContain("› ✗ task 6");
};

const scrollsTheListByHalfAPage = () => {
  const { view, screen } = setup({ maxHeight: 12, replans: [], tasks: failedTasks(12) });
  screen();
  view.handleInput(CTRL_D);
  expect(screen().join("\n")).toContain("› ✗ task 4");
  expect(screen().join("\n")).toContain("worker: error 4");
  view.handleInput(CTRL_U);
  expect(screen().join("\n")).toContain("› ✗ task 1");
};

const scrollsTheDetailOfALongReport = () => {
  const report = Array.from({ length: 40 }, (_, index) => `step ${index + 1}`).join("\n");
  const { view, screen } = setup({
    maxHeight: 12,
    state: { showFinished: true },
    tasks: [
      task("long", {
        reports: [
          {
            content: report,
            createdAt: 0,
            id: "r1",
            role: "worker",
            status: "completed",
            taskId: "long",
            threadId: "th-worker",
          },
        ],
        status: "completed",
      }),
    ],
  });
  view.handleInput(ENTER);
  const rows = () => screen().map((line) => line.trim());
  expect(rows()).toContain("Report");
  expect(rows()).toContain("… 28 more lines");
  expect(rows()).toContain("step 29");
  expect(rows()).not.toContain("step 40");
  expect(screen().join("\n")).toContain("↓");
  expect(screen().join("\n")).not.toContain("↑");

  for (let step = 0; step < 5; step++) view.handleInput(PAGE_DOWN);
  const bottom = screen();
  expect(bottom.length).toBeLessThanOrEqual(12);
  expect(bottom.join("\n")).toContain("long works");
  expect(bottom.join("\n")).toContain("↑");
  expect(bottom.join("\n")).not.toContain("↓");

  for (let step = 0; step < 5; step++) view.handleInput(PAGE_UP);
  expect(rows()).toContain("step 29");
  expect(screen().join("\n")).not.toContain("↑");
};

const scrollsTheDetailByLinesAndHalf = () => {
  const report = Array.from({ length: 40 }, (_, index) => `step ${index + 1}`).join("\n");
  const long = task("long", {
    reports: [
      {
        content: report,
        createdAt: 0,
        id: "r1",
        role: "worker",
        status: "completed",
        taskId: "long",
        threadId: "th-worker",
      },
    ],
    status: "completed",
  });
  const { view, screen } = setup({
    maxHeight: 12,
    state: { showFinished: true },
    tasks: [long],
  });
  view.handleInput(ENTER);
  view.handleInput(DOWN);
  expect(screen().join("\n")).toContain("↑");
  view.handleInput(UP);
  expect(screen().join("\n")).not.toContain("↑");
  view.handleInput(CTRL_D);
  expect(screen().join("\n")).toContain("↑ 3 ·");
  view.handleInput(CTRL_U);
  expect(screen().join("\n")).not.toContain("↑");
};

const pullsTheDetailWindowBackWhenThe = () => {
  const long = task("long", {
    currentState: "",
    goalState: "",
    reports: [
      {
        content: Array.from({ length: 40 }, (_, index) => `step ${index + 1}`).join("\n"),
        createdAt: 0,
        id: "r1",
        role: "worker",
        status: "completed",
        taskId: "long",
        threadId: "th-worker",
      },
    ],
    status: "completed",
  });
  const { view, screen } = setup({
    maxHeight: 12,
    state: { showFinished: true },
    tasks: [long],
  });
  view.handleInput(ENTER);
  for (let step = 0; step < 5; step++) view.handleInput(PAGE_DOWN);
  expect(screen().join("\n")).toContain("↑");

  long.reports = [{ ...long.reports[0]!, content: "short report" }];
  const shrunk = screen();
  expect(shrunk.length).toBeLessThanOrEqual(12);
  expect(shrunk.join("\n")).toContain("Report");
  expect(shrunk.join("\n")).toContain("short report");
  expect(shrunk.join("\n")).not.toContain("↑");
};

const pullsTheListBackWhenFinishedTasks = () => {
  const finished = failedTasks(10).map((entry) =>
    Object.assign(entry, { status: "completed" as const }),
  );
  const { view, screen } = setup({
    maxHeight: 12,
    state: { showFinished: true },
    tasks: [...finished, ...failedTasks(2).map((entry) => Object.assign(entry, { round: "next" }))],
  });
  for (let step = 0; step < 10; step++) view.handleInput(DOWN);
  expect(screen().join("\n")).toContain("↑");

  view.handleInput("c");
  const collapsed = screen();
  expect(collapsed.length).toBeLessThanOrEqual(12);
  expect(collapsed.join("\n")).toContain("› ✗ task 1");
  expect(collapsed.join("\n")).toContain("worker: error 2");
};

const keepsTheReplanLineUnderTheTitle = () => {
  const { screen } = setup({ maxHeight: 12, tasks: failedTasks(12) });
  const lines = screen();
  expect(lines.length).toBeLessThanOrEqual(12);
  expect(lines.join("\n")).toContain("↺ the api moved to v3");
  expect(lines.join("\n")).toContain("↓");
};

const staysInsideTheScreenWhenTheComposer = () => {
  const { view, screen } = setup({ maxHeight: 10, tasks: failedTasks(12) });
  view.handleInput("n");
  const composing = screen();
  expect(composing.length).toBeLessThanOrEqual(10);
  expect(composing.join("\n")).toContain("Message to this task");
};

describe("TasksView scrolling", () => {
  it(
    "draws the whole list and no scroll label when it fits the screen",
    drawsTheWholeListAndNoScroll,
  );

  it(
    "scrolls the list to keep the selected task and its report line visible",
    scrollsTheListToKeepTheSelected,
  );

  it("pages the list without wrapping around", pagesTheListWithoutWrappingAround);

  it("scrolls the list by half a page with ctrl+d and ctrl+u", scrollsTheListByHalfAPage);

  it("scrolls the detail of a long report and stops at both ends", scrollsTheDetailOfALongReport);

  it("scrolls the detail by lines and half pages", scrollsTheDetailByLinesAndHalf);

  it("pulls the detail window back when the report shrinks", pullsTheDetailWindowBackWhenThe);

  it("pulls the list back when finished tasks are collapsed", pullsTheListBackWhenFinishedTasks);

  it(
    "keeps the replan line under the title while the list scrolls",
    keepsTheReplanLineUnderTheTitle,
  );

  it(
    "stays inside the screen when the composer adds footer lines",
    staysInsideTheScreenWhenTheComposer,
  );
});
