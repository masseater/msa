import testing from "@msa/testing";
import { Effect, Result } from "effect";
import { expect, it, vi } from "vite-plus/test";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import errors from "../src/core/orchestrator/errors.ts";
import goalChecksSupport from "./orchestrator-goal-checks-support.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";

const { joinPath, writeTextFile } = testing;
const { LINT_CHECK, SHORTCUT_CHECK, heldCommand, withRepo } = goalChecksSupport;
const { orchestratorError } = errors;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { advance, fakeClock } = watchdogSupport;

const returnsAFailingReportToTheWorker = () =>
  Effect.runPromise(
    withRepo((directory) =>
      Effect.gen(function* () {
        const { orchestrator, reports, workers } = setup({
          cwd: directory,
          runCommand: orchestratorCallbacks.runCommand,
        });
        yield* writeTextFile(joinPath(directory, "lint.txt"), "3 errors\n");
        yield* writeTextFile(joinPath(directory, "src.txt"), "class Base {}\n");
        const task = yield* create(orchestrator, {
          checks: [LINT_CHECK, SHORTCUT_CHECK],
          currentState: "lint reports 3 errors",
          goalState: "lint reports 0 errors without layering classes to dodge the rule",
          title: "lint",
        });
        expect(workers[0]?.prompts[0]).toContain("`cat lint.txt` → exit 0, output matching");

        workers[0]?.complete("lint is clean");
        yield* waitFor(() => workers[0]?.prompts.length === 2);
        expect(workers[0]?.prompts[1]).toContain("goal-checks-failed");
        expect(workers[0]?.prompts[1]).toContain(
          '<check command="cat lint.txt" expected="exit 0, output matching /^0 errors$/m" got="exit 0" passed="false">\n3 errors',
        );
        expect(workers).toHaveLength(1);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        expect(reports).toEqual([]);

        yield* writeTextFile(joinPath(directory, "lint.txt"), "0 errors\n");
        yield* writeTextFile(joinPath(directory, "src.txt"), "class layer-1 {}\n");
        workers[0]?.complete("lint is clean now");
        yield* waitFor(() => workers[0]?.prompts.length === 3);
        expect(workers[0]?.prompts[2]).toContain(
          `<check command="grep -c &apos;layer-[0-9]&apos; src.txt" expected="exit 1" got="exit 0" passed="false">\n1`,
        );
        expect(workers).toHaveLength(1);

        yield* writeTextFile(joinPath(directory, "src.txt"), "class Base {}\n");
        workers[0]?.complete("removed the layering");
        yield* waitFor(() => workers.length === 2);
        expect(workers[1]?.prompts[0]).toContain("removed the layering");

        workers[1]?.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
      }),
    ),
  );

it(
  "returns a report that fails the goal's checks to the worker and starts the reviewer only once they pass",
  returnsAFailingReportToTheWorker,
);

const failsTheTaskWhenTheChecksKeepFailing = () =>
  Effect.runPromise(
    withRepo((directory) =>
      Effect.gen(function* () {
        const { orchestrator, reports, workers } = setup({
          cwd: directory,
          runCommand: orchestratorCallbacks.runCommand,
        });
        yield* writeTextFile(joinPath(directory, "lint.txt"), "3 errors\n");
        const task = yield* create(orchestrator, {
          checks: [LINT_CHECK],
          currentState: "lint reports 3 errors",
          goalState: "lint reports 0 errors",
          title: "lint",
        });
        for (let attempt = 1; attempt <= 3; attempt++) {
          workers[0]?.complete(`done, try ${attempt}`);
          yield* waitFor(() => workers[0]?.prompts.length === attempt + 1);
        }
        workers[0]?.complete("done, try 4");
        yield* waitFor(() => taskStatus(orchestrator, task.id) === "failed");
        expect(workers).toHaveLength(1);
        expect(reports.at(-1)?.details.status).toBe("failed");
        expect(reports.at(-1)?.text).toContain("still fail after 3 rounds of fixes");
        expect(reports.at(-1)?.text).toContain("3 errors");
      }),
    ),
  );

it(
  "fails the task without a review when the checks still fail after three rounds",
  failsTheTaskWhenTheChecksKeepFailing,
);

const deliversANoteSentWhileTheChecksRun = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const held = heldCommand();
      const { orchestrator, workers } = setup({ runCommand: held.runCommand });
      const task = yield* create(orchestrator, {
        checks: [LINT_CHECK],
        currentState: "lint reports 3 errors",
        goalState: "lint reports 0 errors",
        title: "lint",
      });
      workers[0]?.complete("lint is clean");
      yield* waitFor(() => held.calls.length === 1);
      yield* Effect.promise(() => orchestrator.sendMessage(task.id, "also keep the old API"));
      held.calls[0]?.release();
      yield* waitFor(() => workers[0]?.prompts.length === 2);
      expect(workers[0]?.prompts[1]).toContain("also keep the old API");
      expect(workers).toHaveLength(1);

      workers[0]?.complete("kept the old API");
      yield* waitFor(() => held.calls.length === 2);
      held.calls[1]?.release();
      yield* waitFor(() => workers.length === 2);
      expect(workers[1]?.prompts[0]).toContain("kept the old API");
    }),
  );

