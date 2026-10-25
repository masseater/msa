import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import platform from "../platform/index.ts";
import type outcomeTypes from "./outcome.types.ts";
import promptsModule from "./prompts.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type workerTypes from "./worker.ts";

const { providerUnusableReason } = compat;
const { formatLocalDateTime } = platform;
const { prompts } = promptsModule;
const { store } = storeModule;

const RETRY_WITHOUT_RESET_MS = 15 * 60_000;
const AFTER_RESET_MS = 60_000;

const REASON_LABEL: Record<orchestratorTypesTypes.ProviderWait["reason"], string> = {
  auth: "provider rejected the credentials",
  quota: "provider limit",
};

function limitOf(worker: workerTypes.WorkerSession): outcomeTypes.ProviderLimit | undefined {
  const last = worker.messages.findLast(
    (message): message is compatTypes.AssistantMessage => message.role === "assistant",
  );
  if (last === undefined) return undefined;
  const reason = providerUnusableReason(last);
  if (reason === undefined) return undefined;
  return {
    error: (last.errorMessage ?? "").trim() || "provider error",
    progressed: progressedSincePrompt(worker.messages),
    reason,
    resetsAt: last.errorResetsAt,
    sessionFile: worker.sessionFile ?? null,
  };
}

function progressedSincePrompt(messages: workerTypes.WorkerSession["messages"]): boolean {
  const prompt = messages.findLastIndex((message) => message.role === "user");
  return messages
    .slice(prompt + 1)
    .some(
      (message) =>
        message.role === "assistant" &&
        message.stopReason !== "error" &&
        message.stopReason !== "aborted",
    );
}

function resumeAt(limit: outcomeTypes.ProviderLimit, now: number): number {
  return limit.resetsAt === undefined || limit.resetsAt <= now
    ? now + RETRY_WITHOUT_RESET_MS
    : limit.resetsAt + AFTER_RESET_MS;
}

function record(
  runtime: runtimeTypes.Runtime,
  assignment: orchestratorTypesTypes.Assignment,
  limit: outcomeTypes.ProviderLimit,
  now: number,
): void {
  const { database } = runtime;
  const stalled =
    !limit.progressed && store.providerResumedFor(database, assignment.taskId) === limit.reason;
  store.setTaskStatus(database, assignment.taskId, "waiting", now);
  store.insertProviderWait(database, {
    createdAt: now,
    error: limit.error,
    project: runtime.options.project,
    reason: limit.reason,
    resumeAt: stalled ? null : resumeAt(limit, now),
    role: assignment.role,
    sessionFile: limit.sessionFile,
    taskId: assignment.taskId,
    threadId: assignment.threadId,
  });
}

function firstLine(text: string): string {
  return (text.split("\n").find((line) => line.trim() !== "") ?? text).trim();
}

function waitingDetail(wait: orchestratorTypesTypes.ProviderWait): string {
  const cause = `${REASON_LABEL[wait.reason]} (${firstLine(wait.error)})`;
  return wait.resumeAt === null
    ? `${cause}; resumed and stopped on it again without progress, waits for a decision`
    : `${cause}; resumes ${formatLocalDateTime(wait.resumeAt)}`;
}

function waitingLine(runtime: runtimeTypes.Runtime, taskId: string): string {
  const wait = store
    .listProviderWaits(runtime.database, runtime.options.project)
    .find((candidate) => candidate.taskId === taskId);
  if (wait === undefined) return " waiting.";
  const cause = `the ${REASON_LABEL[wait.reason]} (${firstLine(wait.error)})`;
  return wait.resumeAt === null
    ? ` waiting for your decision, not failed. It was resumed after ${cause} and stopped on it again before making any progress, so it is not resumed on its own. send_message resumes the same thread with your message, rerun_task starts it over in a new thread, and stop_task stops it.`
    : ` waiting, not failed. ${cause.charAt(0).toUpperCase()}${cause.slice(1)} stopped it; the same thread resumes automatically at ${formatLocalDateTime(wait.resumeAt)}.`;
}

function resumePrompt(
  wait: orchestratorTypesTypes.ProviderWait,
  notes: readonly orchestratorTypesTypes.Note[],
): string {
  return [
    `Your turn stopped at ${formatLocalDateTime(wait.createdAt)} on a provider error that retries do not fix (${REASON_LABEL[wait.reason]}). It has had time to clear. Continue the task from where you stopped; your workspace is as you left it.`,
    notes.length > 0 ? prompts.notesBlock(notes) : undefined,
  ]
    .filter(Boolean)
    .join("\n\n");
}

const providerWaits = { limitOf, record, resumePrompt, waitingDetail, waitingLine };

const providerWait = {
  providerWaits,
};

export default providerWait;
