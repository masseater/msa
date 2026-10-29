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
const { LINT_CHECK } = goalChecksSupport;
const { create } = orchestratorSupport;
const { harness } = orchestratorHarness;
const { setup, taskStatus, waitFor } = harness;
const { sh, withRepository } = worktreeSupport;
const { runCommand } = orchestratorCallbacks;

type Session = ReturnType<typeof setup>;

function withOutside<A, E>(body: (outside: string) => Effect.Effect<A, E>) {
  return Effect.acquireUseRelease(makeTempDir("msa-task-cwd-start-"), body, (outside) =>
    removePath(outside),
  );
}

const threadsOf = (orchestrator: orchestratorTypes.Orchestrator, taskId: string) =>
  orchestrator.snapshot.threads.filter((thread) =>
    thread.tasks.some((assignment) => assignment.taskId === taskId),
  ).length;

const refusalsOf = (session: Session, taskId: string) =>
  session.reports.filter(
    (report) => report.details.taskId === taskId && report.details.status === "stopped",
  );

function lintAfterABlocker(session: Session, cwd: string) {
  return Effect.gen(function* () {
    const blocker = yield* create(session.orchestrator, {
      currentState: "the notes are scattered",
      goalState: "the notes are in one file",
      title: "gather notes",
    });
    const lint = yield* create(session.orchestrator, {
      checks: [LINT_CHECK],
      currentState: "lint reports 3 errors",
      cwd,
      dependsOn: [blocker.id],
      goalState: "lint reports 0 errors",
      title: "lint",
    });
    return { blocker, lint };
  });
}

function finishBlocker(session: Session, blockerId: string) {
  return Effect.gen(function* () {
    session.workers[0]!.complete("the notes are in notes.md");
    yield* waitFor(() => session.workers.length === 2);
    session.workers[1]!.complete("acceptable");
    yield* waitFor(() => taskStatus(session.orchestrator, blockerId) === "completed");
  });
}

const refusesToStartALintTaskWhoseCwdLeftGit = () =>
  Effect.runPromise(
    withOutside((outside) =>
      withRepository((repository) =>
        Effect.gen(function* () {
          const session = setup({ cwd: outside, maxConcurrent: 2, runCommand });
          const { orchestrator } = session;
          const cwd = joinPath(repository, "app");
          const { blocker, lint } = yield* lintAfterABlocker(session, cwd);
          yield* sh("rm -rf .git", repository);

          yield* finishBlocker(session, blocker.id);
          yield* waitFor(() => refusalsOf(session, lint.id).length === 1);
          const [refused] = refusalsOf(session, lint.id);
          expect(refused?.text).toContain(` ${cwd} `);
          expect(refused?.text).toContain(`Replan with ${lint.id} in from and cwd`);
          expect(taskStatus(orchestrator, lint.id)).toBe("stopped");
          expect(threadsOf(orchestrator, lint.id)).toBe(0);
          expect(session.workers).toHaveLength(2);

          yield* Effect.promise(() =>
            expect(orchestrator.rerun(lint.id)).rejects.toThrow(`Replan with ${lint.id} in from`),
          );
          expect(taskStatus(orchestrator, lint.id)).toBe("stopped");
          expect(refusalsOf(session, lint.id)).toHaveLength(2);
          yield* Effect.promise(() =>
            expect(orchestrator.sendMessage(lint.id, "try again")).rejects.toThrow(
              `Replan with ${lint.id} in from`,
            ),
          );
          expect(taskStatus(orchestrator, lint.id)).toBe("stopped");
          expect(refusalsOf(session, lint.id)).toHaveLength(3);
          expect(threadsOf(orchestrator, lint.id)).toBe(0);
          expect(session.workers).toHaveLength(2);
        }),
      ),
    ),
  );

it(
  "refuses to start a task with checks whose cwd is no longer a git working tree when its dependency completes, on rerun_task, and on send_message, and starts no thread",
  refusesToStartALintTaskWhoseCwdLeftGit,
);

const startsALintTaskInARepositoryAsBefore = () =>
  Effect.runPromise(
    withOutside((outside) =>
      withRepository((repository) =>
        Effect.gen(function* () {
          const session = setup({ cwd: outside, maxConcurrent: 2, runCommand });
          const { orchestrator } = session;
          const { blocker, lint } = yield* lintAfterABlocker(session, joinPath(repository, "app"));

          yield* finishBlocker(session, blocker.id);
          yield* waitFor(() => taskStatus(orchestrator, lint.id) === "running");
          expect(threadsOf(orchestrator, lint.id)).toBe(1);
          expect(session.workers[2]!.cwd).not.toBe(joinPath(repository, "app"));

          yield* Effect.promise(() => orchestrator.stop(lint.id));
          const rerun = yield* Effect.promise(() => orchestrator.rerun(lint.id));
          expect(rerun.status).toBe("running");
          expect(threadsOf(orchestrator, lint.id)).toBe(2);
          expect(refusalsOf(session, lint.id)).toEqual([]);
        }),
      ),
    ),
  );

it(
  "starts a task with checks in a repository when its dependency completes and on rerun_task, as before",
  startsALintTaskInARepositoryAsBefore,
);
