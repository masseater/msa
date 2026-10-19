import { setKeybindings } from "@msa/tui";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import type { TaskSnapshot } from "../src/core/orchestrator/types.ts";
import { viewHelpers } from "../src/modes/interactive/components/tasks-view-helpers.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { setup, TASKS, task } from "./tasks-view-harness.ts";

const ENTER = "\r";
const ESC = "\x1b";
const DOWN = "\x1b[B";
const UP = "\x1b[A";
const PAGE_UP = "\x1b[5~";
const PAGE_DOWN = "\x1b[6~";
const CTRL_D = "\x04";
const CTRL_U = "\x15";

beforeAll(() => {
  initTheme(undefined, false);
  setKeybindings(new KeybindingsManager());
});

it("shows the round DAG, statuses, waiting reasons, and worker/reviewer threads", () => {
  const { screen } = setup();
  const text = screen().join("\n");
  expect(text).toContain("main");
  expect(text).toContain("waiting for a");
  expect(text).toContain("Review of main");
  expect(text).toContain("writing a.ts");
  expect(screen().some((line) => line.includes("  ○ b"))).toBe(true);
});

it("opens a task and shows its states, reports, and threads", () => {
  const { view, screen } = setup({ initialId: "c", state: { showFinished: true } });
  view.handleInput(ENTER);
  const text = screen().join("\n");
  expect(text).toContain("Current state");
  expect(text).toContain("c is not written");
  expect(text).toContain("Goal state");
  expect(text).toContain("c works");
  expect(text).toContain("c is done");
  expect(text).toContain("worker th-worker (flash/low) running");
  expect(text).toContain("reviewer th-review (fable/high) completed");
  view.handleInput(ESC);
  expect(screen().join("\n")).toContain("Tasks");
});

it("sends a message to a waiting task with the same key as a running one", () => {
  const { view, orchestrator, screen } = setup({ initialId: "b" });
  view.handleInput("n");
  expect(screen().join("\n")).toContain("Message to this task");
  for (const key of "use the cache") view.handleInput(key);
  view.handleInput(ENTER);
  expect(orchestrator.sendMessage).toHaveBeenCalledWith("b", "use the cache");
});

it("sends a shared note to the selected task's round", () => {
  const { view, orchestrator } = setup({ initialId: "b" });
  view.handleInput("b");
  for (const key of "do not touch x") view.handleInput(key);
  view.handleInput(ENTER);
  expect(orchestrator.sendNote).toHaveBeenCalledWith({
    content: "do not touch x",
    audience: "round",
    round: "main",
  });
});

it("adds and drops dependencies of the selected task with + and -", () => {
  const { view, orchestrator, screen } = setup({ initialId: "b" });
  view.handleInput("d");
  expect(screen().join("\n")).toContain("Dependencies of b");
  for (const key of "+c -a") view.handleInput(key);
  view.handleInput(ENTER);
  expect(orchestrator.setDepends).toHaveBeenCalledWith({
    taskIds: ["b"],
    add: ["c"],
    remove: ["a"],
  });
});

it("rewrites the goal state of the selected task, starting from the current one", () => {
  const { view, orchestrator, screen } = setup({ initialId: "b" });
  view.handleInput("g");
  expect(screen().join("\n")).toContain("Goal state of b");
  expect(screen().join("\n")).toContain("b works");
  for (const key of " behind the api") view.handleInput(key);
  view.handleInput(ENTER);
  expect(orchestrator.setState).toHaveBeenCalledWith({
    taskId: "b",
    goalState: "b works behind the api",
  });
});

it("rewrites the current state of the selected task", () => {
  const { view, orchestrator } = setup({ initialId: "b" });
  view.handleInput("w");
  for (const key of ", a is merged") view.handleInput(key);
  view.handleInput(ENTER);
  expect(orchestrator.setState).toHaveBeenCalledWith({
    taskId: "b",
    currentState: "b is not written, a is merged",
  });
});

it("stops and reruns the selected task", () => {
  const { view, orchestrator } = setup({ initialId: "b" });
  view.handleInput("s");
  expect(orchestrator.stop).toHaveBeenCalledWith("b");
  const completed = setup({ initialId: "c", state: { showFinished: true } });
  completed.view.handleInput("r");
  expect(completed.orchestrator.rerun).toHaveBeenCalledWith("c");
});

