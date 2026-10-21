import tui from "@msa/tui";
import type tuiTypes from "@msa/tui/index.types";

import textModule from "../../../utils/text.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import scrollWindow from "./scroll-window.ts";
import tasksList from "./tasks-list.ts";
import tasksViewHelpers from "./tasks-view-helpers.ts";
import type threadPaneTypes from "./thread-pane.types.ts";
import threadTaskSummary from "./thread-task-summary.ts";

const { taskList } = tasksList;
const { theme } = themeModule;
const { keyHint } = keybindingHints;
const { lineWindow } = scrollWindow;
const { formatAge, shortId } = textModule;
const { viewHelpers } = tasksViewHelpers;

const { truncateToWidth } = tui;

type Task = ReturnType<typeof taskList.shownTasks>[number];

const ROW_LINES = 2;

export default class ThreadPane implements tuiTypes.Component {
  private readonly options: threadPaneTypes.ThreadPaneOptions;

  constructor(options: threadPaneTypes.ThreadPaneOptions) {
    this.options = options;
  }

  invalidate(): void {}

  render(width: number): string[] {
    const orchestrator = this.options.orchestrator();
    if (orchestrator === undefined) return [];
    const safeWidth = Math.max(1, width);
    const height = Math.max(1, this.options.height());
    const tasks = taskList.shownTasks(orchestrator, this.options.state);
    const selected = taskList.selectedTask(orchestrator, this.options.state);
    const header = [
      truncateToWidth(` ${theme.bold("Threads")}`, safeWidth),
      theme.fg("borderMuted", "─".repeat(safeWidth)),
    ];
    const footer = [truncateToWidth(` ${keyHint("app.orchestrator.threads", "open")}`, safeWidth)];
    const room = Math.max(0, height - header.length - footer.length);
    const listRoom = Math.min(tasks.length, Math.floor(room / 2 / ROW_LINES)) * ROW_LINES;
    const list = this.list(tasks, selected, safeWidth, listRoom);
    const detail = threadTaskSummary.taskSummary(
      orchestrator,
      selected,
      safeWidth,
      room - list.length,
    );
    const body = [...header, ...list, ...detail];
    const gap = Math.max(0, height - body.length - footer.length);
    return [...body, ...Array.from({ length: gap }, () => ""), ...footer].slice(0, height);
  }

  private list(
    tasks: readonly Task[],
    selected: Task | undefined,
    width: number,
    room: number,
  ): string[] {
    const visible = Math.floor(room / ROW_LINES);
    if (visible === 0) return [];
    const index = selected === undefined ? 0 : Math.max(0, tasks.indexOf(selected));
    const { offset } = lineWindow(tasks.length, visible, 0, index);
    return tasks.slice(offset, offset + visible).flatMap((task) => {
      const meta = [
        shortId(task.id),
        viewHelpers.modelName(task.model ?? "default"),
        formatAge(task.updatedAt),
      ];
      return [
        taskList.taskRow(task, { meta: () => "", selected: task.id === selected?.id, width }),
        truncateToWidth(`     ${theme.fg("dim", meta.join(" · "))}`, width),
      ];
    });
  }
}
