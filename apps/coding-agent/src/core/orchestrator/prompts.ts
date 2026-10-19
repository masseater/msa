import type { Note, ReplanResult, Report, Task, TaskView } from "./types.ts";

const REPORT_LIMIT = 6000;

function truncateReport(text: string): string {
  return text.length <= REPORT_LIMIT ? text : `${text.slice(0, REPORT_LIMIT)}\n[truncated]`;
}

function notesBlock(notes: readonly Note[]): string {
  if (notes.length === 0) return "";
  return [
    "<shared-notes>",
    "Messages sent to this work while it was waiting or between turns. Follow them.",
    ...notes.map(
      (note) => `<note id="${note.id}" from="${note.author}">\n${note.content}\n</note>`,
    ),
    "</shared-notes>",
  ].join("\n");
}

function dependencyBlock(dependencies: readonly TaskView[]): string {
  if (dependencies.length === 0) return "";
  return [
    "<dependency-reports>",
    ...dependencies.map((dependency) => {
      const report = latestReport(dependency);
      return `<task id="${dependency.id}" title="${dependency.title}" status="${dependency.status}">\n${report === undefined ? "(no report)" : truncateReport(report.content)}\n</task>`;
    }),
    "</dependency-reports>",
  ].join("\n");
}

function latestReport(task: TaskView): Report | undefined {
  return task.reports.at(-1);
}

function stateBlock(tag: string, value: string): string {
  return `<${tag}>\n${value}\n</${tag}>`;
}

function workerPrompt(
  task: TaskView,
  dependencies: readonly TaskView[],
  notes: readonly Note[],
): string {
  return [
    stateBlock("current-state", task.currentState),
    stateBlock("goal-state", task.goalState),
    dependencyBlock(dependencies),
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n\n");
}

function taskReviewerPrompt(task: TaskView, workerReport: string, notes: readonly Note[]): string {
  const work = [
    `<task id="${task.id}" title="${task.title}">`,
    stateBlock("current-state", task.currentState),
    stateBlock("goal-state", task.goalState),
    "</task>",
    `<worker-report>\n${truncateReport(workerReport)}\n</worker-report>`,
  ].join("\n");
  return [
    "You are reviewing work another session just did. You did not write it.",
    "Read the report, inspect the changed files and the surrounding code, and check the work against the task. Do not redo it and do not edit files.",
    "Report what is wrong, what is missing, and what you checked. Say clearly whether the work is acceptable.",
    "",
    work,
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n");
}

function roundReviewPrompt(
  round: string,
  tasks: readonly TaskView[],
  notes: readonly Note[],
): string {
  const reports = tasks
    .map(
      (task) =>
        `<task id="${task.id}" title="${task.title}" status="${task.status}">\n${task.reports
          .map((report) => `[${report.role}/${report.status}]\n${truncateReport(report.content)}`)
          .join("\n\n")}\n</task>`,
    )
    .join("\n\n");
  return [
    `You are the closing reviewer of round "${round}" of an orchestrated project. Every task of the round has finished, and nothing of the round runs while you work.`,
    "Step back and review the work as a whole, not task by task: check the results against each other and against the original intent, read the code they changed, and find gaps, conflicts, duplicated work, and wrong assumptions.",
    "Then redesign: say what should change in the overall approach and lay out the remaining work as tasks with their dependencies, so the orchestrator can start the next round. If nothing is left, say so.",
    "",
    "<round-tasks>",
    reports,
    "</round-tasks>",
    notesBlock(notes),
  ]
    .filter(Boolean)
    .join("\n");
}

function taskHeading(task: Task): string {
  return `${task.id} [${task.kind}, ${task.status}, round ${task.round}] ${task.title}`;
}

function formatTaskList(tasks: readonly TaskView[]): string {
  if (tasks.length === 0) return "No tasks.";
  return tasks.map(describeTask).join("\n");
}

function assignmentText(task: TaskView): string {
  const sessions = task.assignments.map(
    (assignment) => `${assignment.role} ${assignment.sessionId}`,
  );
  return sessions.length > 0 ? sessions.join(", ") : "unassigned";
}

function describeTask(task: TaskView): string {
  const dependencies = task.dependsOn.length > 0 ? task.dependsOn.join(", ") : "-";
  const condition = task.condition === null ? "" : ` condition "${task.condition}"`;
  return `${taskHeading(task)} — depends on ${dependencies}; ${assignmentText(task)}${condition}`;
}

function formatTaskDetail(task: TaskView, sessions: readonly string[]): string {
  const reports = task.reports.map(
    (report) =>
      `<report role="${report.role}" status="${report.status}">\n${report.content}\n</report>`,
  );
  return [
    describeTask(task),
    `Dependents: ${task.dependents.join(", ") || "-"}`,
    sessions.length > 0 ? `Sessions: ${sessions.join(", ")}` : "Sessions: -",
    stateBlock("current-state", task.currentState),
    stateBlock("goal-state", task.goalState),
    ...reports,
  ].join("\n\n");
}

function memoFirstLine(memo: string): string {
  const line = memo.split("\n").find((candidate) => candidate.trim() !== "");
  return line?.trim() ?? "(no memo)";
}

function formatReplan(result: ReplanResult): string {
  if (result.aborted !== null) {
    return `Replan aborted: ${result.aborted}. No task was created, dropped, or rewired.`;
  }
  const lines = [`Replanned ${result.replanId}.`];
  if (result.stopped.length > 0) {
    lines.push(
      `Stopped:\n${result.stopped
        .map((item) => `- ${item.taskId} ${item.title}: ${memoFirstLine(item.memo)}`)
        .join("\n")}`,
    );
  }
  if (result.dropped.length > 0) {
    lines.push(
      `Dropped:\n${result.dropped
        .map((item) => `- ${item.taskId} ${item.title}: ${item.reason}`)
        .join("\n")}`,
    );
  }
  if (result.created.length > 0) {
    lines.push(
      `Created:\n${result.created
        .map(
          (item) =>
            `- ${item.taskId} ${item.title}${item.from.length > 0 ? ` from ${item.from.join(", ")}` : ""}`,
        )
        .join("\n")}`,
    );
  }
  if (result.kept.length > 0) lines.push(`Kept: ${result.kept.join(", ")}.`);
  if (result.rewired.length > 0) {
    lines.push(
      `Rewired: ${result.rewired
        .map((item) => `${item.taskId} depends on ${item.dependsOn.join(", ") || "-"}`)
        .join("; ")}.`,
    );
  }
  lines.push(
    result.started.length > 0 ? `Started: ${result.started.join(", ")}.` : "Nothing started.",
  );
  return lines.join("\n");
}

export const prompts = {
  stateBlock,
  notesBlock,
  dependencyBlock,
  latestReport,
  workerPrompt,
  taskReviewerPrompt,
  roundReviewPrompt,
  taskHeading,
  formatTaskList,
  formatTaskDetail,
  formatReplan,
};
