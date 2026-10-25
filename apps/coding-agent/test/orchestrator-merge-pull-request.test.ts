import testing from "@msa/testing";
import { Effect } from "effect";
import { expect, it } from "vite-plus/test";

import orchestratorHarness from "./orchestrator-harness.ts";
import pullRequestSupport from "./pull-request-support.ts";
import worktreeSupport from "./worktree-support.ts";

const { joinPath, writeTextFile } = testing;
const { setup, taskStatus, waitFor } = orchestratorHarness.harness;
const { cleanedUp, commitAndPush, reviewed, withRemote } = pullRequestSupport;
const { GIT, runCommand, sh } = worktreeSupport;

type Remote = Parameters<Parameters<typeof withRemote>[0]>[0];

const ROOT = joinPath(import.meta.dirname, "..", "..", "..");
const TRAILER = /\n\nMsa-Merge: [0-9a-f-]{36}$/u;
const COMMIT = "feat: add loose.txt\n\nloose.txt carries the setting no task owns.";
const LONG_BODY = `## Summary\n\n| table | ${"x".repeat(150)} |\n`;
const REFUSED = { code: 1, stderr: "gh: Base branch was modified. (HTTP 405)", stdout: "" };

function loosePull(remote: Remote) {
  return Effect.gen(function* () {
    const { github, repository } = remote;
    const branch = "loose";
    yield* writeTextFile(joinPath(repository, "commit.msg"), COMMIT);
    yield* sh(
      [
        `git checkout -q -b ${branch}`,
        "echo loose > loose.txt && git add loose.txt",
        `${GIT} commit -q -F commit.msg`,
        "rm commit.msg",
        `git push -q origin ${branch}`,
        "git checkout -q main",
      ].join(" && "),
      repository,
    );
    const number = yield* github.open(branch, "main", LONG_BODY);
    github.pulls[0]!.title = "feat: add the loose setting";
    const head = yield* github.head(branch);
    github.ci.set(head, "success");
    const run = setup({ cwd: repository, runCommand, runGh: github.runGh });
    return { ...run, branch, head, number };
  });
}

function commitlint(message: string, cwd: string) {
  return Effect.gen(function* () {
    const file = joinPath(cwd, "merge-message.txt");
    yield* writeTextFile(file, message);
    return yield* Effect.promise((signal) =>
      runCommand(
        `${joinPath(ROOT, "node_modules", ".bin", "commitlint")} --cwd ${ROOT} --edit ${file}`,
        ROOT,
        60_000,
        signal,
      ),
    );
  });
}

function attempt(
  orchestrator: ReturnType<typeof setup>["orchestrator"],
  number: number,
  head: string,
) {
  return Effect.promise(() =>
    orchestrator.mergePullRequest(number, head).then(
      (line) => ({ line, ok: true }),
      (error: unknown) => ({ line: String(error), ok: false }),
    ),
  );
}

const mergesALoosePullRequest = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github, repository } = remote;
        const run = yield* loosePull(remote);
        const result = yield* attempt(run.orchestrator, run.number, run.head);
        expect(result.ok, result.line).toBe(true);
        expect(result.line).toContain(`Squash-merged PR #${run.number} at head`);
        expect(github.requests).toEqual([{ number: String(run.number), sha: run.head }]);
        const [merged] = github.merged;
        expect(merged?.subject).toBe(`feat: add the loose setting (#${run.number})`);
        expect(merged?.body).toMatch(TRAILER);
        expect(merged?.body.replace(TRAILER, "")).toBe(
          "loose.txt carries the setting no task owns.",
        );
        const lint = yield* commitlint(`${merged?.subject}\n\n${merged?.body}\n`, repository);
        expect(lint.exitCode, lint.output).toBe(0);
      }),
    ),
  );

it(
  "merge_pull_request squash-merges a pull request no task owns at the named head, with its title and commit messages, so a body line over 100 characters still passes commitlint",
  mergesALoosePullRequest,
);

const refusesAnotherHead = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github, repository } = remote;
        const run = yield* loosePull(remote);
        yield* sh(
          `git checkout -q ${run.branch} && echo more > more.txt && git add more.txt && ${GIT} commit -q -m "feat: more" && git push -q origin ${run.branch} && git checkout -q main`,
          repository,
        );
        github.ci.set(yield* github.head(run.branch), "success");
        const result = yield* attempt(run.orchestrator, run.number, run.head);
        expect(result.ok).toBe(false);
        expect(result.line).toContain(`not the head ${run.head.slice(0, 12)} you named`);
        expect(github.requests).toEqual([]);
        expect(github.pulls[0]?.state).toBe("OPEN");
      }),
    ),
  );

