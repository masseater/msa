import type agentTypes from "@msa/agent-core/index.types";
import type aiTypes from "@msa/ai/index.types";
import tui from "@msa/tui";

import type extensionsTypesTypes from "../../../core/extensions/types.types.ts";
import type orchestratorTypes from "../../../core/orchestrator/orchestrator.types.ts";
import textModule from "../../../core/orchestrator/text.ts";
import type orchestratorTypesTypes from "../../../core/orchestrator/types.types.ts";
import renderUtils from "../../../core/tools/render-utils.ts";
import themeModule from "../theme/theme.ts";
import type tasksViewHelpersTypes from "./tasks-view-helpers.types.ts";

const { theme } = themeModule;
const { formatToolCallWithArgs } = renderUtils;
const { firstLine } = textModule;

const { Text } = tui;

function createTasksViewState(): tasksViewHelpersTypes.TasksViewState {
  return { showFinished: false };
}

const STATUS_LABEL: Record<orchestratorTypesTypes.TaskStatus, string> = {
  completed: "Done",
  failed: "Failed",
  running: "Running",
  stopped: "Stopped",
  waiting: "Waiting",
};

interface Glyph {
  color: Parameters<typeof theme.fg>[0];
  symbol: string;
}

const TASK_GLYPH: Record<orchestratorTypesTypes.TaskStatus, Glyph> = {
  completed: { color: "success", symbol: "✓" },
  failed: { color: "error", symbol: "✗" },
  running: { color: "accent", symbol: "●" },
  stopped: { color: "dim", symbol: "■" },
  waiting: { color: "muted", symbol: "○" },
};

const REPORT_GLYPH: Record<orchestratorTypes.ReportStatus, Glyph> = {
  completed: TASK_GLYPH.completed,
  failed: TASK_GLYPH.failed,
  "sent-back": TASK_GLYPH.running,
  stopped: TASK_GLYPH.stopped,
  waiting: TASK_GLYPH.waiting,
};

function paint({ color, symbol }: Glyph): string {
  return theme.fg(color, symbol);
}

function glyph(task: orchestratorTypesTypes.TaskSnapshot): string {
  if (task.kind === "review") {
    const color =
      task.status === "failed" ? "error" : task.status === "running" ? "accent" : "muted";
    return theme.fg(color, "◆");
  }
  return paint(TASK_GLYPH[task.status]);
}

function finished(task: orchestratorTypesTypes.TaskSnapshot): boolean {
  return task.status === "completed" || task.status === "stopped";
}

function stoppable(task: orchestratorTypesTypes.TaskSnapshot): boolean {
  return task.status === "running" || task.status === "waiting";
}

function modelName(reference: string): string {
  const slash = reference.indexOf("/");
  return slash === -1 ? reference : reference.slice(slash + 1);
}

function activityLines(messages: readonly agentTypes.AgentMessage[]): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of (message as aiTypes.AssistantMessage).content) {
      if (part.type === "toolCall") {
        lines.push(formatToolCallWithArgs(part.name, part.arguments, theme, false));
      } else if (part.type === "text" && part.text.trim() !== "") {
        lines.push(firstLine(part.text));
      }
    }
  }
  return lines;
}

function depthOf(
  task: orchestratorTypesTypes.TaskSnapshot,
  byId: ReadonlyMap<string, orchestratorTypesTypes.TaskSnapshot>,
  seen = new Set<string>(),
): number {
  if (seen.has(task.id)) return 0;
  seen.add(task.id);
  const parents = task.dependsOn.flatMap((id) => byId.get(id) ?? []);
  return parents.length === 0
    ? 0
    : Math.max(...parents.map((parent) => depthOf(parent, byId, seen) + 1));
}

function roundTasks(
  tasks: readonly orchestratorTypesTypes.TaskSnapshot[],
  round: string,
): orchestratorTypesTypes.TaskSnapshot[] {
  const inRound = tasks.filter((task) => task.round === round);
  const byId = new Map(inRound.map((task) => [task.id, task]));
  return [...inRound].sort(
    (left, right) => depthOf(left, byId) - depthOf(right, byId) || left.createdAt - right.createdAt,
  );
}

function describeReplan(replan: orchestratorTypesTypes.ReplanView): string {
  const counts = [
    replan.stopped.length > 0 ? `${replan.stopped.length} stopped` : undefined,
    replan.created.length > 0 ? `${replan.created.length} created` : undefined,
    replan.dropped.length > 0 ? `${replan.dropped.length} dropped` : undefined,
    replan.kept.length > 0 ? `${replan.kept.length} kept` : undefined,
  ].filter(Boolean);
  return `↺ ${replan.reason}  ${counts.join(" · ")}`;
}

function describeTaskCounts(
  tasks: readonly orchestratorTypesTypes.TaskSnapshot[],
): string | undefined {
  if (tasks.length === 0) return undefined;
  const count = (status: orchestratorTypesTypes.TaskStatus) =>
    tasks.filter((task) => task.status === status).length;
  const parts = [
    [count("running"), theme.fg("accent", "●"), "running"],
    [count("waiting"), theme.fg("muted", "○"), "waiting"],
    [count("failed"), theme.fg("error", "✗"), "failed"],
    [count("completed"), theme.fg("success", "✓"), "done"],
    [count("stopped"), theme.fg("dim", "■"), "stopped"],
  ] as const;
  return parts
    .filter(([value]) => value > 0)
    .map(([value, icon, label]) => `${icon} ${value} ${label}`)
    .join("  ");
}

function createTaskReportRenderer(
  orchestrator: orchestratorTypes.Orchestrator | undefined,
): extensionsTypesTypes.MessageRenderer<orchestratorTypes.OrchestratorReport> {
  return (message, { expanded, outputPad }) => {
    const details = message.details;
    if (details === undefined) return undefined;
    const title =
      orchestrator?.tasks.find((task) => task.id === details.taskId)?.title ?? details.taskId;
    const started =
      details.started.length > 0
        ? theme.fg("muted", ` · started ${details.started.join(", ")}`)
        : "";
    const lines = [
      `${paint(REPORT_GLYPH[details.status])} ${theme.bold(title)} ${theme.fg("muted", details.role)} ${details.status}${started}`,
    ];
    const content = typeof message.content === "string" ? message.content : "";
    const report = /<report>\n([\s\S]*)\n<\/report>/u.exec(content)?.[1];
    if (expanded && report !== undefined) {
      lines.push(...report.split("\n").map((line) => theme.fg("toolOutput", `  ${line}`)));
    } else if (report !== undefined) {
      lines.push(theme.fg("dim", `  ${firstLine(report)}`));
    }
    return new Text(lines.join("\n"), outputPad, 0);
  };
}

const viewHelpers = {
  STATUS_LABEL,
  activityLines,
  createTasksViewState,
  depthOf,
  describeReplan,
  describeTaskCounts,
  finished,
  glyph,
  modelName,
  roundTasks,
  stoppable,
};

const tasksViewHelpers = {
  createTaskReportRenderer,
  viewHelpers,
};

export default tasksViewHelpers;
