import tui from "@msa/tui";

import type Orchestrator from "../../../core/orchestrator/orchestrator.ts";
import type orchestratorTypes from "../../../core/orchestrator/orchestrator.types.ts";
import textModule from "../../../core/orchestrator/text.ts";
import type orchestratorTypesTypes from "../../../core/orchestrator/types.types.ts";
import renderUtils from "../../../core/tools/render-utils.ts";
import themeModule from "../theme/theme.ts";
import keybindingHints from "./keybinding-hints.ts";
import tasksViewHelpers from "./tasks-view-helpers.ts";
import visualTruncate from "./visual-truncate.ts";

const { viewHelpers } = tasksViewHelpers;
const { formatToolDuration } = renderUtils;
const { firstLine } = textModule;
const { theme } = themeModule;
const { truncateToVisualLines } = visualTruncate;
const { keyHint } = keybindingHints;

const { truncateToWidth, wrapTextWithAnsi } = tui;

const { activityLines, glyph, modelName, stoppable } = viewHelpers;

function reasonLine(
  orchestrator: orchestratorTypes.Orchestrator,
  task: orchestratorTypesTypes.TaskSnapshot,
): string {
  if (task.waitingReason !== null) return task.waitingReason.detail;
  if (task.status === "running") {
    const active = task.assignments.at(-1);
    if (active !== undefined) {
      const { startedAt, retrying } = orchestrator.progress(active.threadId);
      const doing = activityLines(orchestrator.messages(active.threadId)).at(-1);
      const elapsed =
        startedAt === undefined ? "" : ` ${formatToolDuration(performance.now() - startedAt)}`;
      return `${active.role}${elapsed} ${retrying ? "retrying" : (doing ?? "")}`.trim();
    }
  }
  const last = task.reports.at(-1);
  return last === undefined ? "" : `${last.role}: ${firstLine(last.content)}`;
}

function threadLines(
  orchestrator: orchestratorTypes.Orchestrator,
  task: orchestratorTypesTypes.TaskSnapshot,
): string[] {
  return task.assignments.map((assignment) => {
    const thread = orchestrator.snapshot.threads.find(
      (candidate) => candidate.id === assignment.threadId,
    );
    const model = thread === undefined ? "?" : `${modelName(thread.model)}/${thread.thinkingLevel}`;
    return `${assignment.role} ${assignment.threadId} (${model}) ${thread?.status ?? "?"}`;
  });
}

function sections(
  orchestrator: orchestratorTypes.Orchestrator,
  task: orchestratorTypesTypes.TaskSnapshot,
  width: number,
): string[] {
  const lines: string[] = [];
  const { section, related, body } = sectionsPart1(task, lines, width, orchestrator);
  if (task.dependsOn.length > 0) {
    section("Depends on");
    related(task.dependsOn);
  }
  if (task.dependents.length > 0) {
    section("Dependents");
    related(task.dependents);
  }
  const threads = threadLines(orchestrator, task);
  if (threads.length > 0) {
    section("Threads");
    for (const line of threads) lines.push(truncateToWidth(`   ${line}`, width));
  }
  const active = task.assignments.at(-1);
  if (active !== undefined) {
    const activity = activityLines(orchestrator.messages(active.threadId));
    if (activity.length > 0) {
      section("Activity");
      for (const line of activity.slice(-8)) lines.push(truncateToWidth(`   ${line}`, width));
    }
  }
  if (task.handoff !== null) {
    section("Handoff");
    body(task.handoff, 10);
  }
  const last = task.reports.at(-1);
  if (last !== undefined && last.status !== "stopped") {
    section(last.status === "failed" ? "Error" : "Report");
    body(last.content, 12);
  }
  if (task.currentState !== "") {
    section("Current state");
    body(task.currentState, 6);
  }
  if (task.goalState !== "") {
    section("Goal state");
    body(task.goalState, 6);
  }
  return lines;
}

function sectionsPart1(
  task: orchestratorTypesTypes.TaskSnapshot,
  lines: string[],
  width: number,
  orchestrator: Orchestrator,
) {
  if (task.id !== "") lines.push(`   ${theme.fg("muted", "id")}  ${task.id}`);
  const section = (title: string) => lines.push("", theme.fg("accent", ` ${title}`));
  const body = (text: string, limit: number) => {
    const { visualLines, skippedCount } = truncateToVisualLines(text, limit, width - 3);
    if (skippedCount > 0) lines.push(theme.fg("dim", `   … ${skippedCount} more lines`));
    lines.push(...visualLines.map((line) => `   ${line}`));
  };
  const indented = (text: string) => {
    for (const line of wrapTextWithAnsi(text, Math.max(1, width - 3))) lines.push(`   ${line}`);
  };
  if (task.waitingReason !== null) {
    section("Waiting");
    indented(task.waitingReason.detail);
  }
  if (task.replan !== null) {
    section("Replan");
    indented(`${task.replan.role} · ${task.replan.reason}`);
  }
  const byId = new Map(orchestrator.snapshot.tasks.map((entry) => [entry.id, entry]));
  const related = (ids: readonly string[]) => {
    for (const id of ids) {
      const entry = byId.get(id);
      indented(entry === undefined ? id : `${glyph(entry)} ${entry.title}`);
    }
  };
  return { body, related, section };
}

function hints(task: orchestratorTypesTypes.TaskSnapshot): string {
  return ` ${[
    keyHint("app.orchestrator.message", task.status === "running" ? "steer" : "message"),
    keyHint("app.orchestrator.note", "note to round"),
    stoppable(task) ? keyHint("app.orchestrator.stop", "stop") : undefined,
    keyHint("app.orchestrator.depends", "deps"),
    keyHint("app.orchestrator.currentState", "current state"),
    keyHint("app.orchestrator.goalState", "goal state"),
    keyHint("app.orchestrator.model", "model"),
    keyHint("app.orchestrator.rerun", "rerun"),
    keyHint("tui.select.cancel", "back"),
  ]
    .filter(Boolean)
    .join("  ")}`;
}

function listHints(
  showFinished: boolean,
  selected: orchestratorTypesTypes.TaskSnapshot | undefined,
): string {
  return ` ${[
    keyHint("app.orchestrator.message", "message"),
    keyHint("app.orchestrator.note", "note"),
    keyHint("app.orchestrator.toggleFinished", showFinished ? "hide finished" : "show finished"),
    selected !== undefined && stoppable(selected)
      ? keyHint("app.orchestrator.stop", "stop")
      : undefined,
    selected === undefined ? undefined : keyHint("app.orchestrator.depends", "deps"),
    selected === undefined ? undefined : keyHint("app.orchestrator.currentState", "current state"),
    selected === undefined ? undefined : keyHint("app.orchestrator.goalState", "goal state"),
    keyHint("app.orchestrator.model", "model"),
    keyHint("tui.select.cancel", "close"),
  ]
    .filter(Boolean)
    .join("  ")}`;
}

const taskDetail = { hints, listHints, reasonLine, sections, threadLines };

const tasksViewDetail = {
  taskDetail,
};

export default tasksViewDetail;