it(
  "merge_pull_request sends no merge request when the pull request's head is not the one named",
  refusesAnotherHead,
);

const refusesPendingCi = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const run = yield* loosePull(remote);
        github.ci.set(run.head, "pending");
        const result = yield* attempt(run.orchestrator, run.number, run.head);
        expect(result.ok).toBe(false);
        expect(result.line).toContain("CI has not finished");
        expect(github.requests).toEqual([]);
      }),
    ),
  );

it("merge_pull_request sends no merge request while CI runs on the head", refusesPendingCi);

const confirmsAnUnansweredMergeByItsTrailer = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const run = yield* loosePull(remote);
        github.mergeAnswer = { code: 1, stderr: "request timed out", stdout: "" };
        const result = yield* attempt(run.orchestrator, run.number, run.head);
        expect(result.ok, result.line).toBe(true);
        expect(github.pulls[0]?.state).toBe("MERGED");
      }),
    ),
  );

it(
  "merge_pull_request reports the merge as its own when GitHub never answers but the merge commit carries its trailer",
  confirmsAnUnansweredMergeByItsTrailer,
);

const reportsAnOutsideMerge = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const run = yield* loosePull(remote);
        github.mergeRefusal = REFUSED;
        github.beforeMerge = Effect.gen(function* () {
          github.beforeMerge = undefined;
          yield* github.mergeOutside(run.number, "someone-else");
        });
        const result = yield* attempt(run.orchestrator, run.number, run.head);
        expect(result.ok).toBe(false);
        expect(result.line).toContain("cannot confirm the merge as its own");
        expect(result.line).toContain("GitHub refused the one it sent");
      }),
    ),
  );

it(
  "merge_pull_request does not claim a merge made outside it right after GitHub refused its own",
  reportsAnOutsideMerge,
);

const refusesARunningTasksPullRequest = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const { orchestrator, head, number, taskId } = yield* reviewed(remote);
        const result = yield* attempt(orchestrator, number, head);
        expect(result.ok).toBe(false);
        expect(result.line).toContain(`task ${taskId}`);
        expect(github.requests).toEqual([]);
        expect(taskStatus(orchestrator, taskId)).toBe("running");
      }),
    ),
  );

it(
  "merge_pull_request leaves a running task's pull request to the harness",
  refusesARunningTasksPullRequest,
);

const completesAStoppedTask = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const run = yield* reviewed(remote);
        const { orchestrator, workers, branch, head, number, taskId, worktree } = run;
        github.mergeRefusal = REFUSED;
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) !== "running");
        expect(taskStatus(orchestrator, taskId)).toBe("stopped");
        expect(github.pulls[0]?.state).toBe("OPEN");
        github.mergeRefusal = undefined;
        github.mergeAnswer = { code: 1, stderr: "request timed out", stdout: "" };
        const result = yield* attempt(run.orchestrator, number, head);
        expect(result.ok, result.line).toBe(true);
        expect(taskStatus(orchestrator, taskId)).toBe("completed");
        expect(github.merged).toMatchObject([{ number, sha: head }]);
        const view = yield* Effect.promise(() => orchestrator.read(taskId));
        expect(view.status).toBe("completed");
        expect(yield* cleanedUp(remote, worktree, branch)).toEqual({
          local: false,
          remote: false,
          worktree: false,
        });
      }),
    ),
  );

it(
  "merge_pull_request merges a stopped task's pull request, the harness judges the merge its own, and the task completes",
  completesAStoppedTask,
);

const stopsOnAnOutsideMergeOfAStoppedTask = () =>
  Effect.runPromise(
    withRemote((remote) =>
      Effect.gen(function* () {
        const { github } = remote;
        const run = yield* reviewed(remote);
        const { orchestrator, workers, head, number, taskId, worktree, branch } = run;
        github.mergeRefusal = REFUSED;
        workers[1]!.complete("acceptable");
        yield* waitFor(() => taskStatus(orchestrator, taskId) !== "running");
        yield* commitAndPush(worktree, "late.txt", branch);
        const late = yield* github.head(branch);
        github.ci.set(late, "success");
        yield* github.mergeOutside(number, "someone-else");
        const result = yield* attempt(run.orchestrator, number, head);
        expect(result.ok).toBe(false);
        expect(result.line).toContain("someone-else");
        expect(taskStatus(orchestrator, taskId)).toBe("stopped");
        expect(github.requests).toHaveLength(1);
      }),
    ),
  );

it(
  "merge_pull_request leaves a task stopped when its pull request was merged outside the harness",
  stopsOnAnOutsideMergeOfAStoppedTask,
);
