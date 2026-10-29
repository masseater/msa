import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import type orchestratorHarnessTypes from "./orchestrator-harness.types.ts";
import pullRequestSupport from "./pull-request-support.ts";
import reviewVerdictSupport from "./review-verdict-support.ts";
import triageSupport from "./triage-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { runTest } = testing;
const { taskStatus, waitFor } = orchestratorHarness.harness;
const { cleanedUp, commitAndPush, holdBranchDeletion, openedTask, withRemote } = pullRequestSupport;
const { classifierDecide } = reviewVerdictSupport;
const { escalateTriage } = triageSupport;
const { read, sh } = worktreeSupport;

type Remote = Parameters<Parameters<typeof withRemote>[0]>[0];

const NOT_OPEN = "still carries open pull request";

function squashMessage(number: number, branch: string): string {
  return `Add ${branch} (#${number})\n\nfeature.txt\n\nMsa-Merge: 5f0c2b1e-orchestrator`;
}

const waitingForADecision = (
  remote: Remote,
  options: orchestratorHarnessTypes.HarnessOptions = {},
) =>
  Effect.gen(function* () {
    const { github } = remote;
    const opened = yield* openedTask(remote, {
      decide: classifierDecide({ unavailable: "the classifier backend cannot load" }),
      ...options,
    });
    const { orchestrator, taskId, workers } = opened;
    const reviewed = yield* github.head(opened.branch);
    github.ci.set(reviewed, "success");
    const worktree = workers[0]!.cwd;
    workers[0]!.complete("CI is green");
    yield* waitFor(() => workers.length === 2);
    yield* Effect.promise(() =>
      workers[1]!.recordGoalItems(
        [{ evidence: "feature.txt is in the diff", item: 1, status: "met" }],
        ["The body does not name feature.txt."],
      ),
    );
    workers[1]!.completeUnrecorded("feature.txt is added.");
    yield* escalateTriage(workers);
    yield* waitFor(() => taskStatus(orchestrator, taskId) === "needs-decision");
    return { ...opened, reviewed, worktree };
  });

const completesWhenTheReviewedHeadIsMergedOutside = () =>
  runTest(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { branch, number, orchestrator, reports, reviewed, taskId, worktree } =
          yield* waitingForADecision(remote, { pullRequestSyncMs: 20 });
        const commit = yield* github.mergeOutside(
          number,
          "orchestrator-account",
          squashMessage(number, branch),
        );

        yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
        yield* waitFor(() => reports.at(-1)?.details.status === "completed");
        expect(github.merged).toEqual([]);
        expect(reports.at(-1)?.details).toMatchObject({ status: "completed", taskId });
        expect(reports.at(-1)?.text).toContain(`PR #${number}`);
        expect(reports.at(-1)?.text).toContain(reviewed.slice(0, 12));
        expect(reports.at(-1)?.text).toContain(commit.slice(0, 12));
        expect(reports.at(-1)?.text).not.toContain(NOT_OPEN);
        const view = yield* read(orchestrator, taskId);
        expect(view.pullRequest).toMatchObject({ mergeCommit: commit, number, state: "MERGED" });
        expect((yield* cleanedUp(remote, worktree, branch)).worktree).toBe(false);
      }),
    ),
  );

it(
  "completes a task waiting for a decision once its pull request is merged outside the harness at the head its review checked with the Msa-Merge trailer",
  completesWhenTheReviewedHeadIsMergedOutside,
);

const stopsWhenAnotherHeadIsMergedOutside = () =>
  runTest(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { branch, number, orchestrator, reports, reviewed, taskId, worktree } =
          yield* waitingForADecision(remote, { pullRequestSyncMs: 20 });
        yield* commitAndPush(worktree, "extra.txt", branch);
        const head = yield* github.head(branch);
        github.ci.set(head, "success");
        const commit = yield* github.mergeOutside(
          number,
          "orchestrator-account",
          squashMessage(number, branch),
        );

        yield* waitFor(() => taskStatus(orchestrator, taskId) === "stopped");
        expect(reports.at(-1)?.details).toMatchObject({ status: "stopped", taskId });
        expect(reports.at(-1)?.text).toContain(commit.slice(0, 12));
        expect(reports.at(-1)?.text).toContain(
          `merged at head ${head.slice(0, 12)}, not at the head ${reviewed.slice(0, 12)} its review checked`,
        );
        yield* Effect.sleep(100);
        expect(taskStatus(orchestrator, taskId)).toBe("stopped");
        expect(reports.filter((report) => report.details.status === "stopped")).toHaveLength(1);
      }),
    ),
  );

