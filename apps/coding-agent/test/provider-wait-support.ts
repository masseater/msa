import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Clock, Effect } from "effect";
import { expect } from "vite-plus/test";

import claudeCodeRun from "../src/core/cli-agents/claude-code-run.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import type orchestratorHarnessTypes from "./orchestrator-harness.types.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";

const { create } = orchestratorSupport;
const { setup } = orchestratorHarness.harness;
const { TASK, advance, fakeClock } = watchdogSupport;
const { fauxAssistantMessage } = ai;
const { usageLimited } = claudeCodeRun;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SESSION_LIMIT = "You've hit your session limit · resets 8am (Asia/Tokyo)";

const sessionLimit = (resetsAt: number): Partial<aiTypes.AssistantMessage> => {
  const failed = usageLimited(SESSION_LIMIT, resetsAt);
  return { errorMessage: failed.message, errorResetsAt: resetsAt };
};

const startedTask = (options: orchestratorHarnessTypes.HarnessOptions = {}) =>
  Effect.gen(function* () {
    yield* fakeClock();
    const started = setup({ pollIntervalMs: 5000, ...options });
    const task = yield* create(started.orchestrator, TASK);
    const worker = started.workers[0];
    if (worker === undefined) throw new Error("no worker started");
    return { ...started, task, worker };
  });

type Started = Effect.Success<ReturnType<typeof startedTask>>;

const snapshotOf = (started: Started) =>
  started.orchestrator.snapshot.tasks.find((task) => task.id === started.task.id);

const limitAgain = (
  started: Started,
  index: number,
  progressed: boolean,
  failure: (resetsAt: number) => Partial<aiTypes.AssistantMessage> = sessionLimit,
) =>
  Effect.gen(function* () {
    const worker = started.workers[index];
    if (worker === undefined) throw new Error(`worker ${index} did not start`);
    if (progressed) worker.messages = [fauxAssistantMessage("did some work")];
    worker.endTurnWithError(failure((yield* Clock.currentTimeMillis) + HOUR));
    yield* advance(0);
  });

const resumeAll = (started: Started, count: number) =>
  Effect.gen(function* () {
    yield* advance(HOUR + MINUTE + 10_000);
    expect(started.workers).toHaveLength(count);
  });

const SETTLE_TIMEOUT_MS = 30_000;

const realElapsedMs = (start: bigint): number => Number(process.hrtime.bigint() - start) / 1e6;

const settledUntil = (predicate: () => boolean) =>
  Effect.gen(function* () {
    const start = process.hrtime.bigint();
    while (realElapsedMs(start) < SETTLE_TIMEOUT_MS) {
      if (predicate()) return;
      yield* advance(0);
    }
    if (predicate()) return;
    throw new Error(`timed out waiting for the orchestrator: ${String(predicate)}`);
  });

const providerWaitSupport = {
  HOUR,
  MINUTE,
  SESSION_LIMIT,
  limitAgain,
  resumeAll,
  sessionLimit,
  settledUntil,
  snapshotOf,
  startedTask,
};

export default providerWaitSupport;
