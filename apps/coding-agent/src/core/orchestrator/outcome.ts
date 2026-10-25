import type compatTypes from "@msa/ai/compat.types";
import textModule from "@msa/ai/utils/text";

import type outcomeTypes from "./outcome.types.ts";
import providerWaitModule from "./provider-wait.ts";
import TaskStopped from "./task-stopped.ts";
import type workerTypes from "./worker.ts";

const { providerWaits } = providerWaitModule;

const { contentText } = textModule;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function outcomeOf(worker: workerTypes.WorkerSession, error: unknown): outcomeTypes.Outcome {
  const last = worker.messages.findLast(
    (message): message is compatTypes.AssistantMessage => message.role === "assistant",
  );
  if (TaskStopped.isStopped(error)) return { content: error.message, status: "stopped" };
  if (error !== undefined) return { content: errorText(error), status: "failed" };
  if (last?.stopReason === "error" || last?.stopReason === "aborted") {
    const text = contentText(last.content, "\n").trim();
    const content = [text, last.errorMessage].filter(Boolean).join("\n");
    const limit = providerWaits.limitOf(worker);
    return limit === undefined
      ? { content, status: "failed" }
      : { content, limit, status: "stopped" };
  }
  return {
    content: last === undefined ? "" : contentText(last.content, "\n").trim(),
    status: "completed",
  };
}

const outcomes = { errorText, outcomeOf };

const outcome = {
  outcomes,
};

export default outcome;