it(
  "stops, not completes, a task waiting for a decision when a head its review did not check is merged outside the harness, even with the Msa-Merge trailer",
  stopsWhenAnotherHeadIsMergedOutside,
);

const saysNothingOfAPullRequestMergedAfterItsWorktreeWasRemoved = () =>
  runTest(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github, repository } = remote;
        const { branch, number, orchestrator, reports, taskId, worktree } =
          yield* waitingForADecision(remote);
        yield* commitAndPush(worktree, "extra.txt", branch);
        yield* github.mergeOutside(number, "orchestrator-account", squashMessage(number, branch));
        yield* sh(`git worktree remove --force ${worktree}`, repository);
        const before = reports.length;

        const stopped = yield* Effect.promise(() => orchestrator.stop(taskId));
        expect(stopped.status).toBe("stopped");
        expect(stopped.pullRequest).toMatchObject({ number, state: "MERGED" });
        expect(reports.slice(before).map((report) => report.text)).not.toContainEqual(
          expect.stringContaining(NOT_OPEN),
        );

        const result = yield* Effect.promise(() =>
          orchestrator.replan({
            drop: [{ reason: "it is merged", taskId }],
            reason: "the work reached main",
            stop: false,
          }),
        );
        expect(result.orphaned).toEqual([]);
      }),
    ),
  );

it(
  "does not report a pull request merged on GitHub as still open when its task stops or is dropped, even after its worktree was removed",
  saysNothingOfAPullRequestMergedAfterItsWorktreeWasRemoved,
);

const keepsTheLockFreeWhileTheSyncAsksGitHub = () =>
  runTest(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { branch, number, orchestrator, taskId } = yield* waitingForADecision(remote, {
          pullRequestSyncMs: 20,
        });
        github.hold();
        const asked = github.calls;
        yield* github.mergeOutside(number, "orchestrator-account", squashMessage(number, branch));
        yield* waitFor(() => github.calls > asked);

        let refreshed = false;
        void orchestrator.refresh().then(() => {
          refreshed = true;
          return undefined;
        });
        yield* waitFor(() => refreshed);
        expect(github.answered).toBeLessThan(github.calls);
        expect(taskStatus(orchestrator, taskId)).toBe("needs-decision");

        github.release();
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
      }),
    ),
  );

it(
  "keeps the orchestrator lock free while the pull request sync asks GitHub about a task waiting for a decision",
  keepsTheLockFreeWhileTheSyncAsksGitHub,
);

const disposesOnlyAfterTheCleanupTheSyncStarted = () =>
  runTest(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github, repository } = remote;
        const { branch, number, orchestrator, taskId, worktree } = yield* waitingForADecision(
          remote,
          { pullRequestSyncMs: 20 },
        );
        const deletion = yield* holdBranchDeletion(repository, branch);
        yield* github.mergeOutside(number, "orchestrator-account", squashMessage(number, branch));
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
        yield* deletion.entered;

        let disposed = false;
        const disposing = orchestrator.dispose().then(() => {
          disposed = true;
          return undefined;
        });
        yield* Effect.sleep(100);
        expect(disposed).toBe(false);

        yield* deletion.release;
        yield* Effect.promise(() => disposing);
        expect(yield* cleanedUp(remote, worktree, branch)).toEqual({
          local: false,
          remote: false,
          worktree: false,
        });
      }),
    ),
  );

it(
  "returns from dispose only after the worktree, branch, and origin branch the pull request sync started removing are gone",
  disposesOnlyAfterTheCleanupTheSyncStarted,
);

const removesTheRepositoryAfterTheCleanupTheSyncStarted = () =>
  runTest(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github, repository } = remote;
        const { branch, number, orchestrator, taskId } = yield* waitingForADecision(remote, {
          pullRequestSyncMs: 20,
        });
        const deletion = yield* holdBranchDeletion(repository, branch);
        yield* github.mergeOutside(number, "orchestrator-account", squashMessage(number, branch));
        yield* waitFor(() => taskStatus(orchestrator, taskId) === "completed");
        yield* deletion.entered;
        yield* Effect.forkDetach(Effect.delay(deletion.release, "200 millis"));
      }),
    ),
  );

it(
  "removes the test repository only after the cleanup the pull request sync started for a completed task has ended",
  removesTheRepositoryAfterTheCleanupTheSyncStarted,
);
