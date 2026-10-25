import type aiTypes from "@msa/ai/index.types";
import { Clock, Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import platform from "../src/core/platform/index.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";
import providerWaitSupport from "./provider-wait-support.ts";

const { taskStatus } = orchestratorHarness.harness;
const { advance } = watchdogSupport;
const { formatLocalDateTime } = platform;
const { HOUR, MINUTE, SESSION_LIMIT, limitAgain, resumeAll, sessionLimit, snapshotOf } =
  providerWaitSupport;

afterEach(() => {
  vi.useRealTimers();
});

const startedTask = providerWaitSupport.startedTask();

type Started = Effect.Success<typeof startedTask>;

const endWith = (started: Started, failure: Partial<aiTypes.AssistantMessage>) =>
  Effect.gen(function* () {
    started.worker.endTurnWithError(failure);
    yield* advance(0);
  });

const waitsUntilTheResetAndResumesTheSameThread = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* startedTask;
      const resetsAt = (yield* Clock.currentTimeMillis) + 2 * HOUR;
      const resumesAt = formatLocalDateTime(resetsAt + MINUTE);

      yield* endWith(started, sessionLimit(resetsAt));

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
      const resetsAt = (yield* Clock.currentTimeMillis) + HOUR;

      yield* endWith(started, { errorMessage: SESSION_LIMIT, errorResetsAt: resetsAt });

      expect(taskStatus(started.orchestrator, started.task.id)).toBe("failed");
      expect(started.reports.at(-1)?.details.status).toBe("failed");
      yield* advance(3 * HOUR);
      expect(started.workers).toHaveLength(1);
      expect(taskStatus(started.orchestrator, started.task.id)).toBe("failed");
      yield* Effect.promise(() => started.orchestrator.dispose());
    }),
  );

it(
  "fails an error without a status or error kind, even with a reset time, and never restarts it",
  failsAnyOtherErrorAndLeavesItStopped,
);

const dropsTheWaitWhenTheTaskIsStopped = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* startedTask;
      const resetsAt = (yield* Clock.currentTimeMillis) + HOUR;

      yield* endWith(started, sessionLimit(resetsAt));
      expect(taskStatus(started.orchestrator, started.task.id)).toBe("waiting");
      yield* Effect.promise(() => started.orchestrator.stop(started.task.id));
      yield* advance(2 * HOUR);

      expect(started.workers.some((worker) => worker.openedSessionFile !== undefined)).toBe(false);
      expect(taskStatus(started.orchestrator, started.task.id)).toBe("stopped");
      yield* Effect.promise(() => started.orchestrator.dispose());
    }),
  );

it("drops the wait when the task is stopped", dropsTheWaitWhenTheTaskIsStopped);

const keepsWaitingWhileResumesMakeProgress = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* startedTask;
      yield* limitAgain(started, 0, false);
      for (const index of [1, 2, 3]) {
        yield* resumeAll(started, index + 1);
        yield* limitAgain(started, index, true);
      }

      expect(taskStatus(started.orchestrator, started.task.id)).toBe("waiting");
      expect(snapshotOf(started)?.waitingReason?.detail).toContain("resumes");
      yield* resumeAll(started, 5);
      yield* Effect.promise(() => started.orchestrator.dispose());
    }),
  );

it(
  "keeps resuming when each resumed thread made progress before it hit the limit again",
  keepsWaitingWhileResumesMakeProgress,
);

const waitsAgainWhenAResumeStopsOnAnotherError = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const started = yield* startedTask;
      yield* limitAgain(started, 0, false);
      yield* resumeAll(started, 2);
      yield* limitAgain(started, 1, false, () => ({
        errorMessage: "Unauthorized",
        errorStatus: 401,
      }));

      expect(snapshotOf(started)?.waitingReason?.detail).toContain("resumes");
      yield* advance(16 * MINUTE);
      expect(started.workers).toHaveLength(3);
      yield* Effect.promise(() => started.orchestrator.dispose());
    }),
  );

it(
  "waits for the reset again when a resumed thread stops on another kind of provider error",
  waitsAgainWhenAResumeStopsOnAnotherError,
);
