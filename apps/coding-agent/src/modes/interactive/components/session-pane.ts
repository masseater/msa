import { type Component, truncateToWidth, wrapTextWithAnsi } from "@msa/tui";

import type { Orchestrator } from "../../../core/orchestrator/orchestrator.ts";
import { firstLine } from "../../../core/orchestrator/text.ts";
import type { TaskSnapshot } from "../../../core/orchestrator/types.ts";
import { formatAge, shortId } from "../../../utils/text.ts";
import { theme } from "../theme/theme.ts";
import { keyHint } from "./keybinding-hints.ts";
import { lineWindow } from "./scroll-window.ts";
import { taskList } from "./tasks-list.ts";
import { taskDetail } from "./tasks-view-detail.ts";
import { type TasksViewState, viewHelpers } from "./tasks-view-helpers.ts";

const LABEL_WIDTH = 6;
const ROW_LINES = 2;

export interface SessionPaneOptions {
  orchestrator: () => Orchestrator | undefined;
  state: TasksViewState;
  height: () => number;
}

function wrap(text: string, width: number, limit: number): string[] {
  const wrapped = wrapTextWithAnsi(text, Math.max(1, width));
  if (wrapped.length <= limit) return wrapped;
  const shown = wrapped.slice(0, Math.max(1, limit));
  shown[shown.length - 1] = truncateToWidth(`${shown.at(-1) ?? ""}…`, Math.max(1, width));
  return shown;
}

export class SessionPane implements Component {
  private readonly options: SessionPaneOptions;

  constructor(options: SessionPaneOptions) {
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
      truncateToWidth(` ${theme.bold("Sessions")}`, safeWidth),
      theme.fg("borderMuted", "─".repeat(safeWidth)),
    ];
    const footer = [truncateToWidth(` ${keyHint("app.orchestrator.sessions", "open")}`, safeWidth)];
    const room = Math.max(0, height - header.length - footer.length);
    const listRoom = Math.min(tasks.length, Math.floor(room / 2 / ROW_LINES)) * ROW_LINES;
    const list = this.list(tasks, selected, safeWidth, listRoom);
    const detail = this.detail(orchestrator, selected, safeWidth, room - list.length);
    const body = [...header, ...list, ...detail];
    const gap = Math.max(0, height - body.length - footer.length);
    return [...body, ...Array.from({ length: gap }, () => ""), ...footer].slice(0, height);
  }

  private list(
    tasks: readonly TaskSnapshot[],
    selected: TaskSnapshot | undefined,
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
        taskList.taskRow(task, { selected: task.id === selected?.id, width, meta: () => "" }),
        truncateToWidth(`     ${theme.fg("dim", meta.join(" · "))}`, width),
      ];
    });
  }

  private detail(
    orchestrator: Orchestrator,
    task: TaskSnapshot | undefined,
    width: number,
    room: number,
  ): string[] {
    if (task === undefined || room < 2) return [];
    const status = viewHelpers.STATUS_LABEL[task.status].toLowerCase();
    const lines = [
      theme.fg("borderMuted", "─".repeat(width)),
      truncateToWidth(` ${viewHelpers.glyph(task)} ${status} · ${task.round}`, width),
    ];
    if (task.waitingReason !== null || (task.status === "running" && task.assignments.length > 0)) {
      const reason = taskDetail.reasonLine(orchestrator, task);
      lines.push(
        ...wrap(reason, width - 3, 2).map((line) =>
          truncateToWidth(`   ${theme.fg("muted", line)}`, width),
        ),
      );
    }
    lines.push(...this.field("now", firstLine(task.currentState), width, 2));
    lines.push(...this.field("goal", firstLine(task.goalState), width, 2));
    if (task.dependsOn.length > 0) {
      lines.push(...this.field("deps", this.dependencies(orchestrator, task), width, 2));
    }
    const report = task.reports.at(-1);
    if (report !== undefined && report.status !== "stopped") {
      const age = theme.fg("dim", formatAge(report.createdAt));
      lines.push(
        ...this.field("report", `${age} ${report.role}: ${firstLine(report.content)}`, width, 3),
      );
    }
    return lines.slice(0, room);
  }

  private dependencies(orchestrator: Orchestrator, task: TaskSnapshot): string {
    const byId = new Map(orchestrator.snapshot.tasks.map((entry) => [entry.id, entry]));
    return task.dependsOn
      .map((id) => {
        const dependency = byId.get(id);
        return dependency === undefined
          ? shortId(id)
          : `${viewHelpers.glyph(dependency)} ${dependency.title}`;
      })
      .join("  ");
  }

  private field(label: string, text: string, width: number, limit: number): string[] {
    if (text.trim() === "") return [];
    const contentWidth = Math.max(1, width - LABEL_WIDTH - 2);
    return wrap(text, contentWidth, limit).map((line, index) =>
      truncateToWidth(
        index === 0
          ? ` ${theme.fg("dim", label.padEnd(LABEL_WIDTH))} ${line}`
          : ` ${" ".repeat(LABEL_WIDTH)} ${line}`,
        width,
      ),
    );
  }
}