it("collapses completed and stopped tasks by default and remembers the toggle across views", () => {
  const state = viewHelpers.createTasksViewState();
  const first = setup({ state });
  expect(
    first
      .screen()
      .some(
        (line) => line.includes("1 done") && line.includes("1 stopped") && line.includes("show"),
      ),
  ).toBe(true);
  expect(first.screen().join("\n")).not.toContain("finished-work");
  expect(first.screen().join("\n")).not.toContain("stopped-work");
  first.view.handleInput("c");
  expect(first.screen().join("\n")).toContain("finished-work");
  expect(first.screen().join("\n")).toContain("stopped-work");
  const second = setup({ state });
  expect(second.screen().join("\n")).toContain("finished-work");
  second.view.handleInput("c");
  expect(second.screen().join("\n")).not.toContain("finished-work");
  expect(second.screen().join("\n")).not.toContain("stopped-work");
});

it("counts tasks by status for the footer", () => {
  const counts = viewHelpers.describeTaskCounts(TASKS);
  expect(counts).toContain("1 running");
  expect(counts).toContain("2 waiting");
  expect(counts).toContain("1 done");
  expect(counts).toContain("1 stopped");
});

it("shows the latest replan in the list and its handoff in the task", () => {
  const list = setup({ state: { showFinished: true } });
  const listText = list.screen().join("\n");
  expect(listText).toContain("↺ the api moved to v3");
  expect(listText).toContain("1 stopped · 1 created · 1 kept");
  expect(list.screen().some((line) => line.includes("stopped-work ↺"))).toBe(true);

  const { view, screen } = setup({ initialId: "d", state: { showFinished: true } });
  view.handleInput(ENTER);
  const text = screen().join("\n");
  expect(text).toContain("Replan");
  expect(text).toContain("stopped · the api moved to v3");
  expect(text).toContain("Handoff");
  expect(text).toContain("two checks still failing");
});

function failedTasks(count: number): TaskSnapshot[] {
  return Array.from({ length: count }, (_, index) =>
    task(`t${index + 1}`, {
      title: `task ${index + 1}`,
      status: "failed",
      reports: [
        {
          id: `r${index + 1}`,
          taskId: `t${index + 1}`,
          threadId: "th-worker",
          role: "worker",
          status: "failed",
          content: `error ${index + 1}`,
          createdAt: 0,
        },
      ],
    }),
  );
}

