import { Effect } from "effect";
import { describe, expect, it } from "vite-plus/test";

import type { ExecResult } from "../src/core/exec.ts";
import { ghCompareArgs, ghPrViewArgs, makeGh } from "../src/core/pr-watch/gh.ts";

const execResult = (overrides: Partial<ExecResult> = {}): ExecResult => ({
  stdout: "",
  stderr: "",
  code: 0,
  killed: false,
  ...overrides,
});

const viewJson = JSON.stringify({
  state: "OPEN",
  mergeable: "MERGEABLE",
  mergeStateStatus: "BEHIND",
  reviewDecision: "REVIEW_REQUIRED",
  updatedAt: "2024-05-01T00:00:00Z",
  baseRefName: "main",
  headRefOid: "abc123",
  comments: [{ body: "one" }, { body: "two" }],
  statusCheckRollup: [
    { __typename: "CheckRun", name: "build", status: "COMPLETED", conclusion: "SUCCESS" },
    { __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" },
    { __typename: "CheckRun", name: "lint", status: "IN_PROGRESS", conclusion: null },
    { __typename: "StatusContext", context: "ci/legacy", state: "SUCCESS" },
  ],
});

const runGh = (result: ExecResult) =>
  makeGh({
    cwd: "/tmp",
    find: () => "/usr/local/bin/gh",
    run: () => Promise.resolve(result),
  });

describe("gh pull request reads", () => {
  it("asks gh for the fields the watcher diffs", () => {
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
  });

  it("compares the head against the base to count the commits behind", () => {
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
  });

  it("turns gh JSON into state, review decision, comment count, and check counts", async () => {
    const snapshot = await Effect.runPromise(
      runGh(execResult({ stdout: viewJson })).view({ number: 12 }),
    );

    expect(snapshot).toEqual({
      state: "OPEN",
      mergeable: "MERGEABLE",
      mergeStateStatus: "BEHIND",
      reviewDecision: "REVIEW_REQUIRED",
      updatedAt: "2024-05-01T00:00:00Z",
      comments: 2,
      checks: {
        total: 4,
        passed: 2,
        failed: 1,
        pending: 1,
        pendingNames: ["lint"],
      },
      baseRefName: "main",
      headRefOid: "abc123",
      behindBy: undefined,
    });
  });

  it("reads the behind count from gh api compare", async () => {
    const behind = await Effect.runPromise(
      runGh(execResult({ stdout: "3\n" })).behind({ number: 12 }, "main", "abc123"),
    );

    expect(behind).toBe(3);
  });

  it("fails with the reason when gh is not installed", async () => {
    const gh = makeGh({ cwd: "/tmp", find: () => null, run: () => Promise.resolve(execResult()) });

    const error = await Effect.runPromise(gh.view({ number: 12 }).pipe(Effect.flip));

    expect(error.kind).toBe("missing");
    expect(error.message).toBe("gh is not on PATH");
  });

  it("fails with auth when gh is not signed in", async () => {
    const gh = runGh(
      execResult({ code: 4, stderr: "To get started with GitHub CLI, please run: gh auth login" }),
    );

    const error = await Effect.runPromise(gh.view({ number: 12 }).pipe(Effect.flip));

    expect(error.kind).toBe("auth");
  });

  it("fails with rate-limit when GitHub rejects the call for going too fast", async () => {
    const gh = runGh(
      execResult({ code: 1, stderr: "GraphQL: API rate limit exceeded for user ID 1." }),
    );

    const error = await Effect.runPromise(gh.view({ number: 12 }).pipe(Effect.flip));

    expect(error.kind).toBe("rate-limit");
  });

  it("fails with not-found when the pull request does not exist", async () => {
    const gh = runGh(
      execResult({
        code: 1,
        stderr: "GraphQL: Could not resolve to a PullRequest with the number of 99.",
      }),
    );

    const error = await Effect.runPromise(gh.view({ number: 99 }).pipe(Effect.flip));

    expect(error.kind).toBe("not-found");
  });

  it("fails when gh prints JSON the watcher cannot read", async () => {
    const gh = runGh(execResult({ stdout: "not json" }));

    const error = await Effect.runPromise(gh.view({ number: 12 }).pipe(Effect.flip));

    expect(error.kind).toBe("other");
    expect(error.message).toContain("JSON");
  });
});
