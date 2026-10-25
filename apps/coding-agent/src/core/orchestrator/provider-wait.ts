import compat from "@msa/ai/compat";
import type compatTypes from "@msa/ai/compat.types";

import platform from "../platform/index.ts";
import type outcomeTypes from "./outcome.types.ts";
import promptsModule from "./prompts.ts";
import providerWaitText from "./provider-wait-text.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type workerTypes from "./worker.ts";

const { providerUnusableReason } = compat;
const { formatLocalDateTime } = platform;
const { prompts } = promptsModule;
const { store } = storeModule;
const { REASON_LABEL, cause } = providerWaitText;

const RETRY_WITHOUT_RESET_MS = 15 * 60_000;
const AFTER_RESET_MS = 60_000;

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

function stallOf(
  runtime: runtimeTypes.Runtime,
  taskId: string,
  limit: outcomeTypes.ProviderLimit,
): runtimeTypes.DecisionAsk | undefined {
  if (limit.progressed || store.providerResumedFor(runtime.database, taskId) !== limit.reason)
    return undefined;
  return {
    key: providerWaitText.stallKey(limit.reason, limit.error),
    text: providerWaitText.stallText(limit.reason, limit.error),
  };
}

function record(
  runtime: runtimeTypes.Runtime,
  assignment: orchestratorTypesTypes.Assignment,
  limit: outcomeTypes.ProviderLimit,
  now: number,
): void {
  const { database } = runtime;
  if (!helperRole(assignment.role))
    store.setTaskStatus(database, assignment.taskId, "waiting", now);
  store.insertProviderWait(database, {
    createdAt: now,
    error: limit.error,
    project: runtime.options.project,
    reason: limit.reason,
    resumeAt: resumeAt(limit, now),
    role: assignment.role,
    sessionFile: limit.sessionFile,
    taskId: assignment.taskId,
    threadId: assignment.threadId,
  });
}

function helperRole(role: orchestratorTypesTypes.ThreadRole): boolean {
  return role === "advisor" || role === "triage";
}

function waitingDetail(wait: orchestratorTypesTypes.ProviderWait): string {
  const who = helperRole(wait.role) ? `the ${wait.role} ` : "";
  return `${cause(wait.reason, wait.error)}; ${who}resumes ${formatLocalDateTime(wait.resumeAt)}`;
}

function helperWaitingLine(wait: orchestratorTypesTypes.ProviderWait): string {
  const at = formatLocalDateTime(wait.resumeAt);
  return wait.role === "advisor"
    ? ` stopped, not failed. The ${cause(wait.reason, wait.error)} stopped the advisor; the same advisor thread resumes automatically at ${at}. The task still waits for your decision, and send_message answers it without waiting for the advice.`
    : ` waiting, not failed. The ${cause(wait.reason, wait.error)} stopped the triage; the same triage thread resumes automatically at ${at}, and you hear from it either way.`;
}

function waitingLine(runtime: runtimeTypes.Runtime, taskId: string): string | undefined {
  const wait = store
    .listProviderWaits(runtime.database, runtime.options.project)
    .find((candidate) => candidate.taskId === taskId);
  if (wait === undefined) return undefined;
  if (helperRole(wait.role)) return helperWaitingLine(wait);
  return ` waiting, not failed. The ${cause(wait.reason, wait.error)} stopped it; the same thread resumes automatically at ${formatLocalDateTime(wait.resumeAt)}.`;
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

const providerWaits = {
  helperRole,
  limitOf,
  record,
  resumePrompt,
  stallOf,
  waitingDetail,
  waitingLine,
};

const providerWait = {
  providerWaits,
};

export default providerWait;
