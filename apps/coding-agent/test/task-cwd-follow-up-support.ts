import testing from "@msa/testing";
import { Effect } from "effect";

import type orchestratorTypes from "../src/core/orchestrator/orchestrator.types.ts";
import goalChecksSupport from "./orchestrator-goal-checks-support.ts";
import type orchestratorHarness from "./orchestrator-harness.ts";
import orchestratorSupport from "./orchestrator-support.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath } = testing;
const { LINT_CHECK } = goalChecksSupport;
const { create } = orchestratorSupport;
const { withRemote } = pullRequestSupport;
const { GIT, sh } = worktreeSupport;

type Session = ReturnType<typeof orchestratorHarness.harness.setup>;

const threadsOf = (orchestrator: orchestratorTypes.Orchestrator, taskId: string) =>
  orchestrator.snapshot.threads.filter((thread) =>
    thread.tasks.some((assignment) => assignment.taskId === taskId),
  ).length;

const refusalsOf = (session: Session, taskId: string) =>
  session.reports.filter(
    (report) => report.details.taskId === taskId && report.details.status === "stopped",
  );

const reportedStarted = (session: Session) =>
  session.reports.flatMap((report) => report.details.started);

function withLintRepository<A, E>(body: (repository: string) => Effect.Effect<A, E>) {
  return withRemote(({ repository }) =>
    Effect.gen(function* () {
      yield* sh(
        `mkdir app && echo "0 errors" > app/lint.txt && git add app && ${GIT} commit -q -m lint && git push -q origin main`,
        repository,
      );
      return yield* body(repository);
    }),
  );
}

const lintTask = (session: Session, repository: string, opensPullRequest = true) =>
  create(session.orchestrator, {
    checks: [LINT_CHECK],
    currentState: "lint reports 3 errors",
    cwd: joinPath(repository, "app"),
    goalState: "lint reports 0 errors",
    opensPullRequest,
    title: "lint",
  });

const removeTaskCwd = (repository: string) => sh("rm -rf app", repository);

const taskCwdFollowUpSupport = {
  lintTask,
  refusalsOf,
  removeTaskCwd,
  reportedStarted,
  threadsOf,
  withLintRepository,
};

export default taskCwdFollowUpSupport;