it(
  "hands a message that arrives while the checks run to the worker before the review",
  deliversANoteSentWhileTheChecksRun,
);

const abortsTheChecksOfAStoppedTask = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const held = heldCommand();
      const { orchestrator, workers } = setup({ runCommand: held.runCommand });
      const task = yield* create(orchestrator, {
        checks: [LINT_CHECK, SHORTCUT_CHECK],
        currentState: "lint reports 3 errors",
        goalState: "lint reports 0 errors",
        title: "lint",
      });
      workers[0]?.complete("lint is clean");
      yield* waitFor(() => held.calls.length === 1);
      yield* Effect.promise(() => orchestrator.stop(task.id));
      yield* waitFor(() => held.calls[0]?.signal.aborted === true);
      yield* Effect.sleep(20);
      expect(held.calls).toHaveLength(1);
      const view = yield* Effect.promise(() => orchestrator.read(task.id));
      expect(view.assignments.map((assignment) => assignment.role)).toEqual(["worker"]);
      expect(view.status).toBe("stopped");
    }),
  );

it(
  "aborts the running check and skips the rest when the task stops",
  abortsTheChecksOfAStoppedTask,
);

const keepsAThreadAliveWhileItsChecksRun = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      yield* fakeClock();
      const held = heldCommand();
      const { orchestrator, workers } = setup({ runCommand: held.runCommand });
      try {
        const task = yield* create(orchestrator, {
          checks: [LINT_CHECK],
          currentState: "lint reports 3 errors",
          goalState: "lint reports 0 errors",
          title: "lint",
        });
        workers[0]?.complete("lint is clean");
        yield* advance(0);
        expect(held.calls).toHaveLength(1);
        yield* advance(2 * 60 * 60_000);
        expect(held.calls[0]?.signal.aborted).toBe(false);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        held.calls[0]?.release();
        yield* advance(1000);
        expect(workers).toHaveLength(2);
      } finally {
        yield* Effect.promise(() => orchestrator.dispose());
        vi.useRealTimers();
      }
    }),
  );

it(
  "keeps the watchdog from stopping a thread while the harness runs its checks",
  keepsAThreadAliveWhileItsChecksRun,
);

const carriesChecksThroughReplanAndStateEdits = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator } = setup({ maxConcurrent: 1 });
      yield* create(orchestrator, {
        currentState: "something else runs",
        goalState: "it is done",
        title: "blocker",
      });
      const waiting = yield* create(orchestrator, {
        checks: [LINT_CHECK],
        currentState: "lint reports 3 errors",
        goalState: "lint reports 0 errors",
        title: "lint",
      });
      const edited = yield* Effect.promise(() =>
        orchestrator.setState({ checks: [LINT_CHECK, SHORTCUT_CHECK], taskId: waiting.id }),
      );
      expect(edited.checks).toEqual([
        { command: "cat lint.txt", exitCode: 0, output: "^0 errors$" },
        { command: "grep -c 'layer-[0-9]' src.txt", exitCode: 1, output: null },
      ]);
      const result = yield* Effect.promise(() =>
        orchestrator.replan({
          keep: orchestrator.snapshot.tasks
            .filter((task) => task.status === "running")
            .map((task) => task.id),
          reason: "split the lint work",
          stop: false,
          tasks: [{ from: [waiting.id], title: "lint again" }],
        }),
      );
      const successor = orchestrator.snapshot.tasks.find(
        (task) => task.id === result.created[0]?.taskId,
      );
      expect(successor?.checks).toEqual(edited.checks);
    }),
  );

it(
  "keeps a task's checks through set_task_state and replan",
  carriesChecksThroughReplanAndStateEdits,
);

const rejectsAnUnreadableCheck = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const { orchestrator, workers } = setup();
      const created = yield* Effect.result(
        Effect.tryPromise({
          catch: orchestratorError,
          try: () =>
            orchestrator.createTask({
              checks: [{ command: "cat lint.txt", output: "(" }],
              currentState: "lint reports 3 errors",
              goalState: "lint reports 0 errors",
              title: "lint",
            }),
        }),
      );
      expect(Result.isFailure(created)).toBe(true);
      expect(orchestrator.snapshot.tasks).toEqual([]);
      expect(workers).toHaveLength(0);
    }),
  );

it("rejects a check whose output pattern is not a regular expression", rejectsAnUnreadableCheck);
