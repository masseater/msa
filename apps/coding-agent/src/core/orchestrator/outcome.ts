import type compatTypes from "@msa/ai/compat.types";
import textModule from "@msa/ai/utils/text";

import type outcomeTypes from "./outcome.types.ts";
import reviewVerdictModule from "./review-verdict.ts";
import runTimeNotice from "./run-time-notice.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type workerTypes from "./worker.ts";

const { store } = storeModule;
const { runTimeSuffix } = runTimeNotice;
const { reviewVerdicts } = reviewVerdictModule;

const { contentText } = textModule;

const REPORT_LIMIT = 4000;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outcomeOf(worker: workerTypes.WorkerSession, error: unknown): outcomeTypes.Outcome {
  const last = worker.messages.findLast(
    (message): message is compatTypes.AssistantMessage => message.role === "assistant",
  );
  if (error !== undefined) return { content: errorText(error), status: "failed" };
  if (last?.stopReason === "error" || last?.stopReason === "aborted") {
    const text = contentText(last.content, "\n").trim();
    return { content: [text, last.errorMessage].filter(Boolean).join("\n"), status: "failed" };
  }
  return {
    content: last === undefined ? "" : contentText(last.content, "\n").trim(),
    status: "completed",
  };
}

interface Applied {
  review: orchestratorTypesTypes.Task[];
  sendBack: orchestratorTypesTypes.Task[];
  lines: string[];
  held: boolean;
}

function applyOutcome(
  runtime: runtimeTypes.Runtime,
  assignments: readonly orchestratorTypesTypes.Assignment[],
  outcome: outcomeTypes.Outcome,
  now: number,
  verdict?: runtimeTypes.ReviewVerdict,
): Applied {
  const database = runtime.database;
  const applied: Applied = { held: false, lines: [], review: [], sendBack: [] };
  for (const assignment of assignments) {
    const judged =
      outcome.status === "completed" ? reviewVerdicts.judgedTask(runtime, assignment) : undefined;
    const result =
      judged === undefined ? undefined : reviewVerdicts.apply(runtime, judged.id, verdict);
    if (result !== undefined) applied.lines.push(result.line);
    store.insertReport(database, {
      content: result === undefined ? outcome.content : `${result.line}\n\n${outcome.content}`,
      createdAt: now,
      id: `rep-${assignment.threadId}-${assignment.role}`,
      role: assignment.role,
      status: outcome.status,
      taskId: assignment.taskId,
      threadId: assignment.threadId,
      verdict: result?.result ?? null,
    });
    if (outcome.status !== "completed") {
      store.setTaskStatus(database, assignment.taskId, "failed", now);
      continue;
    }
    if (judged !== undefined && result !== undefined && result.status !== "completed") {
      applied.held = true;
      if (result.status === "sent-back") applied.sendBack.push(judged);
      else store.setTaskStatus(database, assignment.taskId, result.status, now);
      continue;
    }
    if (store.unfinishedDependencies(database, assignment.taskId).length > 0) {
      store.setTaskStatus(database, assignment.taskId, "waiting", now);
      continue;
    }
    if (assignment.role === "reviewer") {
      store.setTaskStatus(database, assignment.taskId, "completed", now);
      continue;
    }
    const task = store.getTask(database, assignment.taskId);
    if (task !== undefined) applied.review.push(task);
  }
  return applied;
}

function reportText(
  runtime: runtimeTypes.Runtime,
  assignments: readonly orchestratorTypesTypes.Assignment[],
  outcome: outcomeTypes.Outcome,
  started: readonly string[],
): string {
  const titles = assignments.map((assignment) => {
    const task = store.getTask(runtime.database, assignment.taskId);
    return `${task?.title ?? assignment.taskId} (${assignment.role})`;
  });
  const content =
    outcome.content.length <= REPORT_LIMIT
      ? outcome.content
      : `${outcome.content.slice(0, REPORT_LIMIT)}\n[truncated]`;
  return [
    `${titles.join(", ")} ${outcome.status}.${runTimeSuffix(runtime, assignments, outcome)}`,
    started.length > 0 ? `Started: ${started.join(", ")}.` : undefined,
    content === "" ? undefined : `<report>\n${content}\n</report>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const outcomes = { applyOutcome, errorText, outcomeOf, reportText };

const outcome = {
  outcomes,
};

export default outcome;
