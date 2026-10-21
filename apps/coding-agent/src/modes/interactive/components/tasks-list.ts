import tui from "@msa/tui";

import type orchestratorTypes from "../../../core/orchestrator/orchestrator.types.ts";
import type orchestratorTypesTypes from "../../../core/orchestrator/types.types.ts";
import themeModule from "../theme/theme.ts";
import type tasksListTypes from "./tasks-list.types.ts";
import tasksViewHelpers from "./tasks-view-helpers.ts";
import type tasksViewHelpersTypes from "./tasks-view-helpers.types.ts";

const { viewHelpers } = tasksViewHelpers;
const { theme } = themeModule;

const { truncateToWidth, visibleWidth } = tui;

const { finished, glyph, roundTasks } = viewHelpers;

function shownTasks(
  orchestrator: orchestratorTypes.Orchestrator,
  state: tasksViewHelpersTypes.TasksViewState,
): orchestratorTypesTypes.TaskSnapshot[] {
  const tasks = orchestrator.snapshot.tasks;
  return orchestrator.snapshot.rounds.flatMap((round) =>
    roundTasks(tasks, round.id).filter((task) => state.showFinished || !finished(task)),
  );
}

function selectedTask(
  orchestrator: orchestratorTypes.Orchestrator,
  state: tasksViewHelpersTypes.TasksViewState,
): orchestratorTypesTypes.TaskSnapshot | undefined {
  const shown = shownTasks(orchestrator, state);
  return shown.find((task) => task.id === state.selectedId) ?? shown[0];
}

function selectedIndex(
  state: tasksViewHelpersTypes.TasksViewState,
  tasks: readonly orchestratorTypesTypes.TaskSnapshot[],
): number {
  return Math.max(
    0,
    tasks.findIndex((task) => task.id === state.selectedId),
  );
}

function moveSelection(
  state: tasksViewHelpersTypes.TasksViewState,
  tasks: readonly orchestratorTypesTypes.TaskSnapshot[],
  step: number,
): void {
  if (tasks.length === 0) return;
  const index = selectedIndex(state, tasks);
  state.selectedId = tasks[(index + step + tasks.length) % tasks.length]?.id;
}

function moveSelectionBy(
  state: tasksViewHelpersTypes.TasksViewState,
  tasks: readonly orchestratorTypesTypes.TaskSnapshot[],
  step: number,
): void {
  if (tasks.length === 0) return;
  const index = selectedIndex(state, tasks);
  state.selectedId = tasks[Math.max(0, Math.min(index + step, tasks.length - 1))]?.id;
}

function taskRow(
  task: orchestratorTypesTypes.TaskSnapshot,
  options: tasksListTypes.TaskRowOptions,
): string {
  const cursor = options.selected ? theme.fg("accent", "›") : " ";
  const title = options.selected ? theme.bold(task.title) : task.title;
  const mark = task.replan === null ? "" : ` ${theme.fg("muted", "↺")}`;
  const meta = theme.fg("dim", options.meta(task));
  const left = ` ${cursor} ${glyph(task)} ${title}${mark}`;
  const gap = Math.max(2, options.width - visibleWidth(left) - visibleWidth(meta) - 1);
  return truncateToWidth(`${left}${" ".repeat(gap)}${meta}`, options.width);
}

const taskList = {
  moveSelection,
  moveSelectionBy,
  selectedTask,
  shownTasks,
  taskRow,
};

const tasksList = {
  taskList,
};

export default tasksList;
