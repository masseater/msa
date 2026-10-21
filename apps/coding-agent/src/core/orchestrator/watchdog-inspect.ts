import type compatTypes from "@msa/ai/compat.types";

import elapsedModule from "../../utils/elapsed.ts";
import processAliveModule from "../platform/node/process-alive.ts";
import type runtimeTypes from "./runtime.types.ts";
import storeModule from "./store.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import type watchdogTypes from "./watchdog.types.ts";
import type workerTypes from "./worker.ts";

const { store } = storeModule;
const { formatElapsed } = elapsedModule;
const { processAlive } = processAliveModule;

function stoppedTurn(worker: runtimeTypes.WorkerSession): compatTypes.AssistantMessage | undefined {
  const last = worker.messages.at(-1);
  if (last?.role !== "assistant") return undefined;
  const turn = last as compatTypes.AssistantMessage;
  return turn.stopReason === "error" || turn.stopReason === "aborted" ? turn : undefined;
}

function inspectOwn(
  runtime: runtimeTypes.Runtime,
  thread: orchestratorTypesTypes.Thread,
  options: workerTypes.WatchdogOptions,
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
  const since = now - (runtime.activity.get(thread.id)?.at ?? thread.createdAt);
  const turn = stoppedTurn(worker);
  if (turn !== undefined && !worker.isStreaming && !worker.run.retry.isRetrying) {
    if (since < options.intervalMs) return undefined;
    const detail = [turn.stopReason, turn.errorMessage].filter(Boolean).join(": ");
    return {
      reason: `the last turn ended with ${detail} ${formatElapsed(since)} ago and the thread never settled`,
      taskStatus: "failed",
      thread,
      threadStatus: "failed",
    };
  }
  if (since < options.idleMs) return undefined;
  return {
    reason: `no tool call or message for ${formatElapsed(since)} (running ${formatElapsed(now - thread.createdAt)})`,
    taskStatus: "stopped",
    thread,
    threadStatus: "stopped",
  };
}

function inspectElsewhere(runtime: runtimeTypes.Runtime, now: number): watchdogTypes.Finding[] {
  const owners = new Map<number, boolean>();
  const alive = (pid: number): boolean => {
    const known = owners.get(pid) ?? processAlive(pid);
    owners.set(pid, known);
    return known;
  };
  return store
    .runningThreadsElsewhere(runtime.database, runtime.options.project)
    .filter(({ ownerPid }) => ownerPid === null || !alive(ownerPid))
    .flatMap(({ ownerPid, threadId }) => {
      const thread = store.getThread(runtime.database, threadId);
      if (thread === undefined) return [];
      return [
        {
          reason: `its orchestrator process${ownerPid === null ? "" : ` ${ownerPid}`} is gone (project ${thread.project}); last update ${formatElapsed(now - thread.updatedAt)} ago`,
          taskStatus: "stopped" as const,
          thread,
          threadStatus: "stopped" as const,
        },
      ];
    });
}

function inspect(
  runtime: runtimeTypes.Runtime,
  options: workerTypes.WatchdogOptions,
  now: number,
): watchdogTypes.Finding[] {
  const own = store
    .runningThreads(runtime.database, runtime.options.project)
    .flatMap((thread) => inspectOwn(runtime, thread, options, now) ?? []);
  return [...own, ...inspectElsewhere(runtime, now)];
}

const watchdogInspect = { inspect };

export default watchdogInspect;
