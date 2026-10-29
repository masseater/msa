import testing from "@msa/testing";
import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type execTypes from "../src/core/exec.types.ts";
import ghModule from "../src/core/pr-watch/gh.ts";

const { ghCompareArgs, ghPrViewArgs, ghRunsArgs, makeGh } = ghModule;

const { runTest } = testing;

const execResult = (overrides: Partial<execTypes.ExecResult> = {}): execTypes.ExecResult => ({
  code: 0,
  killed: false,
  stderr: "",
  stdout: "",
  ...overrides,
});

const viewJson = JSON.stringify({
  baseRefName: "main",
  comments: [{ body: "one" }, { body: "two" }],
  headRefOid: "abc123",
  mergeStateStatus: "BEHIND",
  mergeable: "MERGEABLE",
  reviewDecision: "REVIEW_REQUIRED",
  state: "OPEN",
  statusCheckRollup: [
    { __typename: "CheckRun", conclusion: "SUCCESS", name: "build", status: "COMPLETED" },
    { __typename: "CheckRun", conclusion: "FAILURE", name: "test", status: "COMPLETED" },
    {
      __typename: "CheckRun",
      conclusion: null,
      name: "lint",
      status: "IN_PROGRESS",
      workflowName: "verify",
    },
    { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS" },
  ],
  updatedAt: "2024-05-01T00:00:00Z",
});

const runGh = (result: execTypes.ExecResult) =>
  makeGh({
    cwd: "/tmp",
    find: () => "/usr/local/bin/gh",
    run: () => Promise.resolve(result),
  });

const asksGhForTheFieldsTheWatcher = () => {
  expect(ghPrViewArgs({ number: 12, repository: "masseater/msa" })).toEqual([
    "pr",
    "view",
    "12",
    "--repo",
    "masseater/msa",
    "--json",
    "state,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,comments,updatedAt,baseRefName,headRefOid",
  ]);
  expect(ghPrViewArgs({ number: 12 })).toEqual([
    "pr",
    "view",
    "12",
    "--json",
    "state,mergeable,mergeStateStatus,statusCheckRollup,reviewDecision,comments,updatedAt,baseRefName,headRefOid",
  ]);
};

const comparesTheHeadAgainstTheBaseTo = () => {
  expect(ghCompareArgs({ number: 12, repository: "masseater/msa" }, "main", "abc123")).toEqual([
    "api",
    "repos/masseater/msa/compare/main...abc123",
    "--jq",
    ".behind_by",
  ]);
  expect(ghCompareArgs({ number: 12 }, "main", "abc123")).toEqual([
    "api",
    "repos/{owner}/{repo}/compare/main...abc123",
    "--jq",
    ".behind_by",
  ]);
};

const turnsGhJsonIntoStateReviewDecision = () =>
  runTest(
    Effect.gen(function* () {
      const snapshot = yield* runGh(execResult({ stdout: viewJson })).view({ number: 12 });

      expect(snapshot).toEqual({
        baseRefName: "main",
        behindBy: undefined,
        checks: {
          cancelled: 0,
          failed: 1,
          passed: 2,
          pending: 1,
          pendingNames: ["lint"],
          pendingWorkflows: ["verify"],
          total: 4,
        },
        comments: 2,
        headRefOid: "abc123",
        mergeStateStatus: "BEHIND",
        mergeable: "MERGEABLE",
        reviewDecision: "REVIEW_REQUIRED",
        state: "OPEN",
        updatedAt: "2024-05-01T00:00:00Z",
      });
    }),
  );

const RERUN = { __typename: "CheckRun", name: "verify", workflowName: "verify" };

const countsACancelledRunOnlyWhenTheCheckDidNotRunAgain = () =>
  runTest(
    Effect.gen(function* () {
      const view = (statusCheckRollup: readonly object[]) =>
        runGh(execResult({ stdout: JSON.stringify({ state: "OPEN", statusCheckRollup }) })).view({
          number: 12,
        });
      const superseded = yield* view([
        { ...RERUN, conclusion: "CANCELLED", status: "COMPLETED" },
        { ...RERUN, conclusion: "SUCCESS", status: "COMPLETED" },
      ]);
      expect(superseded.checks).toMatchObject({ cancelled: 0, failed: 0, passed: 1, total: 1 });
      const rerunning = yield* view([
        { ...RERUN, conclusion: "CANCELLED", status: "COMPLETED" },
        { ...RERUN, conclusion: null, status: "IN_PROGRESS" },
      ]);
      expect(rerunning.checks).toMatchObject({ cancelled: 0, failed: 0, pending: 1, total: 1 });
      const cancelled = yield* view([{ ...RERUN, conclusion: "CANCELLED", status: "COMPLETED" }]);
      expect(cancelled.checks).toMatchObject({ cancelled: 1, failed: 0, passed: 0, total: 1 });
      const failedRerun = yield* view([
        { ...RERUN, conclusion: "CANCELLED", status: "COMPLETED" },
        { ...RERUN, conclusion: "FAILURE", status: "COMPLETED" },
      ]);
      expect(failedRerun.checks).toMatchObject({ cancelled: 0, failed: 1, passed: 0, total: 1 });
    }),
  );

const readsTheBehindCountFromGhApi = () =>
  runTest(
    Effect.gen(function* () {
      const behind = yield* runGh(execResult({ stdout: "3\n" })).behind(
        { number: 12 },
        "main",
        "abc123",
      );

      expect(behind).toBe(3);
    }),
  );

const readsHowLongPastSuccessfulRunsTook = () =>
  runTest(
    Effect.gen(function* () {
      expect(ghRunsArgs({ number: 12, repository: "masseater/msa" })).toEqual([
        "api",
        "repos/masseater/msa/actions/runs?status=completed&exclude_pull_requests=true&per_page=100",
        "--jq",
        "[.workflow_runs[] | {name, conclusion, created_at, run_started_at, updated_at}]",
      ]);
      const stdout = `[
        {"conclusion":"success","created_at":"2024-05-01T00:00:00Z","name":"verify","updated_at":"2024-05-01T00:16:00Z"},
        {"conclusion":"failure","created_at":"2024-05-01T00:00:00Z","name":"commits","updated_at":"2024-05-01T00:01:30Z"},
        {"conclusion":"success","created_at":"2024-05-01T00:00:00Z","name":"verify","run_started_at":"2024-05-01T03:00:00Z","updated_at":"2024-05-01T03:12:00Z"}
      ]`;

      const runs = yield* runGh(execResult({ stdout })).runs({ number: 12 });

      expect(runs).toEqual([
        { durationMs: 16 * 60_000, succeeded: true, workflow: "verify" },
        { durationMs: 90_000, succeeded: false, workflow: "commits" },
        { durationMs: 12 * 60_000, succeeded: true, workflow: "verify" },
      ]);
    }),
  );

const failsWithTheReasonWhenGhIs = () =>
  runTest(
    Effect.gen(function* () {
      const gh = makeGh({
        cwd: "/tmp",
        find: () => null,
        run: () => Promise.resolve(execResult()),
      });

      const error = yield* gh.view({ number: 12 }).pipe(Effect.flip);

      expect(error.kind).toBe("missing");
      expect(error.message).toBe("gh is not on PATH");
    }),
  );

const failsWithAuthWhenGhIsNot = () =>
  runTest(
    Effect.gen(function* () {
      const gh = runGh(
        execResult({
          code: 4,
          stderr: "To get started with GitHub CLI, please run: gh auth login",
        }),
      );

      const error = yield* gh.view({ number: 12 }).pipe(Effect.flip);

      expect(error.kind).toBe("auth");
    }),
  );

const failsWithRateLimitWhenGithubRejects = () =>
  runTest(
    Effect.gen(function* () {
      const gh = runGh(
        execResult({ code: 1, stderr: "GraphQL: API rate limit exceeded for user ID 1." }),
      );

      const error = yield* gh.view({ number: 12 }).pipe(Effect.flip);

      expect(error.kind).toBe("rate-limit");
    }),
  );

const failsWithNotFoundWhenThePull = () =>
  runTest(
    Effect.gen(function* () {
      const gh = runGh(
        execResult({
          code: 1,
          stderr: "GraphQL: Could not resolve to a PullRequest with the number of 99.",
        }),
      );

      const error = yield* gh.view({ number: 99 }).pipe(Effect.flip);

      expect(error.kind).toBe("not-found");
    }),
  );

const failsWhenGhPrintsJsonTheWatcher = () =>
  runTest(
    Effect.gen(function* () {
      const gh = runGh(execResult({ stdout: "not json" }));

      const error = yield* gh.view({ number: 12 }).pipe(Effect.flip);

      expect(error.kind).toBe("other");
      expect(error.message).toContain("JSON");
    }),
  );

describe("gh pull request reads", () => {
  it("asks gh for the fields the watcher diffs", asksGhForTheFieldsTheWatcher);

  it(
    "compares the head against the base to count the commits behind",
    comparesTheHeadAgainstTheBaseTo,
  );

  it(
    "turns gh JSON into state, review decision, comment count, and check counts",
    turnsGhJsonIntoStateReviewDecision,
  );

  it(
    "ignores a cancelled run of a check that ran again on the same head, keeps a failed rerun as failed, and counts a lone cancelled run apart from failures",
    countsACancelledRunOnlyWhenTheCheckDidNotRunAgain,
  );

  it("reads the behind count from gh api compare", readsTheBehindCountFromGhApi);

  it(
    "reads how long the past workflow runs took, from the start of the last attempt of a re-run",
    readsHowLongPastSuccessfulRunsTook,
  );

  it("fails with the reason when gh is not installed", failsWithTheReasonWhenGhIs);

  it("fails with auth when gh is not signed in", failsWithAuthWhenGhIsNot);

  it(
    "fails with rate-limit when GitHub rejects the call for going too fast",
    failsWithRateLimitWhenGithubRejects,
  );

  it("fails with not-found when the pull request does not exist", failsWithNotFoundWhenThePull);

  it("fails when gh prints JSON the watcher cannot read", failsWhenGhPrintsJsonTheWatcher);
});
