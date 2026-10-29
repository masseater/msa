import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorCallbacks from "../src/core/agent-session/orchestrator-callbacks.ts";
import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import goalChecksSupport from "./orchestrator-goal-checks-support.ts";
import orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath, makeTempDir, removePath } = testing;
const { LINT_CHECK, SHORTCUT_CHECK } = goalChecksSupport;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup } = harness;
const { withRepository } = worktreeSupport;
const { runCommand } = orchestratorCallbacks;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const refusal = (attempt: () => Promise<unknown>) =>
  Effect.promise(() =>
    attempt().then(
      () => undefined,
      (error: unknown) => messageOf(error),
    ),
  );

function withOutside<A, E>(body: (outside: string) => Effect.Effect<A, E>) {
  return Effect.acquireUseRelease(makeTempDir("msa-task-cwd-"), body, (outside) =>
    removePath(outside),
  );
}

const workTasks = (orchestrator: orchestratorTypes.Orchestrator) =>
  orchestrator.snapshot.tasks
    .filter((task) => task.kind === "work")
    .map((task) => ({ checks: task.checks.length, cwd: task.cwd, title: task.title }));

function expectRefusedFor(message: string | undefined, cwd: string) {
  expect(message).toContain(` ${cwd} `);
  expect(message).toContain("checkout");
}

function sessionOutsideARepository(outside: string) {
  return Effect.gen(function* () {
    const session = setup({ cwd: outside, maxConcurrent: 1, runCommand });
    yield* create(session.orchestrator, {
      currentState: "something else runs",
      goalState: "it is done",
      title: "blocker",
    });
    const plain = yield* create(session.orchestrator, {
      currentState: "notes are scattered",
      goalState: "notes are in one file",
      title: "gather notes",
    });
    return { ...session, plain };
  });
}

const LINT = {
  checks: [LINT_CHECK],
  currentState: "lint reports 3 errors",
  goalState: "lint reports 0 errors",
};

function attemptEveryPath(
  orchestrator: orchestratorTypes.Orchestrator,
  plain: string,
  outside: string,
) {
  const nested = joinPath(outside, "missing");
  return Effect.all([
    Effect.map(
      refusal(() => orchestrator.createTask({ ...LINT, dependsOn: [plain], title: "lint" })),
      (message) => ({ cwd: outside, message }),
    ),
    Effect.map(
      refusal(() =>
        orchestrator.createTask({ ...LINT, cwd: nested, dependsOn: [plain], title: "lint" }),
      ),
      (message) => ({ cwd: nested, message }),
    ),
    Effect.map(
      refusal(() =>
        orchestrator.replan({
          reason: "add lint",
          stop: false,
          tasks: [{ ...LINT, title: "lint" }],
        }),
      ),
      (message) => ({ cwd: outside, message }),
    ),
    Effect.map(
      refusal(() =>
        orchestrator.replan({
          reason: "measure the notes",
          stop: false,
          tasks: [{ checks: [LINT_CHECK], from: [plain], title: "gather notes, checked" }],
        }),
      ),
      (message) => ({ cwd: outside, message }),
    ),
    Effect.map(
      refusal(() => orchestrator.setState({ checks: [LINT_CHECK], taskId: plain })),
      (message) => ({ cwd: outside, message }),
    ),
  ]);
}

const refusesChecksOutsideARepositoryOnEveryPath = () =>
  Effect.runPromise(
    withOutside((outside) =>
      Effect.gen(function* () {
        const { orchestrator, plain } = yield* sessionOutsideARepository(outside);
        const before = workTasks(orchestrator);
        expect(before).toEqual([
          { checks: 0, cwd: outside, title: "blocker" },
          { checks: 0, cwd: outside, title: "gather notes" },
        ]);

        const refusals = yield* attemptEveryPath(orchestrator, plain.id, outside);
        expect(refusals).toHaveLength(5);
        for (const { cwd, message } of refusals) expectRefusedFor(message, cwd);
        expect(workTasks(orchestrator)).toEqual(before);
        expect(orchestrator.snapshot.replans).toEqual([]);
      }),
    ),
  );

it(
  "refuses a task with checks whose cwd is not a git working tree on create_task, replan, and set_task_state, and names the cwd",
  refusesChecksOutsideARepositoryOnEveryPath,
);

const acceptsChecksInARepository = () =>
  Effect.runPromise(
    withOutside((outside) =>
      withRepository((repository) =>
        Effect.gen(function* () {
          const { orchestrator, plain } = yield* sessionOutsideARepository(outside);
          const subdirectory = joinPath(repository, "app");
          const created = yield* create(orchestrator, {
            ...LINT,
            cwd: subdirectory,
            dependsOn: [plain.id],
            title: "lint",
          });
          const edited = yield* Effect.promise(() =>
            orchestrator.setState({ checks: [LINT_CHECK, SHORTCUT_CHECK], taskId: created.id }),
          );
          expect(edited.checks).toHaveLength(2);
          const result = yield* Effect.promise(() =>
            orchestrator.replan({
              reason: "split the lint work",
              stop: false,
              tasks: [
                { from: [created.id], title: "lint again" },
                { ...LINT, cwd: repository, title: "lint the root" },
                { from: [plain.id], title: "gather notes again" },
              ],
            }),
          );
          expect(result.created).toHaveLength(3);
          expect(workTasks(orchestrator).slice(-3)).toEqual([
            { checks: 2, cwd: subdirectory, title: "lint again" },
            { checks: 1, cwd: repository, title: "lint the root" },
            { checks: 0, cwd: outside, title: "gather notes again" },
          ]);
        }),
      ),
    ),
  );

it(
  "creates, edits, and replaces a task with checks in a repository, and a task without checks anywhere, as before",
  acceptsChecksInARepository,
);
