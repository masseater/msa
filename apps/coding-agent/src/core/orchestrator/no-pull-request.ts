import { Effect } from "effect";

import type goalCheckTextTypes from "./goal-check-text.types.ts";
import pullRequestsModule from "./pull-requests.ts";
import type runtimeTypes from "./runtime.types.ts";
import type orchestratorTypesTypes from "./types.types.ts";
import worktreeModule from "./worktree.ts";

const { pullRequests } = pullRequestsModule;
const { worktrees } = worktreeModule;

function codeChanges(cwd: string, branch: string, targetBranch: string): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const remote = yield* worktrees.hasOrigin(cwd);
    const base = remote ? `origin/${targetBranch}` : targetBranch;
    const changes: string[] = [];
    const ahead = yield* worktrees.git(cwd, ["rev-list", "--count", `${base}..HEAD`]);
    if (!ahead.ok) changes.push(`git cannot compare ${branch} with ${base}: ${ahead.output}`);
    else if (ahead.output !== "0") {
      changes.push(`${branch} has ${ahead.output} commit(s) that ${base} does not`);
    }
    if (remote) {
      const pushed = yield* worktrees.git(cwd, ["ls-remote", "--heads", "origin", branch]);
      if (!pushed.ok) changes.push(`git cannot list the branches of origin: ${pushed.output}`);
      else if (pushed.output !== "") changes.push(`${branch} is pushed to origin`);
    }
    const status = yield* worktrees.git(cwd, ["status", "--porcelain"]);
    if (!status.ok) changes.push(`git status fails: ${status.output}`);
    else if (status.output !== "") {
      changes.push(`the worktree has uncommitted changes:\n${status.output}`);
    }
    return changes;
  });
}

function problems(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  live: () => boolean,
): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    if (task.kind !== "work" || task.mergeInto !== null) return [];
    const thread = pullRequests.latestThreadOf(runtime, task.id);
    if (thread?.branch === null || thread?.branch === undefined) return [];
    const target = thread.targetBranch ?? "";
    const changes = yield* codeChanges(thread.cwd, thread.branch, target);
    if (!live() || changes.length === 0) return [];
    return [
      `This task opens no pull request (opensPullRequest false), so it must leave no code change, but ${changes.join("; ")}. Remove them so ${thread.branch} matches ${target} and is not on origin. When the goal needs a code change, end your turn with request_decision instead.`,
    ];
  });
}

function gate(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  live: () => boolean,
): Effect.Effect<goalCheckTextTypes.GateResult | undefined> {
  return Effect.map(problems(runtime, task, live), (found) =>
    found.length === 0
      ? undefined
      : { number: null, problems: found.map((text) => ({ kind: "fix", text })), task },
  );
}

function afterReview(
  runtime: runtimeTypes.Runtime,
  task: orchestratorTypesTypes.Task,
  live: () => boolean,
): Effect.Effect<runtimeTypes.MergeOutcome | undefined> {
  return Effect.map(problems(runtime, task, live), (found) => {
    if (found.length === 0) return undefined;
    return {
      kind: "sent-back",
      line: `The review passed, but the task goes back to the worker: ${found.join(" ")}`,
      prompt: [
        "<code-change>",
        "The reviewer passed this work, but it leaves a code change this task must not make. Fix the following; the work is checked and reviewed again after it.",
        ...found.map((problem) => `- ${problem}`),
        "</code-change>",
      ].join("\n"),
    };
  });
}

const noPullRequest = { afterReview, gate };

const noPullRequestModule = { noPullRequest };

export default noPullRequestModule;
