import ai from "@msa/ai";
import { Clock, Effect } from "effect";
import { afterEach, expect, it, vi } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";

const { fauxAssistantMessage } = ai;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus } = harness;
const { TASK, advance, fakeClock } = watchdogSupport;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

type Setup = ReturnType<typeof setup>;

afterEach(() => {
  vi.useRealTimers();
});

const threadStatus = (orchestrator: Setup["orchestrator"], taskId: string) =>
  orchestrator.snapshot.threads.find((thread) =>
    thread.tasks.some((assignment) => assignment.taskId === taskId),
  )?.status;

const startedTask = Effect.gen(function* () {
  yield* fakeClock();
  const started = setup();
  const task = yield* create(started.orchestrator, TASK);
  const worker = started.workers[0];
  if (worker === undefined) throw new Error("no worker started");
  expect(taskStatus(started.orchestrator, task.id)).toBe("running");
  return { ...started, task, worker };
});

const stopsAThreadThatMakesNoToolCallFor30Minutes = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, task } = yield* startedTask;

      yield* advance(29 * MINUTE);
      expect(taskStatus(orchestrator, task.id)).toBe("running");
      yield* advance(2 * MINUTE);

      expect(taskStatus(orchestrator, task.id)).toBe("stopped");
      expect(threadStatus(orchestrator, task.id)).toBe("stopped");
      expect(reports.at(-1)?.details).toMatchObject({ status: "failed", taskId: task.id });
      expect(reports.at(-1)?.text).toMatch(/no tool call or message for 30m \(running 30m\)/u);
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it(
  "stops a thread that makes no tool call for 30 minutes",
  stopsAThreadThatMakesNoToolCallFor30Minutes,
);

const givesARunningToolCall60Minutes = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, task, worker } = yield* startedTask;
      worker.messages = [fauxAssistantMessage("", { stopReason: "toolUse" })];

      yield* advance(59 * MINUTE);
      expect(taskStatus(orchestrator, task.id)).toBe("running");
      yield* advance(2 * MINUTE);

      expect(taskStatus(orchestrator, task.id)).toBe("stopped");
      expect(reports.at(-1)?.text).toMatch(/one tool call has run for 1h 0m \(running 1h 0m\)/u);
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it("gives a running tool call 60 minutes", givesARunningToolCall60Minutes);

const abortedTurn = () =>
  fauxAssistantMessage("", { errorMessage: "The operation was aborted.", stopReason: "aborted" });

const failsAThreadWhoseTurnAbortedWithoutSettling = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, task, worker } = yield* startedTask;
      worker.messages = [abortedTurn()];
      worker.isStreaming = false;

      yield* advance(2 * MINUTE);

      expect(taskStatus(orchestrator, task.id)).toBe("failed");
      expect(threadStatus(orchestrator, task.id)).toBe("failed");
      expect(reports.at(-1)?.text).toMatch(
        /the last turn ended with aborted: The operation was aborted\. 1m ago/u,
      );
      const view = yield* Effect.promise(() => orchestrator.read(task.id));
      expect(view.reports.at(-1)?.content).toContain("aborted");
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it(
  "fails a thread whose turn aborted but never settled",
  failsAThreadWhoseTurnAbortedWithoutSettling,
);

const leavesACompactingThreadAlone = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, task, worker } = yield* startedTask;
      worker.messages = [abortedTurn()];
      worker.isStreaming = false;
      worker.compaction.manual.isCompacting = true;

      yield* advance(2 * HOUR);
      expect(taskStatus(orchestrator, task.id)).toBe("running");

      worker.compaction.manual.isCompacting = false;
      yield* advance(MINUTE);
      expect(taskStatus(orchestrator, task.id)).toBe("failed");
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it("leaves a compacting thread alone", leavesACompactingThreadAlone);

const reportsHowLongAFailedThreadRan = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, task, worker } = yield* startedTask;
      yield* advance(90_000);

      worker.fail(new Error("You've hit your session limit"));
      yield* advance(0);

      expect(taskStatus(orchestrator, task.id)).toBe("failed");
      expect(reports.at(-1)?.text).toMatch(
        /^cache reads \(worker\) failed\. The thread ran for 1m\.\n\n<report>\nYou've hit your session limit/u,
      );
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it("reports how long a failed thread ran", reportsHowLongAFailedThreadRan);

const stopsATaskLeftRunningAfterItsThreadEnded = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, task } = yield* startedTask;
      yield* Effect.promise(() => orchestrator.stop(task.id));
      const now = yield* Clock.currentTimeMillis;
      orchestrator.database
        .prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?")
        .run(now - 2 * HOUR, task.id);

      yield* advance(MINUTE);

      expect(taskStatus(orchestrator, task.id)).toBe("stopped");
      expect(reports.at(-1)?.text).toMatch(/running with no running thread for 2h 1m/u);
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it("stops a task left running after its thread ended", stopsATaskLeftRunningAfterItsThreadEnded);

const stopsAThreadTheDatabaseMarksRunningWithoutARun = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, task } = yield* startedTask;
      yield* Effect.promise(() => orchestrator.stop(task.id));
      orchestrator.database
        .prepare("UPDATE tasks SET status = 'running' WHERE id = ?")
        .run(task.id);
      const now = yield* Clock.currentTimeMillis;
      orchestrator.database
        .prepare("UPDATE threads SET status = 'running', updated_at = ?")
        .run(now - 7 * HOUR);

      yield* advance(MINUTE);

      expect(taskStatus(orchestrator, task.id)).toBe("stopped");
      expect(threadStatus(orchestrator, task.id)).toBe("stopped");
      expect(reports.at(-1)?.text).toMatch(
        /no live run in this orchestrator; last update 7h 1m ago/u,
      );
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it(
  "stops a thread the database marks running without a run",
  stopsAThreadTheDatabaseMarksRunningWithoutARun,
);
