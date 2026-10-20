import tui from "@msa/tui";

import type { Orchestrator } from "../../../core/orchestrator/orchestrator.ts";
import type { TaskSnapshot } from "../../../core/orchestrator/types.ts";
import { theme } from "../theme/theme.ts";
import { type TasksViewState, viewHelpers } from "./tasks-view-helpers.ts";

const { truncateToWidth, visibleWidth } = tui;

const { finished, glyph, roundTasks } = viewHelpers;

function shownTasks(orchestrator: Orchestrator, state: TasksViewState): TaskSnapshot[] {
  const tasks = orchestrator.snapshot.tasks;
  return orchestrator.snapshot.rounds.flatMap((round) =>
    roundTasks(tasks, round.id).filter((task) => state.showFinished || !finished(task)),
  );
}

function selectedTask(orchestrator: Orchestrator, state: TasksViewState): TaskSnapshot | undefined {
  const shown = shownTasks(orchestrator, state);
  return shown.find((task) => task.id === state.selectedId) ?? shown[0];
}

function selectedIndex(state: TasksViewState, tasks: readonly TaskSnapshot[]): number {
  return Math.max(
    0,
    tasks.findIndex((task) => task.id === state.selectedId),
  );
}

function moveSelection(state: TasksViewState, tasks: readonly TaskSnapshot[], step: number): void {
  if (tasks.length === 0) return;
  const index = selectedIndex(state, tasks);
  state.selectedId = tasks[(index + step + tasks.length) % tasks.length]?.id;
}

function moveSelectionBy(
  state: TasksViewState,
  tasks: readonly TaskSnapshot[],
  step: number,
): void {
  if (tasks.length === 0) return;
  const index = selectedIndex(state, tasks);
  state.selectedId = tasks[Math.max(0, Math.min(index + step, tasks.length - 1))]?.id;
}

export interface TaskRowOptions {
  selected: boolean;
  width: number;
  meta: (task: TaskSnapshot) => string;
}

function taskRow(task: TaskSnapshot, options: TaskRowOptions): string {
  const cursor = options.selected ? theme.fg("accent", "›") : " ";
  const title = options.selected ? theme.bold(task.title) : task.title;
  const mark = task.replan === null ? "" : ` ${theme.fg("muted", "↺")}`;
  const meta = theme.fg("dim", options.meta(task));
  const left = ` ${cursor} ${glyph(task)} ${title}${mark}`;
  const gap = Math.max(2, options.width - visibleWidth(left) - visibleWidth(meta) - 1);
  return truncateToWidth(`${left}${" ".repeat(gap)}${meta}`, options.width);
}

export const taskList = {
  moveSelection,
  moveSelectionBy,
  selectedTask,
  shownTasks,
  taskRow,
};
