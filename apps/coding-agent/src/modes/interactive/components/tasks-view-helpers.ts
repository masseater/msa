import type { AgentMessage } from "@msa/agent-core";
import type { AssistantMessage } from "@msa/ai";
import { Text } from "@msa/tui";

import type { MessageRenderer } from "../../../core/extensions/types.ts";
import type { Orchestrator, OrchestratorReport } from "../../../core/orchestrator/orchestrator.ts";
import { firstLine } from "../../../core/orchestrator/text.ts";
import type { TaskSnapshot, TaskStatus } from "../../../core/orchestrator/types.ts";
import { formatToolCallWithArgs } from "../../../core/tools/render-utils.ts";
import { theme } from "../theme/theme.ts";

export interface TasksViewState {
  showFinished: boolean;
}

function createTasksViewState(): TasksViewState {
  return { showFinished: false };
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  failed: "Failed",
  running: "Running",
  waiting: "Waiting",
  completed: "Done",
  stopped: "Stopped",
};

function glyph(task: TaskSnapshot): string {
  if (task.kind === "review") {
    const color =
      task.status === "failed" ? "error" : task.status === "running" ? "accent" : "muted";
    return theme.fg(color, "◆");
  }
  switch (task.status) {
    case "failed":
      return theme.fg("error", "✗");
    case "running":
      return theme.fg("accent", "●");
    case "waiting":
      return theme.fg("muted", "○");
    case "completed":
      return theme.fg("success", "✓");
    case "stopped":
      return theme.fg("dim", "■");
  }
}

function finished(task: TaskSnapshot): boolean {
  return task.status === "completed" || task.status === "stopped";
}

function stoppable(task: TaskSnapshot): boolean {
  return task.status === "running" || task.status === "waiting";
}

function modelName(reference: string): string {
  const slash = reference.indexOf("/");
  return slash === -1 ? reference : reference.slice(slash + 1);
}

function activityLines(messages: readonly AgentMessage[]): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const part of (message as AssistantMessage).content) {
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
  task: TaskSnapshot,
  byId: ReadonlyMap<string, TaskSnapshot>,
  seen = new Set<string>(),
): number {
  if (seen.has(task.id)) return 0;
  seen.add(task.id);
  const parents = task.dependsOn.flatMap((id) => byId.get(id) ?? []);
  return parents.length === 0
    ? 0
    : Math.max(...parents.map((parent) => depthOf(parent, byId, seen) + 1));
}

function roundTasks(tasks: readonly TaskSnapshot[], round: string): TaskSnapshot[] {
  const inRound = tasks.filter((task) => task.round === round);
  const byId = new Map(inRound.map((task) => [task.id, task]));
  return [...inRound].sort(
    (left, right) => depthOf(left, byId) - depthOf(right, byId) || left.createdAt - right.createdAt,
  );
}

function describeTaskCounts(tasks: readonly TaskSnapshot[]): string | undefined {
  if (tasks.length === 0) return undefined;
  const count = (status: TaskStatus) => tasks.filter((task) => task.status === status).length;
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

export function createTaskReportRenderer(
  orchestrator: Orchestrator | undefined,
): MessageRenderer<OrchestratorReport> {
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
      `${glyph({ status: details.status, kind: "work" } as TaskSnapshot)} ${theme.bold(title)} ${theme.fg("muted", details.role)} ${details.status}${started}`,
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

export const viewHelpers = {
  STATUS_LABEL,
  glyph,
  finished,
  stoppable,
  modelName,
  activityLines,
  depthOf,
  roundTasks,
  describeTaskCounts,
  createTasksViewState,
};
