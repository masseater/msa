import { setKeybindings } from "@msa/tui";
import { beforeAll, expect, it } from "vite-plus/test";

import { KeybindingsManager } from "../src/core/keybindings.ts";
import { viewHelpers } from "../src/modes/interactive/components/tasks-view-helpers.ts";
import { initTheme } from "../src/modes/interactive/theme/theme.ts";
import { setup, TASKS } from "./tasks-view-harness.ts";

const ENTER = "\r";
const ESC = "\x1b";

beforeAll(() => {
  initTheme(undefined, false);
  setKeybindings(new KeybindingsManager());
});

it("shows the round DAG, statuses, waiting reasons, and worker/reviewer sessions", () => {
  const { screen } = setup();
  const text = screen().join("\n");
  expect(text).toContain("main");
  expect(text).toContain("waiting for a");
  expect(text).toContain("Review of main");
  expect(text).toContain("writing a.ts");
  expect(screen().some((line) => line.includes("  ○ b"))).toBe(true);
});

it("opens a task and shows its prompt, reports, and sessions", () => {
  const { view, screen } = setup({ initialId: "c", state: { showFinished: true } });
  view.handleInput(ENTER);
  const text = screen().join("\n");
  expect(text).toContain("do c");
  expect(text).toContain("c is done");
  expect(text).toContain("worker s-worker (flash/low) running");
  expect(text).toContain("reviewer s-review (fable/high) completed");
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

it("changes priority, stops, and reruns the selected task", () => {
  const { view, orchestrator } = setup({ initialId: "b" });
  view.handleInput("p");
  view.handleInput("5");
  view.handleInput(ENTER);
  expect(orchestrator.setPriority).toHaveBeenCalledWith("b", 5);
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
