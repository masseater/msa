import { truncateToWidth } from "@msa/tui";

import { firstLine } from "../../../core/orchestrator/text.ts";
import { formatToolDuration } from "../../../core/tools/render-utils.ts";

import type { Orchestrator } from "../../../core/orchestrator/orchestrator.ts";
import type { TaskSnapshot } from "../../../core/orchestrator/types.ts";
import { theme } from "../theme/theme.ts";
import { keyHint } from "./keybinding-hints.ts";
import { viewHelpers } from "./tasks-view-helpers.ts";
import { truncateToVisualLines } from "./visual-truncate.ts";

const { activityLines, modelName, stoppable } = viewHelpers;

function reasonLine(orchestrator: Orchestrator, task: TaskSnapshot): string {
  if (task.waitingReason !== null) return task.waitingReason.detail;
  if (task.status === "running") {
    const active = task.assignments.at(-1);
    if (active !== undefined) {
      const { startedAt, retrying } = orchestrator.progress(active.sessionId);
      const doing = activityLines(orchestrator.messages(active.sessionId)).at(-1);
      const elapsed = startedAt === undefined ? "" : ` ${formatToolDuration(performance.now() - startedAt)}`;
      return `${active.role}${elapsed} ${retrying ? "retrying" : (doing ?? "")}`.trim();
    }
  }
  const last = task.reports.at(-1);
  return last === undefined ? "" : `${last.role}: ${firstLine(last.content)}`;
}

function sessionLines(orchestrator: Orchestrator, task: TaskSnapshot): string[] {
  return task.assignments.map((assignment) => {
    const session = orchestrator.snapshot.sessions.find(
      (candidate) => candidate.id === assignment.sessionId,
    );
    const model = session === undefined ? "?" : `${modelName(session.model)}/${session.thinkingLevel}`;
    return `${assignment.role} ${assignment.sessionId} (${model}) ${session?.status ?? "?"}`;
  });
}

function sections(orchestrator: Orchestrator, task: TaskSnapshot, width: number): string[] {
  const lines: string[] = [];
  const section = (title: string) => lines.push("", theme.fg("accent", ` ${title}`));
  const body = (text: string, limit: number) => {
    const { visualLines, skippedCount } = truncateToVisualLines(text, limit, width - 3);
    if (skippedCount > 0) lines.push(theme.fg("dim", `   … ${skippedCount} more lines`));
    lines.push(...visualLines.map((line) => `   ${line}`));
  };
  if (task.waitingReason !== null) {
    section("Waiting");
    lines.push(`   ${task.waitingReason.detail}`);
  }
  if (task.dependsOn.length > 0) {
    section("Depends on");
    lines.push(`   ${task.dependsOn.join("   ")}`);
  }
  if (task.dependents.length > 0) {
    section("Dependents");
    lines.push(`   ${task.dependents.join("   ")}`);
  }
  const sessions = sessionLines(orchestrator, task);
  if (sessions.length > 0) {
    section("Sessions");
    for (const line of sessions) lines.push(truncateToWidth(`   ${line}`, width));
  }
  const active = task.assignments.at(-1);
  if (active !== undefined) {
    const activity = activityLines(orchestrator.messages(active.sessionId));
    if (activity.length > 0) {
      section("Activity");
      for (const line of activity.slice(-8)) lines.push(truncateToWidth(`   ${line}`, width));
    }
  }
  const last = task.reports.at(-1);
  if (last !== undefined) {
    section(last.status === "failed" ? "Error" : "Report");
    body(last.content, 12);
  }
  if (task.prompt !== "") {
    section("Task");
    body(task.prompt, 6);
  }
  return lines;
}

function hints(task: TaskSnapshot): string {
  return ` ${[
    keyHint("app.orchestrator.message", task.status === "running" ? "steer" : "message"),
    keyHint("app.orchestrator.note", "note to round"),
    stoppable(task) ? keyHint("app.orchestrator.stop", "stop") : undefined,
    keyHint("app.orchestrator.priority", "priority"),
    keyHint("app.orchestrator.model", "model"),
    keyHint("app.orchestrator.rerun", "rerun"),
    keyHint("tui.select.cancel", "back"),
  ]
    .filter(Boolean)
    .join("  ")}`;
}

export const taskDetail = { reasonLine, sessionLines, sections, hints };
