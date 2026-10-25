import ai from "@msa/ai";
import type aiTypes from "@msa/ai/index.types";
import { Clock, Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import platform from "../src/core/platform/index.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";

const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus } = harness;
const { TASK, advance, fakeClock } = watchdogSupport;
const { formatLocalDateTime } = platform;
const { fauxAssistantMessage } = ai;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const SESSION_LIMIT = "You've hit your session limit · resets 8am (Asia/Tokyo)";

afterEach(() => {
  vi.useRealTimers();
});

const startedTask = Effect.gen(function* () {
  yield* fakeClock();
  const started = setup({ pollIntervalMs: 5000 });
  const task = yield* create(started.orchestrator, TASK);
  const worker = started.workers[0];
  if (worker === undefined) throw new Error("no worker started");
  return { ...started, task, worker };
});

type Started = Effect.Success<typeof startedTask>;

const endWith = (started: Started, failure: Partial<aiTypes.AssistantMessage>) =>
  Effect.gen(function* () {
    started.worker.endTurnWithError(failure);
    yield* advance(0);
  });

const snapshotOf = (started: Started) =>
  started.orchestrator.snapshot.tasks.find((task) => task.id === started.task.id);

const waitsUntilTheResetAndResumesTheSameThread = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* startedTask;
      const resetsAt = (yield* Clock.currentTimeMillis) + 2 * HOUR;
      const resumesAt = formatLocalDateTime(resetsAt + MINUTE);

      yield* endWith(started, { errorMessage: SESSION_LIMIT, errorResetsAt: resetsAt });

      expect(taskStatus(started.orchestrator, started.task.id)).toBe("waiting");
      expect(snapshotOf(started)?.waitingReason).toEqual({
        detail: `provider limit (${SESSION_LIMIT}); resumes ${resumesAt}`,
        kind: "provider",
      });
      expect(started.reports.at(-1)?.details).toMatchObject({
        status: "waiting",
        taskId: started.task.id,
      });
      expect(started.reports.at(-1)?.text).toContain(`resumes automatically at ${resumesAt}`);
      expect(started.reports.at(-1)?.text).toContain(SESSION_LIMIT);

      yield* advance(2 * HOUR);
      expect(started.workers).toHaveLength(1);
      expect(taskStatus(started.orchestrator, started.task.id)).toBe("waiting");

      yield* advance(MINUTE + 10_000);
      const resumed = started.workers[1];
      expect(started.workers).toHaveLength(2);
      expect(resumed?.openedSessionFile).toBe(started.worker.sessionFile);
      expect(resumed?.prompts[0]).toMatch(/^Your turn stopped at .* Continue the task/u);
      expect(taskStatus(started.orchestrator, started.task.id)).toBe("running");

      yield* Effect.promise(() => started.orchestrator.dispose());
    }),
  );

it(
  "waits for the reset time of a session limit, then resumes the same thread",
  waitsUntilTheResetAndResumesTheSameThread,
);

const retriesAPaymentErrorAfterTheFixedInterval = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* startedTask;

      yield* endWith(started, { errorMessage: "insufficient balance", errorStatus: 402 });

      expect(taskStatus(started.orchestrator, started.task.id)).toBe("waiting");
      expect(snapshotOf(started)?.waitingReason?.kind).toBe("provider");
      yield* advance(14 * MINUTE);
      expect(started.workers).toHaveLength(1);

      yield* advance(2 * MINUTE);
      expect(started.workers).toHaveLength(2);
      expect(started.workers[1]?.openedSessionFile).toBe(started.worker.sessionFile);
      expect(taskStatus(started.orchestrator, started.task.id)).toBe("running");
      yield* Effect.promise(() => started.orchestrator.dispose());
    }),
  );

it(
  "retries a provider error without a reset time after a fixed interval",
  retriesAPaymentErrorAfterTheFixedInterval,
);

const failsAnyOtherErrorAndLeavesItStopped = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* startedTask;

      yield* endWith(started, { errorMessage: SESSION_LIMIT });

      expect(taskStatus(started.orchestrator, started.task.id)).toBe("failed");
      expect(started.reports.at(-1)?.details.status).toBe("failed");
      yield* advance(3 * HOUR);
      expect(started.workers).toHaveLength(1);
      expect(taskStatus(started.orchestrator, started.task.id)).toBe("failed");
      yield* Effect.promise(() => started.orchestrator.dispose());
    }),
  );

it(
  "fails an error the provider judgment does not mark unusable and never restarts it",
  failsAnyOtherErrorAndLeavesItStopped,
);

const dropsTheWaitWhenTheTaskIsStopped = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* startedTask;
      const resetsAt = (yield* Clock.currentTimeMillis) + HOUR;

      yield* endWith(started, { errorMessage: SESSION_LIMIT, errorResetsAt: resetsAt });
      expect(taskStatus(started.orchestrator, started.task.id)).toBe("waiting");
      yield* Effect.promise(() => started.orchestrator.stop(started.task.id));
      yield* advance(2 * HOUR);

      expect(started.workers.some((worker) => worker.openedSessionFile !== undefined)).toBe(false);
      expect(taskStatus(started.orchestrator, started.task.id)).toBe("stopped");
      yield* Effect.promise(() => started.orchestrator.dispose());
    }),
  );

it("drops the wait when the task is stopped", dropsTheWaitWhenTheTaskIsStopped);

const limitAgain = (started: Started, index: number, progressed: boolean) =>
  Effect.gen(function* () {
    const worker = started.workers[index];
    if (worker === undefined) throw new Error(`worker ${index} did not start`);
    if (progressed) worker.messages = [fauxAssistantMessage("did some work")];
    const resetsAt = (yield* Clock.currentTimeMillis) + HOUR;
    worker.endTurnWithError({ errorMessage: SESSION_LIMIT, errorResetsAt: resetsAt });
    yield* advance(0);
  });

const resumeAll = (started: Started, count: number) =>
  Effect.gen(function* () {
    yield* advance(HOUR + MINUTE + 10_000);
    expect(started.workers).toHaveLength(count);
  });

const givesUpAfterResumesThatDoNoWork = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* startedTask;
      yield* limitAgain(started, 0, false);
      for (const index of [1, 2]) {
        yield* resumeAll(started, index + 1);
        yield* limitAgain(started, index, false);
        expect(taskStatus(started.orchestrator, started.task.id)).toBe("waiting");
      }
      yield* resumeAll(started, 4);
      yield* limitAgain(started, 3, false);

      expect(taskStatus(started.orchestrator, started.task.id)).toBe("failed");
      expect(started.reports.at(-1)?.details.status).toBe("failed");
      expect(started.reports.at(-1)?.text).toContain("not resumed again");
      yield* advance(3 * HOUR);
      expect(started.workers).toHaveLength(4);
      yield* Effect.promise(() => started.orchestrator.dispose());
    }),
  );

it(
  "fails the task once three resumes in a row stop on the error before doing any work",
  givesUpAfterResumesThatDoNoWork,
);

const keepsWaitingWhileResumesMakeProgress = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* startedTask;
      yield* limitAgain(started, 0, false);
      for (const index of [1, 2, 3, 4]) {
        yield* resumeAll(started, index + 1);
        yield* limitAgain(started, index, index === 3);
      }

      expect(taskStatus(started.orchestrator, started.task.id)).toBe("waiting");
      yield* resumeAll(started, 6);
      yield* Effect.promise(() => started.orchestrator.dispose());
    }),
  );

it(
  "keeps resuming when a resumed thread did work before it hit the limit again",
  keepsWaitingWhileResumesMakeProgress,
);
