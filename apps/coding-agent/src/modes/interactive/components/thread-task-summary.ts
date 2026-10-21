import tui from "@msa/tui";

import type orchestratorTypes from "../../../core/orchestrator/orchestrator.types.ts";
import orchestratorText from "../../../core/orchestrator/text.ts";
import textModule from "../../../utils/text.ts";
import themeModule from "../theme/theme.ts";
import tasksViewDetail from "./tasks-view-detail.ts";
import tasksViewHelpers from "./tasks-view-helpers.ts";

const { theme } = themeModule;
const { formatAge, shortId } = textModule;
const { viewHelpers } = tasksViewHelpers;
const { firstLine } = orchestratorText;
const { truncateToWidth, wrapTextWithAnsi } = tui;

type Task = orchestratorTypes.Orchestrator["snapshot"]["tasks"][number];

const LABEL_WIDTH = 6;

function wrap(text: string, width: number, limit: number): string[] {
  const wrapped = wrapTextWithAnsi(text, Math.max(1, width));
  if (wrapped.length <= limit) return wrapped;
  const shown = wrapped.slice(0, Math.max(1, limit));
  shown[shown.length - 1] = truncateToWidth(`${shown.at(-1) ?? ""}…`, Math.max(1, width));
  return shown;
}

function field(label: string, text: string, width: number, limit: number): string[] {
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

function dependencies(orchestrator: orchestratorTypes.Orchestrator, task: Task): string {
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

function reasonLines(orchestrator: orchestratorTypes.Orchestrator, task: Task, width: number) {
  if (task.waitingReason === null && !(task.status === "running" && task.assignments.length > 0)) {
    return [];
  }
  const reason = tasksViewDetail.taskDetail.reasonLine(orchestrator, task);
  return wrap(reason, width - 3, 2).map((line) =>
    truncateToWidth(`   ${theme.fg("muted", line)}`, width),
  );
}

function reportLines(task: Task, width: number): string[] {
  const report = task.reports.at(-1);
  if (report === undefined || report.status === "stopped") return [];
  const age = theme.fg("dim", formatAge(report.createdAt));
  return field("report", `${age} ${report.role}: ${firstLine(report.content)}`, width, 3);
}

function taskSummary(
  orchestrator: orchestratorTypes.Orchestrator,
  task: Task | undefined,
  width: number,
  room: number,
): string[] {
  if (task === undefined || room < 2) return [];
  const status = viewHelpers.STATUS_LABEL[task.status].toLowerCase();
  const lines = [
    theme.fg("borderMuted", "─".repeat(width)),
    truncateToWidth(` ${viewHelpers.glyph(task)} ${status} · ${task.round}`, width),
    ...reasonLines(orchestrator, task, width),
    ...field("now", firstLine(task.currentState), width, 2),
    ...field("goal", firstLine(task.goalState), width, 2),
    ...(task.dependsOn.length > 0 ? field("deps", dependencies(orchestrator, task), width, 2) : []),
    ...reportLines(task, width),
  ];
  return lines.slice(0, room);
}

const threadTaskSummary = {
  taskSummary,
};

export default threadTaskSummary;
