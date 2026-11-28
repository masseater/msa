import testing from "@msa/testing";
import { Effect, Result } from "effect";
import { expect, it, vi } from "vite-plus/test";

import errors from "../src/core/orchestrator/errors.ts";
import goalChecksSupport from "./orchestrator-goal-checks-support.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import watchdogSupport from "./orchestrator-watchdog-support.ts";
import triageSupport from "./triage-support.ts";

const { joinPath, pollUntil, writeTextFile } = testing;
const { escalateTriage } = triageSupport;
const { LINT_CHECK, SHORTCUT_CHECK, inCheckedRepository, inHeldRepository, lintTaskOf } =
  goalChecksSupport;
const { orchestratorError } = errors;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { advance, fakeClock } = watchdogSupport;

const returnsAFailingReportToTheWorker = () =>
  inCheckedRepository(({ orchestrator, reports, workers }) =>
    Effect.gen(function* () {
      const task = yield* create(
        orchestrator,
        lintTaskOf([LINT_CHECK, SHORTCUT_CHECK], {
          goalState: "lint reports 0 errors without layering classes to dodge the rule",
        }),
      );
      const worktree = workers[0]!.cwd;
      yield* writeTextFile(joinPath(worktree, "lint.txt"), "3 errors\n");
      yield* writeTextFile(joinPath(worktree, "src.txt"), "class Base {}\n");
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

      yield* writeTextFile(joinPath(worktree, "lint.txt"), "0 errors\n");
      yield* writeTextFile(joinPath(worktree, "src.txt"), "class layer-1 {}\n");
      workers[0]?.complete("lint is clean now");
      yield* waitFor(() => workers[0]?.prompts.length === 3);
      expect(workers[0]?.prompts[2]).toContain(
        `<check command="grep -c &apos;layer-[0-9]&apos; src.txt" expected="exit 1" got="exit 0" passed="false">\n1`,
      );
      expect(workers).toHaveLength(1);

      yield* writeTextFile(joinPath(worktree, "src.txt"), "class Base {}\n");
      workers[0]?.complete("removed the layering");
      yield* waitFor(() => workers.length === 2);
      expect(workers[1]?.prompts[0]).toContain("removed the layering");

      workers[1]?.complete("acceptable");
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "completed");
    }),
  );

it(
  "returns a report that fails the goal's checks to the worker and starts the reviewer only once they pass",
  returnsAFailingReportToTheWorker,
);

const asksForADecisionWhenTheChecksStopMoving = () =>
  inCheckedRepository(({ orchestrator, reports, workers }) =>
    Effect.gen(function* () {
      const task = yield* create(
        orchestrator,
        lintTaskOf([LINT_CHECK], { currentState: "lint reports 9 errors" }),
      );
      const worktree = workers[0]!.cwd;
      yield* writeTextFile(joinPath(worktree, "lint.txt"), "9 errors\n");
      for (let attempt = 1; attempt <= 5; attempt++) {
        workers[0]?.complete(`done, try ${attempt}`);
        yield* waitFor(() => workers[0]?.prompts.length === attempt + 1);
        yield* writeTextFile(joinPath(worktree, "lint.txt"), `${9 - attempt} errors\n`);
      }
      expect(taskStatus(orchestrator, task.id)).toBe("running");
      expect(reports).toEqual([]);

      workers[0]?.complete("done, try 6");
      yield* waitFor(() => workers[0]?.prompts.length === 7);
      workers[0]?.complete("done, try 7");
      yield* escalateTriage(workers);
      yield* waitFor(() => taskStatus(orchestrator, task.id) === "needs-decision");
      expect(workers).toHaveLength(2);
      expect(reports.at(-1)?.details.status).toBe("needs-decision");
      expect(reports.at(-1)?.text).toContain("exactly the same result");
      expect(reports.at(-1)?.text).toContain("4 errors");

      yield* writeTextFile(joinPath(worktree, "lint.txt"), "0 errors\n");
      yield* Effect.promise(() => orchestrator.sendMessage(task.id, "Fix the remaining four."));
      yield* waitFor(() => workers[0]?.prompts.length === 8);
      expect(workers[0]?.prompts[7]).toContain("Fix the remaining four.");
      workers[0]?.complete("fixed the remaining four");
      yield* waitFor(() => workers.length === 3);
    }),
  );

it(
  "returns failing checks to the worker for as many turns as their result changes, and waits for a decision when a turn ends with the same result",
  asksForADecisionWhenTheChecksStopMoving,
);

const deliversANoteSentWhileTheChecksRun = () =>
  inHeldRepository(({ held, orchestrator, workers }) =>
    Effect.gen(function* () {
      const task = yield* create(orchestrator, lintTaskOf([LINT_CHECK]));
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
  inHeldRepository(({ held, orchestrator, workers }) =>
    Effect.gen(function* () {
      const task = yield* create(orchestrator, lintTaskOf([LINT_CHECK, SHORTCUT_CHECK]));
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
  inHeldRepository(({ held, orchestrator, workers }) =>
    Effect.gen(function* () {
      yield* fakeClock();
      try {
        const task = yield* create(orchestrator, lintTaskOf([LINT_CHECK]));
        workers[0]?.complete("lint is clean");
        yield* advance(0);
        expect(held.calls).toHaveLength(1);
        yield* advance(2 * 60 * 60_000);
        expect(held.calls[0]?.signal.aborted).toBe(false);
        expect(taskStatus(orchestrator, task.id)).toBe("running");
        held.calls[0]?.release();
        yield* pollUntil(
          Effect.sync(() => workers.length === 2),
          100,
          advance(100),
        );
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
  inCheckedRepository(
    ({ orchestrator }) =>
      Effect.gen(function* () {
        yield* create(orchestrator, {
          currentState: "something else runs",
          goalState: "it is done",
          title: "blocker",
        });
        const waiting = yield* create(orchestrator, lintTaskOf([LINT_CHECK]));
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
    { maxConcurrent: 1 },
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
            orchestrator.createTask(lintTaskOf([{ command: "cat lint.txt", output: "(" }])),
        }),
      );
      expect(Result.isFailure(created)).toBe(true);
      expect(orchestrator.snapshot.tasks).toEqual([]);
      expect(workers).toHaveLength(0);
    }),
  );

it("rejects a check whose output pattern is not a regular expression", rejectsAnUnreadableCheck);
