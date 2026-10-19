import type { AssistantMessage } from "@msa/ai/compat";
import { contentText } from "@msa/ai/utils/text";

import type { Runtime } from "./runtime.ts";
import { store } from "./store.ts";
import type { Assignment, SessionStatus, Task } from "./types.ts";
import type { WorkerSession } from "./worker.ts";

const REPORT_LIMIT = 4000;

export interface Outcome {
  status: SessionStatus;
  content: string;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outcomeOf(worker: WorkerSession, error: unknown): Outcome {
  const last = worker.messages.findLast(
    (message): message is AssistantMessage => message.role === "assistant",
  );
  if (error !== undefined) return { status: "failed", content: errorText(error) };
  if (last?.stopReason === "error" || last?.stopReason === "aborted") {
    const text = contentText(last.content).trim();
    return { status: "failed", content: [text, last.errorMessage].filter(Boolean).join("\n") };
  }
  return {
    status: "completed",
    content: last === undefined ? "" : contentText(last.content).trim(),
  };
}

function applyOutcome(
  runtime: Runtime,
  assignments: readonly Assignment[],
  outcome: Outcome,
  now: number,
): Task[] {
  const database = runtime.database;
  const review: Task[] = [];
  for (const assignment of assignments) {
    store.insertReport(database, {
      id: `rep-${assignment.sessionId}-${assignment.role}`,
      taskId: assignment.taskId,
      sessionId: assignment.sessionId,
      role: assignment.role,
      status: outcome.status,
      content: outcome.content,
      createdAt: now,
    });
    if (outcome.status !== "completed") {
      store.setTaskStatus(database, assignment.taskId, "failed", now);
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
    if (task !== undefined) review.push(task);
  }
  return review;
}

function reportText(
  runtime: Runtime,
  assignments: readonly Assignment[],
  outcome: Outcome,
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
    `${titles.join(", ")} ${outcome.status}.`,
    started.length > 0 ? `Started: ${started.join(", ")}.` : undefined,
    content === "" ? undefined : `<report>\n${content}\n</report>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}

export const outcomes = { outcomeOf, applyOutcome, reportText, errorText };