describe("TasksView scrolling", () => {
  it("draws the whole list and no scroll label when it fits the screen", () => {
    const { screen } = setup();
    const lines = screen();
    expect(lines.length).toBeLessThanOrEqual(40);
    expect(lines.join("\n")).toContain("Review of main");
    expect(lines.join("\n")).not.toContain("more");
  });

  it("scrolls the list to keep the selected task and its report line visible", () => {
    const { view, screen } = setup({ tasks: failedTasks(12), maxHeight: 12 });
    expect(screen().join("\n")).toContain("task 1");
    expect(screen().join("\n")).not.toContain("task 12");
    expect(screen().join("\n")).toContain("↓");

    for (let step = 0; step < 11; step++) view.handleInput(DOWN);
    const bottom = screen();
    expect(bottom.length).toBeLessThanOrEqual(12);
    expect(bottom.join("\n")).toContain("› ✗ task 12");
    expect(bottom.join("\n")).toContain("worker: error 12");
    expect(bottom.join("\n")).toContain("↑");
    expect(bottom.join("\n")).not.toMatch(/✗ task 1\b/);

    view.handleInput(UP);
    expect(screen().join("\n")).toContain("› ✗ task 11");
  });

  it("pages the list without wrapping around", () => {
    const { view, screen } = setup({ tasks: failedTasks(12), maxHeight: 12, replans: [] });
    screen();
    view.handleInput(PAGE_DOWN);
    expect(screen().join("\n")).toContain("› ✗ task 7");
    view.handleInput(PAGE_DOWN);
    view.handleInput(PAGE_DOWN);
    expect(screen().join("\n")).toContain("› ✗ task 12");
    view.handleInput(PAGE_UP);
    expect(screen().join("\n")).toContain("› ✗ task 6");
  });

  it("scrolls the list by half a page with ctrl+d and ctrl+u", () => {
    const { view, screen } = setup({ tasks: failedTasks(12), maxHeight: 12, replans: [] });
    screen();
    view.handleInput(CTRL_D);
    expect(screen().join("\n")).toContain("› ✗ task 4");
    expect(screen().join("\n")).toContain("worker: error 4");
    view.handleInput(CTRL_U);
    expect(screen().join("\n")).toContain("› ✗ task 1");
  });

  it("scrolls the detail of a long report and stops at both ends", () => {
    const report = Array.from({ length: 40 }, (_, index) => `step ${index + 1}`).join("\n");
    const { view, screen } = setup({
      tasks: [
        task("long", {
          status: "completed",
          reports: [
            {
              id: "r1",
              taskId: "long",
              threadId: "th-worker",
              role: "worker",
              status: "completed",
              content: report,
              createdAt: 0,
            },
          ],
        }),
      ],
      maxHeight: 12,
      state: { showFinished: true },
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
  });

  it("scrolls the detail by lines and half pages", () => {
    const report = Array.from({ length: 40 }, (_, index) => `step ${index + 1}`).join("\n");
    const long = task("long", {
      status: "completed",
      reports: [
        {
          id: "r1",
          taskId: "long",
          threadId: "th-worker",
          role: "worker",
          status: "completed",
          content: report,
          createdAt: 0,
        },
      ],
    });
    const { view, screen } = setup({
      tasks: [long],
      maxHeight: 12,
      state: { showFinished: true },
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
  });

  it("pulls the detail window back when the report shrinks", () => {
    const long = task("long", {
      status: "completed",
      currentState: "",
      goalState: "",
      reports: [
        {
          id: "r1",
          taskId: "long",
          threadId: "th-worker",
          role: "worker",
          status: "completed",
          content: Array.from({ length: 40 }, (_, index) => `step ${index + 1}`).join("\n"),
          createdAt: 0,
        },
      ],
    });
    const { view, screen } = setup({
      tasks: [long],
      maxHeight: 12,
      state: { showFinished: true },
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
  });

  it("pulls the list back when finished tasks are collapsed", () => {
    const finished = failedTasks(10).map((entry) => ({
      ...entry,
      status: "completed" as const,
    }));
    const { view, screen } = setup({
      tasks: [...finished, ...failedTasks(2).map((entry) => ({ ...entry, round: "next" }))],
      maxHeight: 12,
      state: { showFinished: true },
    });
    for (let step = 0; step < 10; step++) view.handleInput(DOWN);
    expect(screen().join("\n")).toContain("↑");

    view.handleInput("c");
    const collapsed = screen();
    expect(collapsed.length).toBeLessThanOrEqual(12);
    expect(collapsed.join("\n")).toContain("› ✗ task 1");
    expect(collapsed.join("\n")).toContain("worker: error 2");
  });

  it("keeps the replan line under the title while the list scrolls", () => {
    const { screen } = setup({ tasks: failedTasks(12), maxHeight: 12 });
    const lines = screen();
    expect(lines.length).toBeLessThanOrEqual(12);
    expect(lines.join("\n")).toContain("↺ the api moved to v3");
    expect(lines.join("\n")).toContain("↓");
  });

  it("stays inside the screen when the composer adds footer lines", () => {
    const { view, screen } = setup({ tasks: failedTasks(12), maxHeight: 10 });
    view.handleInput("n");
    const composing = screen();
    expect(composing.length).toBeLessThanOrEqual(10);
    expect(composing.join("\n")).toContain("Message to this task");
  });
});

describe("TasksView scrolling order", () => {
  it("moves the cursor in the order the list draws, dependencies first", () => {
    const { view, screen } = setup({
      tasks: [
        task("c", { title: "task c", dependsOn: ["b"] }),
        task("b", { title: "task b", dependsOn: ["a"] }),
        task("a", { title: "task a" }),
      ],
      maxHeight: 12,
      replans: [],
    });
    expect(screen().join("\n")).toContain("› ○ task a");
    view.handleInput(DOWN);
    expect(screen().join("\n")).toContain("› ○ task b");
    view.handleInput(PAGE_DOWN);
    expect(screen().join("\n")).toContain("› ○ task c");
    view.handleInput(PAGE_DOWN);
    expect(screen().join("\n")).toContain("› ○ task c");
    view.handleInput(PAGE_UP);
    expect(screen().join("\n")).toContain("› ○ task a");
    expect(screen().join("\n")).toContain(" main");
    expect(screen().join("\n")).not.toContain("↑");
  });
});

describe("TasksView dependencies", () => {
  it("lists each dependency on its own line with its status", () => {
    const { view, screen } = setup({
      initialId: "d",
      tasks: [
        task("a", { title: "task a", status: "completed" }),
        task("b", { title: "task b", status: "running" }),
        task("c", { title: "task c", status: "waiting" }),
        task("d", { title: "task d", dependsOn: ["a", "b", "c"] }),
      ],
    });
    view.handleInput(ENTER);
    const rows = screen().map((line) => line.trim());
    const heading = rows.indexOf("Depends on");
    expect(heading).toBeGreaterThan(-1);
    expect(rows.slice(heading + 1, heading + 4)).toEqual(["✓ task a", "● task b", "○ task c"]);
  });

  it("wraps a long dependency title inside the frame", () => {
    const title =
      "a very long dependency title that does not fit on one line and has to wrap instead of overflowing";
    const { view, screen } = setup({
      initialId: "d",
      tasks: [
        task("a", { title, status: "completed" }),
        task("d", { title: "task d", dependsOn: ["a"] }),
      ],
    });
    view.handleInput(ENTER);
    const lines = screen();
    expect(lines.every((line) => line.length <= 120)).toBe(true);
    const wrapped = lines.filter((line) => line.includes("instead of overflowing"));
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0]?.startsWith("   ")).toBe(true);
    expect(lines.join("\n")).toContain("a very long dependency title");
  });

  it("scrolls the detail when many dependencies outgrow the screen", () => {
    const dependencies = Array.from({ length: 30 }, (_, index) =>
      task(`dep-${index + 1}`, { title: `dependency ${index + 1}`, status: "completed" }),
    );
    const { view, screen } = setup({
      initialId: "d",
      tasks: [
        ...dependencies,
        task("d", { title: "task d", dependsOn: dependencies.map((e) => e.id) }),
      ],
      maxHeight: 12,
      state: { showFinished: true },
    });
    view.handleInput(ENTER);
    expect(screen().length).toBeLessThanOrEqual(12);
    expect(screen().join("\n")).toContain("dependency 1");
    expect(screen().join("\n")).not.toContain("dependency 30");

    for (let step = 0; step < 10; step++) view.handleInput(PAGE_DOWN);
    expect(screen().length).toBeLessThanOrEqual(12);
    expect(screen().join("\n")).toContain("dependency 30");
    expect(screen().join("\n")).not.toContain("dependency 1");
  });
});

describe("TasksView ids", () => {
  it("shows a short id in the list and the full id in the detail", () => {
    const id = "01a1518a-ff46-75e6-90be-7024913caa86";
    const { view, screen } = setup({
      initialId: id,
      tasks: [task(id, { title: "watch the release", status: "running" })],
    });
    expect(screen().join("\n")).toContain("01a1518a  flash");
    expect(screen().join("\n")).not.toContain(id);

    view.handleInput(ENTER);
    expect(screen().join("\n")).toContain(`id  ${id}`);
  });

  it("shows an id that already fits the row whole", () => {
    const { screen } = setup({
      tasks: [task("t-mvejhav4-1", { title: "task with a readable id" })],
    });
    expect(screen().join("\n")).toContain("t-mvejhav4-1  flash");
  });

  it("leaves the id column out before a task has an id", () => {
    const { screen } = setup({ tasks: [task("", { title: "not started" })] });
    const row = screen().find((line) => line.includes("not started"));
    expect(row).toBeDefined();
    expect(row).not.toContain("undefined");
    expect(row?.trimEnd()).toMatch(/not started +flash$/);
  });
});
