import ai from "@msa/ai";
import testing from "@msa/testing";
import { Clock, Effect } from "effect";
import { ChildProcess } from "effect/process";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";

const { fauxAssistantMessage } = ai;
const { makeTempDir, provideNode, removePath } = testing;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;

const HOUR = 60 * 60_000;

const TASK = {
  currentState: "src/cache.ts has no cache",
  goalState: "repeated reads hit the cache",
  title: "cache reads",
};

const threadStatus = (orchestrator: ReturnType<typeof setup>["orchestrator"], taskId: string) =>
  orchestrator.snapshot.threads.find((thread) =>
    thread.tasks.some((assignment) => assignment.taskId === taskId),
  )?.status;

const stopsAThreadThatMakesNoToolCall = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, workers } = setup({
        watchdog: { idleMs: 50, intervalMs: 10 },
      });
      const task = yield* create(orchestrator, TASK);
      expect(taskStatus(orchestrator, task.id)).toBe("running");

      yield* waitFor(() => taskStatus(orchestrator, task.id) === "stopped");

      expect(threadStatus(orchestrator, task.id)).toBe("stopped");
      expect(workers[0]?.isStreaming).toBe(false);
      expect(reports.at(-1)?.details).toMatchObject({ status: "failed", taskId: task.id });
      expect(reports.at(-1)?.text).toMatch(/no tool call or message for \d+s \(running \d+s\)/u);
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it("stops a thread that makes no tool call for the idle time", stopsAThreadThatMakesNoToolCall);

const failsAThreadWhoseTurnAbortedWithoutSettling = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, workers } = setup({
        watchdog: { idleMs: HOUR, intervalMs: 10 },
      });
      const task = yield* create(orchestrator, TASK);
      const worker = workers[0];
      if (worker === undefined) throw new Error("no worker started");
      worker.messages = [
        fauxAssistantMessage("", {
          errorMessage: "The operation was aborted.",
          stopReason: "aborted",
        }),
      ];
      worker.isStreaming = false;

      yield* waitFor(() => taskStatus(orchestrator, task.id) === "failed");

      expect(threadStatus(orchestrator, task.id)).toBe("failed");
      expect(reports.at(-1)?.text).toMatch(
        /the last turn ended with aborted: The operation was aborted\. \d+s ago/u,
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

const reportsHowLongAFailedThreadRan = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports, workers } = setup();
      const task = yield* create(orchestrator, TASK);

      workers[0]?.fail(new Error("You've hit your session limit"));
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "failed");

      expect(reports.at(-1)?.text).toMatch(
        /^cache reads \(worker\) failed\. The thread ran for \d+s\.\n\n<report>\nYou've hit your session limit/u,
      );
    }),
  );

it("reports how long a failed thread ran", reportsHowLongAFailedThreadRan);

const stopsATaskLeftRunningAfterItsThreadEnded = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports } = setup({ watchdog: { idleMs: HOUR, intervalMs: 10 } });
      const task = yield* create(orchestrator, TASK);
      yield* Effect.promise(() => orchestrator.stop(task.id));
      const now = yield* Clock.currentTimeMillis;
      orchestrator.database
        .prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ?")
        .run(now - 2 * HOUR, task.id);
      yield* Effect.promise(() => orchestrator.refresh());
      expect(taskStatus(orchestrator, task.id)).toBe("running");

      yield* waitFor(() => taskStatus(orchestrator, task.id) === "stopped");

      expect(reports.at(-1)?.text).toMatch(/running with no running thread for 2h 0m/u);
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it("stops a task left running after its thread ended", stopsATaskLeftRunningAfterItsThreadEnded);

const stopsAThreadTheDatabaseMarksRunningWithoutARun = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, reports } = setup({ watchdog: { idleMs: HOUR, intervalMs: 10 } });
      const task = yield* create(orchestrator, TASK);
      yield* Effect.promise(() => orchestrator.stop(task.id));
      orchestrator.database
        .prepare("UPDATE tasks SET status = 'running' WHERE id = ?")
        .run(task.id);
      const now = yield* Clock.currentTimeMillis;
      orchestrator.database
        .prepare("UPDATE threads SET status = 'running', updated_at = ?")
        .run(now - 7 * HOUR);
      yield* Effect.promise(() => orchestrator.refresh());
      expect(threadStatus(orchestrator, task.id)).toBe("running");

      yield* waitFor(() => taskStatus(orchestrator, task.id) === "stopped");

      expect(threadStatus(orchestrator, task.id)).toBe("stopped");
      expect(reports.at(-1)?.text).toMatch(
        /no live run in this orchestrator; last update 7h 0m ago/u,
      );
      yield* Effect.promise(() => orchestrator.dispose());
    }),
  );

it(
  "stops a thread the database marks running without a run",
  stopsAThreadTheDatabaseMarksRunningWithoutARun,
);

const deadPid = provideNode(
  Effect.scoped(
    Effect.gen(function* () {
      const child = yield* ChildProcess.make("node", ["-e", ""], {
        stderr: "ignore",
        stdin: "ignore",
        stdout: "ignore",
      });
      yield* child.exitCode;
      return Number(child.pid);
    }),
  ),
).pipe(Effect.orDie);

const stopsThreadsWhoseOrchestratorProcessIsGone = () =>
  Effect.gen(function* () {
    const directory = yield* makeTempDir("msa-orchestrator-watchdog-");
    const databasePath = `${directory}/orchestrator.db`;
    const previous = setup({ databasePath, project: "previous" });
    const task = yield* create(previous.orchestrator, TASK);
    yield* Effect.promise(() => previous.orchestrator.dispose());

    const current = setup({
      databasePath,
      project: "current",
      watchdog: { idleMs: HOUR, intervalMs: 10 },
    });
    const pid = yield* deadPid;
    current.orchestrator.database
      .prepare("UPDATE orchestrator_state SET owner_pid = ? WHERE project = 'previous'")
      .run(pid);
    const status = () =>
      (
        current.orchestrator.database
          .prepare("SELECT status FROM tasks WHERE id = ?")
          .get(task.id) as { status: string }
      ).status;
    expect(status()).toBe("running");

    yield* waitFor(() => status() === "stopped");

    expect(current.reports.at(-1)?.text).toMatch(
      new RegExp(`orchestrator process ${pid} is gone \\(project previous\\); last update`, "u"),
    );
    yield* Effect.promise(() => current.orchestrator.dispose());
    yield* removePath(directory);
  });

it("stops threads whose orchestrator process is gone", () =>
  Effect.runPromise(Effect.scoped(stopsThreadsWhoseOrchestratorProcessIsGone())));

const leavesALiveOrchestratorsThreadsAlone = () =>
  Effect.gen(function* () {
    const directory = yield* makeTempDir("msa-orchestrator-watchdog-");
    const databasePath = `${directory}/orchestrator.db`;
    const other = setup({ databasePath, project: "other" });
    const task = yield* create(other.orchestrator, TASK);
    const current = setup({
      databasePath,
      project: "current",
      watchdog: { idleMs: HOUR, intervalMs: 10 },
    });

    yield* Effect.sleep(50);

    yield* Effect.promise(() => other.orchestrator.refresh());
    expect(taskStatus(other.orchestrator, task.id)).toBe("running");
    expect(current.reports).toEqual([]);
    yield* Effect.promise(() => current.orchestrator.dispose());
    yield* Effect.promise(() => other.orchestrator.dispose());
    yield* removePath(directory);
  });

it("leaves the threads of a live orchestrator alone", () =>
  Effect.runPromise(Effect.scoped(leavesALiveOrchestratorsThreadsAlone())));
