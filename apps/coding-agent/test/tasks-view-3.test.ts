import tui from "@msa/tui";
import { beforeAll, describe, expect, it } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import tasksViewHarness from "./tasks-view-harness.ts";
import tasksViewSupport from "./tasks-view-support.ts";

const { setKeybindings } = tui;

const { DOWN, ENTER, PAGE_DOWN, PAGE_UP } = tasksViewSupport;

const { setup, task } = tasksViewHarness;

beforeAll(() => {
  initTheme(undefined, false);
  setKeybindings(new KeybindingsManager());
});

const movesTheCursorInTheOrderThe = () => {
  const { view, screen } = setup({
    maxHeight: 12,
    replans: [],
    tasks: [
      task("c", { dependsOn: ["b"], title: "task c" }),
      task("b", { dependsOn: ["a"], title: "task b" }),
      task("a", { title: "task a" }),
    ],
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
};

describe("TasksView scrolling order", () => {
  it(
    "moves the cursor in the order the list draws, dependencies first",
    movesTheCursorInTheOrderThe,
  );
});

const listsEachDependencyOnItsOwnLine = () => {
  const { view, screen } = setup({
    initialId: "d",
    tasks: [
      task("a", { status: "completed", title: "task a" }),
      task("b", { status: "running", title: "task b" }),
      task("c", { status: "waiting", title: "task c" }),
      task("d", { dependsOn: ["a", "b", "c"], title: "task d" }),
    ],
  });
  view.handleInput(ENTER);
  const rows = screen().map((line) => line.trim());
  const heading = rows.indexOf("Depends on");
  expect(heading).toBeGreaterThan(-1);
  expect(rows.slice(heading + 1, heading + 4)).toEqual(["✓ task a", "● task b", "○ task c"]);
};

const wrapsALongDependencyTitleInsideThe = () => {
  const title =
    "a very long dependency title that does not fit on one line and has to wrap instead of overflowing";
  const { view, screen } = setup({
    initialId: "d",
    tasks: [
      task("a", { status: "completed", title }),
      task("d", { dependsOn: ["a"], title: "task d" }),
    ],
  });
  view.handleInput(ENTER);
  const lines = screen();
  expect(lines.every((line) => line.length <= 120)).toBe(true);
  const wrapped = lines.filter((line) => line.includes("instead of overflowing"));
  expect(wrapped).toHaveLength(1);
  expect(wrapped[0]?.startsWith("   ")).toBe(true);
  expect(lines.join("\n")).toContain("a very long dependency title");
};

const scrollsTheDetailWhenManyDependenciesOutgrow = () => {
  const dependencies = Array.from({ length: 30 }, (_, index) =>
    task(`dep-${index + 1}`, { status: "completed", title: `dependency ${index + 1}` }),
  );
  const { view, screen } = setup({
    initialId: "d",
    maxHeight: 12,
    state: { showFinished: true },
    tasks: [
      ...dependencies,
      task("d", { dependsOn: dependencies.map((e) => e.id), title: "task d" }),
    ],
  });
  view.handleInput(ENTER);
  expect(screen().length).toBeLessThanOrEqual(12);
  expect(screen().join("\n")).toContain("dependency 1");
  expect(screen().join("\n")).not.toContain("dependency 30");

  for (let step = 0; step < 10; step++) view.handleInput(PAGE_DOWN);
  expect(screen().length).toBeLessThanOrEqual(12);
  expect(screen().join("\n")).toContain("dependency 30");
  expect(screen().join("\n")).not.toContain("dependency 1");
};

describe("TasksView dependencies", () => {
  it("lists each dependency on its own line with its status", listsEachDependencyOnItsOwnLine);

  it("wraps a long dependency title inside the frame", wrapsALongDependencyTitleInsideThe);

  it(
    "scrolls the detail when many dependencies outgrow the screen",
    scrollsTheDetailWhenManyDependenciesOutgrow,
  );
});

const showsAShortIdInTheList = () => {
  const id = "01a1518a-ff46-75e6-90be-7024913caa86";
  const { view, screen } = setup({
    initialId: id,
    tasks: [task(id, { status: "running", title: "watch the release" })],
  });
  expect(screen().join("\n")).toContain("01a1518a  flash");
  expect(screen().join("\n")).not.toContain(id);

  view.handleInput(ENTER);
  expect(screen().join("\n")).toContain(`id  ${id}`);
};

const showsAnIdThatAlreadyFitsThe = () => {
  const { screen } = setup({
    tasks: [task("t-mvejhav4-1", { title: "task with a readable id" })],
  });
  expect(screen().join("\n")).toContain("t-mvejhav4-1  flash");
};

const leavesTheIdColumnOutBeforeA = () => {
  const { screen } = setup({ tasks: [task("", { title: "not started" })] });
  const row = screen().find((line) => line.includes("not started"));
  expect(row).toBeDefined();
  expect(row).not.toContain("undefined");
  expect(row?.trimEnd()).toMatch(/not started +flash$/u);
};

describe("TasksView ids", () => {
  it("shows a short id in the list and the full id in the detail", showsAShortIdInTheList);

  it("shows an id that already fits the row whole", showsAnIdThatAlreadyFitsThe);

  it("leaves the id column out before a task has an id", leavesTheIdColumnOutBeforeA);
});
