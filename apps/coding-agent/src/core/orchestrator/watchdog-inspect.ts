import type compatTypes from "@msa/ai/compat.types";

import elapsedModule from "../../utils/elapsed.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type watchdogTypes from "./watchdog.types.ts";

const { store } = storeModule;
const { formatElapsed } = elapsedModule;

const INTERVAL_MS = 60_000;
const IDLE_MS = 30 * 60_000;
const TOOL_CALL_MS = 60 * 60_000;

function lastTurn(worker: runtimeTypes.WorkerSession): compatTypes.AssistantMessage | undefined {
  const last = worker.messages.at(-1);
  return last?.role === "assistant" ? (last as compatTypes.AssistantMessage) : undefined;
}

function awaitingToolResult(worker: runtimeTypes.WorkerSession): boolean {
  const index = worker.messages.findLastIndex((message) => message.role === "assistant");
  const turn = worker.messages[index] as compatTypes.AssistantMessage | undefined;
  if (turn?.stopReason !== "toolUse") return false;
  const returned = new Set(
    worker.messages
      .slice(index + 1)
      .flatMap((message) => (message.role === "toolResult" ? [message.toolCallId] : [])),
  );
  return turn.content.some((part) => part.type === "toolCall" && !returned.has(part.id));
}

function stoppedTurn(worker: runtimeTypes.WorkerSession): compatTypes.AssistantMessage | undefined {
  const turn = lastTurn(worker);
  return turn?.stopReason === "error" || turn?.stopReason === "aborted" ? turn : undefined;
}

function idleFinding(
  thread: orchestratorTypesTypes.Thread,
  worker: runtimeTypes.WorkerSession,
  since: number,
  now: number,
): watchdogTypes.Finding | undefined {
  const toolCall = worker.isStreaming && awaitingToolResult(worker);
  if (since < (toolCall ? TOOL_CALL_MS : IDLE_MS)) return undefined;
  const running = formatElapsed(now - thread.createdAt);
  return {
    reason: toolCall
      ? `one tool call has run for ${formatElapsed(since)} (running ${running})`
      : `no tool call or message for ${formatElapsed(since)} (running ${running})`,
    taskStatus: "stopped",
    thread,
    threadStatus: "stopped",
  };
}

function inspectOwn(
  runtime: runtimeTypes.Runtime,
  thread: orchestratorTypesTypes.Thread,
  now: number,
): watchdogTypes.Finding | undefined {
  if (runtime.wrapUps.has(thread.id)) return undefined;
  const worker = runtime.workers.get(thread.id);
  if (!runtime.runs.has(thread.id) || worker === undefined) {
    return {
      reason: `no live run in this orchestrator; last update ${formatElapsed(now - thread.updatedAt)} ago`,
      taskStatus: "stopped",
      thread,
      threadStatus: "stopped",
    };
  }
  if (worker.compaction.manual.isCompacting || runtime.harnessWork.has(thread.id)) return undefined;
  const since = now - (runtime.activity.get(thread.id)?.at ?? thread.createdAt);
  const turn = stoppedTurn(worker);
  if (turn !== undefined && !worker.isStreaming && !worker.run.retry.isRetrying) {
    if (since < INTERVAL_MS) return undefined;
    const detail = [turn.stopReason, turn.errorMessage].filter(Boolean).join(": ");
    return {
      reason: `the last turn ended with ${detail} ${formatElapsed(since)} ago and the thread never settled`,
      taskStatus: "failed",
      thread,
      threadStatus: "failed",
    };
  }
  return idleFinding(thread, worker, since, now);
}

function inspect(runtime: runtimeTypes.Runtime, now: number): watchdogTypes.Finding[] {
  return store
    .runningThreads(runtime.database, runtime.options.project)
    .flatMap((thread) => inspectOwn(runtime, thread, now) ?? []);
}

const watchdogInspect = { INTERVAL_MS, inspect };

export default watchdogInspect;
